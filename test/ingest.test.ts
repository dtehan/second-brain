import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { initializeSchema } from '../src/db/schema.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerIngestTools } from '../src/tools/ingest.js';
import { registerSearchTools } from '../src/tools/search.js';
import { registerWatermarkTools } from '../src/tools/watermark.js';
import { registerEntityTools } from '../src/tools/entities.js';
import { registerQueryTools } from '../src/tools/query.js';
import { registerStatsTools } from '../src/tools/stats.js';
import { registerGraphTools } from '../src/tools/graph.js';
import { registerSynthesisTools } from '../src/tools/synthesis.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_vec USING vec0(entity_id TEXT PRIMARY KEY, embedding float[384]);`);
  return db;
}

function createTestServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  registerIngestTools(server, db);
  registerSearchTools(server, db);
  registerWatermarkTools(server, db);
  registerEntityTools(server, db);
  registerQueryTools(server, db);
  registerStatsTools(server, db);
  registerGraphTools(server, db);
  registerSynthesisTools(server, db);
  return server;
}

// Call a registered tool's handler directly (bypassing MCP transport)
async function callTool(server: McpServer, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = (server as any)._registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  const result = await tool.handler(args);
  const text = (result as any).content[0].text;
  return JSON.parse(text);
}

describe('Ingest Tools', () => {
  let db: Database.Database;
  let server: McpServer;

  beforeEach(() => {
    db = createTestDb();
    server = createTestServer(db);
  });

  afterEach(() => {
    db.close();
  });

  it('ingests a meeting and creates people stubs', async () => {
    const result = await callTool(server, 'brain_ingest_meeting', {
      title: 'Boeing Technical Review',
      date: '2026-04-24',
      content: '## Discussion\nReviewed BCAI middleware requirements.',
      attendees: ['Chris Alvey', 'Preston Barbare'],
      meeting_type: 'account',
    }) as { id: string; attendees_count: number };

    expect(result.id).toBeTruthy();
    expect(result.attendees_count).toBe(2);

    // Verify item exists
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.id) as { title: string; item_type: string };
    expect(item.title).toBe('Boeing Technical Review');
    expect(item.item_type).toBe('meeting');

    // Verify people were created
    const people = db.prepare('SELECT name FROM people ORDER BY name').all() as Array<{ name: string }>;
    expect(people.map(p => p.name)).toEqual(['Chris Alvey', 'Preston Barbare']);

    // Verify item_people links
    const links = db.prepare('SELECT COUNT(*) as n FROM item_people WHERE item_id = ?').get(result.id) as { n: number };
    expect(links.n).toBe(2);

    // Verify search index
    const fts = db.prepare("SELECT * FROM search_fts WHERE search_fts MATCH 'Boeing'").all();
    expect(fts.length).toBe(1);

    // Verify vector index
    const vecCount = db.prepare('SELECT COUNT(*) as n FROM search_vec').get() as { n: number };
    expect(vecCount.n).toBe(1);
  });

  it('ingests an email with contact info', async () => {
    db.prepare("INSERT INTO people (id, name) VALUES ('p1', 'Sarah Chen')").run();

    const result = await callTool(server, 'brain_ingest_email', {
      subject: 'Re: MCP Requirements',
      date: '2026-04-23',
      content: 'Summary of MCP requirements discussion.',
      participants: ['Sarah Chen', 'David Wolfe'],
      email_message_id: 'msg-abc-123',
      folder: 'done',
      contact_info: [
        { name: 'Sarah Chen', email: 'sarah@example.com', phone: '+1-555-0123', title: 'AI Strategy Lead' },
      ],
    }) as { id: string };

    expect(result.id).toBeTruthy();

    const sarah = db.prepare("SELECT * FROM people WHERE name = 'Sarah Chen'").get() as {
      email: string | null; phone: string | null; title: string | null;
    };
    expect(sarah.email).toBe('sarah@example.com');
    expect(sarah.phone).toBe('+1-555-0123');
    expect(sarah.title).toBe('AI Strategy Lead');

    const david = db.prepare("SELECT * FROM people WHERE name = 'David Wolfe'").get() as { id: string };
    expect(david).toBeTruthy();
  });

  it('dedup check detects existing emails', async () => {
    await callTool(server, 'brain_ingest_email', {
      subject: 'Test Email',
      date: '2026-04-24',
      content: 'Body text.',
      participants: ['Alice'],
      email_message_id: 'msg-unique-1',
      folder: 'done',
    });

    const check = await callTool(server, 'brain_check_dedup', {
      email_message_id: 'msg-unique-1',
    }) as { exists: boolean };
    expect(check.exists).toBe(true);

    const checkMiss = await callTool(server, 'brain_check_dedup', {
      email_message_id: 'msg-nonexistent',
    }) as { exists: boolean };
    expect(checkMiss.exists).toBe(false);
  });

  it('watermark tools work correctly', async () => {
    const initial = await callTool(server, 'brain_get_watermark', {
      source: 'email_done',
    }) as { exists: boolean };
    expect(initial.exists).toBe(false);

    await callTool(server, 'brain_set_watermark', {
      source: 'email_done',
      last_timestamp: '2026-04-24T06:43:00Z',
      last_id: 'msg-999',
    });

    const after = await callTool(server, 'brain_get_watermark', {
      source: 'email_done',
    }) as { exists: boolean; last_timestamp: string };
    expect(after.exists).toBe(true);
    expect(after.last_timestamp).toBe('2026-04-24T06:43:00Z');

    const all = await callTool(server, 'brain_list_watermarks', {}) as Array<{ source: string }>;
    expect(all.length).toBe(1);
  });

  it('stats reports correct counts', async () => {
    await callTool(server, 'brain_ingest_meeting', {
      title: 'Meeting 1', date: '2026-04-24', content: 'Content 1',
    });
    await callTool(server, 'brain_ingest_email', {
      subject: 'Email 1', date: '2026-04-23', content: 'Content 2',
      participants: ['Alice'], email_message_id: 'e1', folder: 'done',
    });

    const stats = await callTool(server, 'brain_stats', {}) as { counts: { items: number; meetings: number; emails: number; people: number } };
    expect(stats.counts.items).toBe(2);
    expect(stats.counts.meetings).toBe(1);
    expect(stats.counts.emails).toBe(1);
    expect(stats.counts.people).toBe(1);
  });

  it('upserts person without overwriting existing fields', async () => {
    await callTool(server, 'brain_upsert_person', {
      name: 'Test Person', title: 'Engineer', company: 'Acme',
    });

    await callTool(server, 'brain_upsert_person', {
      name: 'Test Person', email: 'test@acme.com',
    });

    const person = db.prepare("SELECT * FROM people WHERE name = 'Test Person'").get() as {
      title: string; company: string; email: string;
    };
    expect(person.title).toBe('Engineer');
    expect(person.company).toBe('Acme');
    expect(person.email).toBe('test@acme.com');
  });

  it('upserts account with contacts', async () => {
    await callTool(server, 'brain_upsert_account', {
      name: 'Boeing',
      health: 'green',
      platform: 'Cloud',
      contacts: [
        { person_name: 'Chris Alvey', role: 'ae' },
        { person_name: 'Chris Alvey', role: 'champion' },
        { person_name: 'Sarah Chen', role: 'csa' },
      ],
    });

    const contacts = db.prepare(`
      SELECT p.name, ac.role FROM account_contacts ac
      JOIN people p ON ac.person_id = p.id
      JOIN accounts a ON ac.account_id = a.id
      WHERE a.name = 'Boeing'
      ORDER BY p.name, ac.role
    `).all() as Array<{ name: string; role: string }>;

    expect(contacts).toEqual([
      { name: 'Chris Alvey', role: 'ae' },
      { name: 'Chris Alvey', role: 'champion' },
      { name: 'Sarah Chen', role: 'csa' },
    ]);
  });
});
