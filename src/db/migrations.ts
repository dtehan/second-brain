import type Database from 'better-sqlite3';
import { mergeItems } from './merge-items.js';

interface Migration {
  version: number;
  fn: (db: Database.Database) => void;
}

/**
 * v2: enforce uniqueness on chat_id and calendar_event_id.
 *
 * Auto-merges any pre-existing duplicates (caused by the v1 ingest path
 * silently inserting on dedup-key collisions instead of upserting), then
 * replaces the non-unique indexes with partial unique ones.
 *
 * For chat_id collisions, the row with the highest message_count wins
 * (latest snapshot of the thread). For calendar_event_id, the most
 * recently created row wins.
 */
function migrateToV2(db: Database.Database): void {
  for (const col of ['chat_id', 'calendar_event_id'] as const) {
    const orderBy = col === 'chat_id'
      ? 'COALESCE(message_count, 0) DESC, datetime(created_at) DESC, id'
      : 'datetime(created_at) DESC, id';

    const dupKeys = db.prepare(
      `SELECT ${col} as key FROM items WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING COUNT(*) > 1`
    ).all() as Array<{ key: string }>;

    for (const { key } of dupKeys) {
      const rows = db.prepare(`SELECT id FROM items WHERE ${col} = ? ORDER BY ${orderBy}`).all(key) as Array<{ id: string }>;
      const [keep, ...drops] = rows;
      for (const drop of drops) {
        mergeItems(db, keep.id, drop.id);
      }
    }
  }

  db.exec(`
    DROP INDEX IF EXISTS idx_items_chat_id;
    DROP INDEX IF EXISTS idx_items_calendar_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_chat_id ON items(chat_id) WHERE chat_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_items_calendar_id ON items(calendar_event_id) WHERE calendar_event_id IS NOT NULL;
  `);
}

export const MIGRATIONS: Migration[] = [
  { version: 2, fn: migrateToV2 },
];
