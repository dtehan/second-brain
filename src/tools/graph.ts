import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { generateId } from '../utils/ids.js';

export function registerGraphTools(server: McpServer, db: Database.Database): void {

  // ── brain_add_edge ──
  server.tool(
    'brain_add_edge',
    'Create a relationship between any two entities in the knowledge graph',
    {
      source_type: z.string().describe('Source entity type: item | person | account | project | idea | resource'),
      source_id: z.string().describe('Source entity ID'),
      target_type: z.string().describe('Target entity type'),
      target_id: z.string().describe('Target entity ID'),
      relation: z.string().describe('Relationship type: mentions | related_to | works_on | assigned_to | about | follows_up | attended | works_at'),
      confidence: z.number().optional().default(1.0).describe('1.0 = explicit, <1.0 = inferred by dreaming'),
      evidence: z.string().optional().describe('JSON or text explaining why this edge exists'),
    },
    async ({ source_type, source_id, target_type, target_id, relation, confidence, evidence }) => {
      const id = generateId();
      try {
        db.prepare(`
          INSERT INTO edges (id, source_type, source_id, target_type, target_id, relation, confidence, evidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, source_type, source_id, target_type, target_id, relation, confidence, evidence ?? null);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ id, action: 'created' }) }] };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          // Edge already exists — update confidence/evidence
          db.prepare(`
            UPDATE edges SET confidence = ?, evidence = ?
            WHERE source_type = ? AND source_id = ? AND target_type = ? AND target_id = ? AND relation = ?
          `).run(confidence, evidence ?? null, source_type, source_id, target_type, target_id, relation);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'updated' }) }] };
        }
        throw err;
      }
    }
  );

  // ── brain_get_related ──
  server.tool(
    'brain_get_related',
    'Find entities related to a given entity via the knowledge graph',
    {
      entity_type: z.string().describe('Entity type: item | person | account | project'),
      entity_id: z.string().describe('Entity ID'),
      relation: z.string().optional().describe('Filter by relation type'),
      direction: z.enum(['outgoing', 'incoming', 'both']).optional().default('both'),
    },
    async ({ entity_type, entity_id, relation, direction }) => {
      const results: unknown[] = [];

      if (direction === 'outgoing' || direction === 'both') {
        let sql = 'SELECT * FROM edges WHERE source_type = ? AND source_id = ?';
        const params: unknown[] = [entity_type, entity_id];
        if (relation) { sql += ' AND relation = ?'; params.push(relation); }
        results.push(...db.prepare(sql).all(...params));
      }

      if (direction === 'incoming' || direction === 'both') {
        let sql = 'SELECT * FROM edges WHERE target_type = ? AND target_id = ?';
        const params: unknown[] = [entity_type, entity_id];
        if (relation) { sql += ' AND relation = ?'; params.push(relation); }
        results.push(...db.prepare(sql).all(...params));
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  // ── brain_get_graph ──
  server.tool(
    'brain_get_graph',
    'Get the knowledge graph around an entity to N depth. Returns nodes and edges for visualization.',
    {
      entity_type: z.string().describe('Starting entity type'),
      entity_id: z.string().describe('Starting entity ID'),
      depth: z.number().optional().default(2).describe('How many hops to traverse (1-3)'),
    },
    async ({ entity_type, entity_id, depth }) => {
      const maxDepth = Math.min(depth, 3);
      const visitedNodes = new Set<string>();
      const edgeResults: unknown[] = [];
      const nodeResults: Array<{ type: string; id: string; label: string }> = [];

      const queue: Array<{ type: string; id: string; currentDepth: number }> = [
        { type: entity_type, id: entity_id, currentDepth: 0 },
      ];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const nodeKey = `${current.type}:${current.id}`;

        if (visitedNodes.has(nodeKey)) continue;
        visitedNodes.add(nodeKey);

        // Get node label
        let label = current.id;
        if (current.type === 'person') {
          const p = db.prepare('SELECT name FROM people WHERE id = ?').get(current.id) as { name: string } | undefined;
          if (p) label = p.name;
        } else if (current.type === 'account') {
          const a = db.prepare('SELECT name FROM accounts WHERE id = ?').get(current.id) as { name: string } | undefined;
          if (a) label = a.name;
        } else if (current.type === 'item') {
          const i = db.prepare('SELECT title FROM items WHERE id = ?').get(current.id) as { title: string } | undefined;
          if (i) label = i.title;
        } else if (current.type === 'project') {
          const pr = db.prepare('SELECT name FROM projects WHERE id = ?').get(current.id) as { name: string } | undefined;
          if (pr) label = pr.name;
        }

        nodeResults.push({ type: current.type, id: current.id, label });

        if (current.currentDepth >= maxDepth) continue;

        // Find connected edges
        const outgoing = db.prepare('SELECT * FROM edges WHERE source_type = ? AND source_id = ?').all(current.type, current.id) as Array<{
          target_type: string; target_id: string; relation: string; confidence: number;
        }>;
        const incoming = db.prepare('SELECT * FROM edges WHERE target_type = ? AND target_id = ?').all(current.type, current.id) as Array<{
          source_type: string; source_id: string; relation: string; confidence: number;
        }>;

        for (const e of outgoing) {
          edgeResults.push(e);
          queue.push({ type: e.target_type, id: e.target_id, currentDepth: current.currentDepth + 1 });
        }
        for (const e of incoming) {
          edgeResults.push(e);
          queue.push({ type: e.source_type, id: e.source_id, currentDepth: current.currentDepth + 1 });
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({ nodes: nodeResults, edges: edgeResults }, null, 2) }] };
    }
  );
}
