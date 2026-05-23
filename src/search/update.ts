import type Database from 'better-sqlite3';
import { embed } from '../embeddings/embedder.js';

export function updateSearchIndex(db: Database.Database, entityId: string, entityType: string, title: string, content: string, date: string | null, tags: string[]): void {
  db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(entityId);
  db.prepare('INSERT INTO search_fts (entity_type, entity_id, title, content, tags_text) VALUES (?, ?, ?, ?, ?)').run(
    entityType, entityId, title, content, tags.join(' ')
  );

  db.prepare(`
    INSERT INTO search_meta (entity_id, entity_type, title, date, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entity_id) DO UPDATE SET entity_type=excluded.entity_type, title=excluded.title, date=excluded.date, updated_at=datetime('now')
  `).run(entityId, entityType, title, date);
}

export async function updateVectorIndex(db: Database.Database, entityId: string, text: string): Promise<void> {
  const embedding = await embed(text);
  const buf = Buffer.from(embedding.buffer);
  db.prepare('DELETE FROM search_vec WHERE entity_id = ?').run(entityId);
  db.prepare('INSERT INTO search_vec (entity_id, embedding) VALUES (?, ?)').run(entityId, buf);
}
