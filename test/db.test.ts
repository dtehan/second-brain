import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { initializeSchema } from '../src/db/schema.js';

describe('Database Schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    sqliteVec.load(db);
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_vec USING vec0(
        entity_id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('creates all core tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);

    expect(names).toContain('items');
    expect(names).toContain('people');
    expect(names).toContain('accounts');
    expect(names).toContain('projects');
    expect(names).toContain('todos');
    expect(names).toContain('ideas');
    expect(names).toContain('resources');
    expect(names).toContain('item_people');
    expect(names).toContain('account_contacts');
    expect(names).toContain('tags');
    expect(names).toContain('edges');
    expect(names).toContain('search_meta');
    expect(names).toContain('watermarks');
    expect(names).toContain('syntheses');
    expect(names).toContain('connections');
  });

  it('creates FTS5 virtual table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'search_fts'"
    ).all();
    expect(tables.length).toBe(1);
  });

  it('creates vec0 virtual table', () => {
    // Verify we can insert and query vectors
    const vec = new Float32Array(384);
    vec[0] = 1.0;
    const buf = Buffer.from(vec.buffer);

    db.prepare('INSERT INTO search_vec (entity_id, embedding) VALUES (?, ?)').run('test1', buf);

    const results = db.prepare(`
      SELECT entity_id, distance FROM search_vec WHERE embedding MATCH ? AND k = 1
    `).all(buf) as Array<{ entity_id: string; distance: number }>;

    expect(results.length).toBe(1);
    expect(results[0].entity_id).toBe('test1');
    expect(results[0].distance).toBeCloseTo(0, 5);
  });

  it('enforces foreign keys', () => {
    expect(() => {
      db.prepare("INSERT INTO item_people (item_id, person_id) VALUES ('nonexistent', 'also-nonexistent')").run();
    }).toThrow();
  });

  it('records schema version at the latest', () => {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(2);
  });

  it('is idempotent', () => {
    const before = db.prepare('SELECT COUNT(*) as n FROM schema_version').get() as { n: number };
    initializeSchema(db);
    const after = db.prepare('SELECT COUNT(*) as n FROM schema_version').get() as { n: number };
    expect(after.n).toBe(before.n); // Re-running should not add another row
  });

  it('inserts and retrieves items with dedup fields', () => {
    db.prepare(`
      INSERT INTO items (id, title, item_type, date, content, source, email_message_id, fingerprint)
      VALUES ('i1', 'Test Email', 'email', '2026-04-24', 'body', 'm365_email', 'msg-123', 'fp-abc')
    `).run();

    const item = db.prepare('SELECT * FROM items WHERE email_message_id = ?').get('msg-123') as { title: string };
    expect(item.title).toBe('Test Email');
  });

  it('supports account_contacts with multiple roles', () => {
    db.prepare("INSERT INTO accounts (id, name) VALUES ('a1', 'Acme Corp')").run();
    db.prepare("INSERT INTO people (id, name) VALUES ('p1', 'Jane Doe')").run();

    db.prepare("INSERT INTO account_contacts (account_id, person_id, role) VALUES ('a1', 'p1', 'ae')").run();
    db.prepare("INSERT INTO account_contacts (account_id, person_id, role) VALUES ('a1', 'p1', 'csa')").run();

    const roles = db.prepare("SELECT role FROM account_contacts WHERE account_id = 'a1' AND person_id = 'p1'").all() as Array<{ role: string }>;
    expect(roles.map(r => r.role).sort()).toEqual(['ae', 'csa']);
  });

  it('supports watermarks', () => {
    db.prepare(`
      INSERT INTO watermarks (source, last_timestamp, last_id) VALUES ('email_done', '2026-04-24T06:43:00Z', 'msg-999')
    `).run();

    const wm = db.prepare("SELECT * FROM watermarks WHERE source = 'email_done'").get() as { last_timestamp: string; last_id: string };
    expect(wm.last_timestamp).toBe('2026-04-24T06:43:00Z');
    expect(wm.last_id).toBe('msg-999');
  });
});
