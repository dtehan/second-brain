import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeSchema } from './schema.js';

const EMBEDDING_DIM = 384;

let _db: Database.Database | null = null;

export function getDbPath(): string {
  return process.env['BRAIN2_DB'] || `${process.env['HOME']}/.brain2/brain2.db`;
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema (tables, indexes, triggers)
  initializeSchema(db);

  // Create vector search table (must be done after sqlite-vec is loaded)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_vec USING vec0(
      entity_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
  `);

  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function getInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  sqliteVec.load(db);
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_vec USING vec0(
      entity_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
  `);
  return db;
}

export { EMBEDDING_DIM };
