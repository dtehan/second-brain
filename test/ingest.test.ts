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
import { registerAdminTools } from '../src/tools/admin.js';

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
  registerAdminTools(server, db);
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
    const initial = await callTool(server, 'brain_list_watermarks', {}) as Array<{ source: string }>;
    expect(initial).toHaveLength(0);

    await callTool(server, 'brain_set_watermark', {
      source: 'email_done',
      last_timestamp: '2026-04-24T06:43:00Z',
      last_id: 'msg-999',
    });

    const all = await callTool(server, 'brain_list_watermarks', {}) as Array<{ source: string; last_timestamp: string }>;
    expect(all).toHaveLength(1);
    expect(all[0].source).toBe('email_done');
    expect(all[0].last_timestamp).toBe('2026-04-24T06:43:00Z');
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


  it('upserts an email on email_message_id collision', async () => {
    const first = await callTool(server, 'brain_ingest_email', {
      subject: 'Re: foo', date: '2026-05-06', content: 'v1',
      participants: ['Alice'], email_message_id: 'msg-A', folder: 'done',
    }) as { id: string; action: string };
    expect(first.action).toBe('created');

    const second = await callTool(server, 'brain_ingest_email', {
      subject: 'Re: foo (updated)', date: '2026-05-06', content: 'v2',
      participants: ['Alice', 'Bob'], email_message_id: 'msg-A', folder: 'done',
    }) as { id: string; action: string };

    expect(second.id).toBe(first.id);
    expect(second.action).toBe('updated');

    const rows = db.prepare("SELECT id, title, content FROM items WHERE email_message_id = 'msg-A'").all() as Array<{ title: string; content: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Re: foo (updated)');
    expect(rows[0].content).toBe('v2');
  });

  it('upserts a meeting on calendar_event_id collision', async () => {
    const first = await callTool(server, 'brain_ingest_meeting', {
      title: 'Standup', date: '2026-05-06', content: 'notes v1',
      attendees: ['Alice'], calendar_event_id: 'cal-1', source: 'm365_calendar',
    }) as { id: string; action: string };
    expect(first.action).toBe('created');

    const second = await callTool(server, 'brain_ingest_meeting', {
      title: 'Standup (revised)', date: '2026-05-06', content: 'notes v2',
      attendees: ['Alice', 'Bob'], calendar_event_id: 'cal-1', source: 'm365_calendar',
    }) as { id: string; action: string };

    expect(second.id).toBe(first.id);
    expect(second.action).toBe('updated');

    const rows = db.prepare("SELECT title FROM items WHERE calendar_event_id = 'cal-1'").all();
    expect(rows).toHaveLength(1);
  });

  it('brain_check_dedup is deterministic on chat_id', async () => {
    db.prepare(`INSERT INTO items (id, title, item_type, content, chat_id, message_count, created_at)
      VALUES ('chat-1', 'Dedup test', 'chat', 'c', 'dedup-chat', 9, datetime('now'))`).run();

    const check = await callTool(server, 'brain_check_dedup', { chat_id: 'dedup-chat' }) as { exists: boolean; message_count: number };
    expect(check.exists).toBe(true);
    expect(check.message_count).toBe(9);
  });

  it('brain_merge_items re-targets edges, item_people, and syntheses then drops the row', async () => {
    // Create two items via email ingest (merge logic is type-agnostic)
    const a = await callTool(server, 'brain_ingest_email', {
      subject: 'Keep', date: '2026-05-06', content: 'keeper',
      participants: ['Alice'], email_message_id: 'keep-1', folder: 'done',
    }) as { id: string };
    const b = await callTool(server, 'brain_ingest_email', {
      subject: 'Drop', date: '2026-05-06', content: 'to drop',
      participants: ['Bob'], email_message_id: 'drop-1', folder: 'done',
    }) as { id: string };

    // Edge from b → some person; will be re-targeted to a
    await callTool(server, 'brain_upsert_person', { name: 'Carol' });
    const carol = db.prepare("SELECT id FROM people WHERE name = 'Carol'").get() as { id: string };
    await callTool(server, 'brain_add_edge', {
      source_type: 'item', source_id: b.id,
      target_type: 'person', target_id: carol.id,
      relation: 'mentions', confidence: 1.0,
    });
    // Edge from a ↔ b will become a self-loop after merge — should be deleted
    await callTool(server, 'brain_add_edge', {
      source_type: 'item', source_id: a.id,
      target_type: 'item', target_id: b.id,
      relation: 'follows_up', confidence: 1.0,
    });

    // Synthesis that cites both
    await callTool(server, 'brain_save_synthesis', {
      synthesis_type: 'connection_discovery', scope: 'test',
      title: 'cd', content: 'x', source_ids: [a.id, b.id],
    });

    const result = await callTool(server, 'brain_merge_items', { keep_id: a.id, drop_id: b.id }) as {
      keep_id: string; drop_id: string; edges_redirected: number; edges_self_loops_removed: number;
    };
    expect(result.edges_self_loops_removed).toBe(1);
    expect(result.edges_redirected).toBe(1);

    // Row b is gone
    const rowB = db.prepare('SELECT id FROM items WHERE id = ?').get(b.id);
    expect(rowB).toBeUndefined();

    // Row a survives
    const rowA = db.prepare('SELECT id FROM items WHERE id = ?').get(a.id) as { id: string };
    expect(rowA.id).toBe(a.id);

    // The mentions edge now sources from a, not b
    const edges = db.prepare("SELECT source_id, target_id, relation FROM edges WHERE relation = 'mentions'").all() as Array<{ source_id: string; target_id: string }>;
    expect(edges).toHaveLength(1);
    expect(edges[0].source_id).toBe(a.id);
    expect(edges[0].target_id).toBe(carol.id);

    // Self-loop follows_up is gone
    const followsUp = db.prepare("SELECT * FROM edges WHERE relation = 'follows_up'").all();
    expect(followsUp).toHaveLength(0);

    // Bob (only linked through b) now linked to a
    const aPeople = db.prepare(`
      SELECT p.name FROM item_people ip JOIN people p ON ip.person_id = p.id WHERE ip.item_id = ? ORDER BY p.name
    `).all(a.id) as Array<{ name: string }>;
    expect(aPeople.map(p => p.name)).toEqual(['Alice', 'Bob']);

    // Synthesis source_ids deduplicated to just keep
    const synth = db.prepare("SELECT source_ids FROM syntheses WHERE scope = 'test'").get() as { source_ids: string };
    expect(JSON.parse(synth.source_ids)).toEqual([a.id]);

    // Drop's search rows are gone
    const ftsRow = db.prepare('SELECT entity_id FROM search_fts WHERE entity_id = ?').get(b.id);
    expect(ftsRow).toBeUndefined();
  });

  it('migration v2 auto-merges pre-existing chat_id duplicates and adds unique index', async () => {
    // Build a fresh DB without v2 — simulate the legacy state by inserting two rows with same chat_id directly
    const legacy = new Database(':memory:');
    sqliteVec.load(legacy);
    legacy.pragma('foreign_keys = ON');

    // Apply only v1 schema (the SCHEMA_SQL block) — easiest is to call initializeSchema which runs migrations all the way.
    // To test the migration in isolation, we instead bypass and write the rows BEFORE the unique index is added.
    // Trick: drop the unique index after init, insert dup rows, then re-run migration manually.
    initializeSchema(legacy);
    legacy.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_vec USING vec0(entity_id TEXT PRIMARY KEY, embedding float[384]);`);
    legacy.exec('DROP INDEX IF EXISTS idx_items_chat_id');

    legacy.prepare(`INSERT INTO items (id, title, item_type, content, chat_id, message_count, created_at) VALUES ('old', 't', 'chat', 'old', 'dup', 5, '2026-05-01 00:00:00')`).run();
    legacy.prepare(`INSERT INTO items (id, title, item_type, content, chat_id, message_count, created_at) VALUES ('new', 't', 'chat', 'new', 'dup', 8, '2026-05-02 00:00:00')`).run();

    // Re-run the v2 migration logic (drops dup, adds unique index)
    const { MIGRATIONS } = await import('../src/db/migrations.js');
    MIGRATIONS.find(m => m.version === 2)!.fn(legacy);

    const remaining = legacy.prepare("SELECT id FROM items WHERE chat_id = 'dup'").all() as Array<{ id: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('new'); // higher message_count wins

    // Unique index now blocks future dupes
    expect(() => {
      legacy.prepare(`INSERT INTO items (id, title, item_type, content, chat_id) VALUES ('x', 't', 'chat', 'c', 'dup')`).run();
    }).toThrow(/UNIQUE/);

    legacy.close();
  });
});
