import type Database from 'better-sqlite3';
import { embed } from '../embeddings/embedder.js';

export interface SearchResult {
  entity_id: string;
  entity_type: string;
  title: string;
  date: string | null;
  score: number;
  snippet: string;
  match_type: 'fts' | 'vector' | 'both';
}

interface FtsRow {
  entity_id: string;
  entity_type: string;
  title: string;
  content: string;
  rank: number;
}

interface VecRow {
  entity_id: string;
  distance: number;
}

export async function hybridSearch(
  db: Database.Database,
  query: string,
  options: {
    typeFilter?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;
  const results = new Map<string, SearchResult>();

  // 1. FTS5 search
  const ftsRows = db.prepare(`
    SELECT entity_id, entity_type, title, content, rank
    FROM search_fts
    WHERE search_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit * 2) as FtsRow[];

  for (const row of ftsRows) {
    results.set(row.entity_id, {
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      title: row.title,
      date: null,
      score: -row.rank, // FTS5 rank is negative (more negative = better)
      snippet: row.content.substring(0, 200),
      match_type: 'fts',
    });
  }

  // 2. Vector similarity search
  const queryEmbedding = await embed(query);
  const buf = Buffer.from(queryEmbedding.buffer);

  const vecRows = db.prepare(`
    SELECT entity_id, distance
    FROM search_vec
    WHERE embedding MATCH ?
    AND k = ?
  `).all(buf, limit * 2) as VecRow[];

  for (const row of vecRows) {
    const similarity = 1 - row.distance; // Convert distance to similarity
    const existing = results.get(row.entity_id);
    if (existing) {
      existing.score = existing.score + similarity * 10; // Boost items that match both
      existing.match_type = 'both';
    } else {
      results.set(row.entity_id, {
        entity_id: row.entity_id,
        entity_type: '',
        title: '',
        date: null,
        score: similarity * 10,
        snippet: '',
        match_type: 'vector',
      });
    }
  }

  // 3. Enrich with metadata
  for (const [entityId, result] of results) {
    if (!result.entity_type || !result.title) {
      const meta = db.prepare('SELECT entity_type, title, date FROM search_meta WHERE entity_id = ?').get(entityId) as {
        entity_type: string; title: string; date: string | null;
      } | undefined;
      if (meta) {
        result.entity_type = meta.entity_type;
        result.title = meta.title;
        result.date = meta.date;
      }
    } else {
      const meta = db.prepare('SELECT date FROM search_meta WHERE entity_id = ?').get(entityId) as { date: string | null } | undefined;
      if (meta) result.date = meta.date;
    }
  }

  // 4. Filter
  let filtered = Array.from(results.values());

  if (options.typeFilter) {
    filtered = filtered.filter(r => r.entity_type === options.typeFilter);
  }
  if (options.dateFrom) {
    filtered = filtered.filter(r => !r.date || r.date >= options.dateFrom!);
  }
  if (options.dateTo) {
    filtered = filtered.filter(r => !r.date || r.date <= options.dateTo!);
  }

  // 5. Sort and limit
  filtered.sort((a, b) => b.score - a.score);
  return filtered.slice(0, limit);
}
