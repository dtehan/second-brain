import type Database from 'better-sqlite3';

export interface MergeResult {
  keep_id: string;
  drop_id: string;
  edges_redirected: number;
  edges_self_loops_removed: number;
  todos_redirected: number;
  syntheses_updated: number;
  people_links_redirected: number;
}

/**
 * Merge `drop_id` into `keep_id`. Re-targets every reference to `drop_id`
 * (item_people, todos.source_item_id, edges, connections, tags, syntheses.source_ids,
 * search indexes) to point at `keep_id`, then deletes the dropped row.
 *
 * Skips edges/connections that would become self-loops or violate UNIQUE
 * constraints — those are dropped silently.
 */
export function mergeItems(db: Database.Database, keepId: string, dropId: string): MergeResult {
  if (keepId === dropId) throw new Error('keep_id and drop_id must differ');

  const keep = db.prepare('SELECT id FROM items WHERE id = ?').get(keepId) as { id: string } | undefined;
  const drop = db.prepare('SELECT id FROM items WHERE id = ?').get(dropId) as { id: string } | undefined;
  if (!keep) throw new Error(`keep_id ${keepId} not found in items`);
  if (!drop) throw new Error(`drop_id ${dropId} not found in items`);

  const result: MergeResult = {
    keep_id: keepId,
    drop_id: dropId,
    edges_redirected: 0,
    edges_self_loops_removed: 0,
    todos_redirected: 0,
    syntheses_updated: 0,
    people_links_redirected: 0,
  };

  const tx = db.transaction(() => {
    // 1. item_people — copy drop's links to keep (dedupe), then drop's get cascaded on item delete
    const peopleMoved = db.prepare(
      'INSERT OR IGNORE INTO item_people (item_id, person_id) SELECT ?, person_id FROM item_people WHERE item_id = ?'
    ).run(keepId, dropId);
    result.people_links_redirected = peopleMoved.changes;

    // 2. todos.source_item_id
    const todosMoved = db.prepare('UPDATE todos SET source_item_id = ? WHERE source_item_id = ?').run(keepId, dropId);
    result.todos_redirected = todosMoved.changes;

    // 3. connections — delete prospective self-loops, then re-target both endpoints (dropping collisions)
    db.prepare(
      'DELETE FROM connections WHERE (item_a_id = ? AND item_b_id = ?) OR (item_a_id = ? AND item_b_id = ?)'
    ).run(dropId, keepId, keepId, dropId);
    db.prepare('UPDATE OR IGNORE connections SET item_a_id = ? WHERE item_a_id = ?').run(keepId, dropId);
    db.prepare('DELETE FROM connections WHERE item_a_id = ?').run(dropId);
    db.prepare('UPDATE OR IGNORE connections SET item_b_id = ? WHERE item_b_id = ?').run(keepId, dropId);
    db.prepare('DELETE FROM connections WHERE item_b_id = ?').run(dropId);

    // 4. edges — delete prospective self-loops, then re-target source/target (dropping UNIQUE collisions)
    const selfLoops = db.prepare(
      `DELETE FROM edges
       WHERE source_type = 'item' AND target_type = 'item'
         AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))`
    ).run(dropId, keepId, keepId, dropId);
    result.edges_self_loops_removed = selfLoops.changes;

    const srcMoved = db.prepare(
      "UPDATE OR IGNORE edges SET source_id = ? WHERE source_type = 'item' AND source_id = ?"
    ).run(keepId, dropId);
    db.prepare("DELETE FROM edges WHERE source_type = 'item' AND source_id = ?").run(dropId);
    const tgtMoved = db.prepare(
      "UPDATE OR IGNORE edges SET target_id = ? WHERE target_type = 'item' AND target_id = ?"
    ).run(keepId, dropId);
    db.prepare("DELETE FROM edges WHERE target_type = 'item' AND target_id = ?").run(dropId);
    result.edges_redirected = srcMoved.changes + tgtMoved.changes;

    // 5. tags
    db.prepare("UPDATE OR IGNORE tags SET entity_id = ? WHERE entity_type = 'item' AND entity_id = ?").run(keepId, dropId);
    db.prepare("DELETE FROM tags WHERE entity_type = 'item' AND entity_id = ?").run(dropId);

    // 6. syntheses.source_ids — JSON array; replace drop with keep, dedupe
    const synths = db.prepare(
      "SELECT id, source_ids FROM syntheses WHERE source_ids IS NOT NULL AND source_ids LIKE ?"
    ).all(`%${dropId}%`) as Array<{ id: string; source_ids: string }>;

    for (const s of synths) {
      let ids: unknown;
      try { ids = JSON.parse(s.source_ids); } catch { continue; }
      if (!Array.isArray(ids)) continue;
      if (!ids.includes(dropId)) continue;
      const updated = Array.from(new Set((ids as string[]).map(i => (i === dropId ? keepId : i))));
      db.prepare('UPDATE syntheses SET source_ids = ? WHERE id = ?').run(JSON.stringify(updated), s.id);
      result.syntheses_updated++;
    }

    // 7. search indexes for drop_id
    db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(dropId);
    db.prepare('DELETE FROM search_meta WHERE entity_id = ?').run(dropId);
    db.prepare('DELETE FROM search_vec WHERE entity_id = ?').run(dropId);

    // 8. delete the row
    db.prepare('DELETE FROM items WHERE id = ?').run(dropId);
  });

  tx();
  return result;
}
