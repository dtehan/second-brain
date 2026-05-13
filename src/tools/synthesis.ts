import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { generateId } from '../utils/ids.js';

export function registerSynthesisTools(server: McpServer, db: Database.Database): void {

  // ── brain_save_synthesis ──
  server.tool(
    'brain_save_synthesis',
    'Store a dreaming synthesis (person summary, weekly digest, account health, etc). Supersedes any existing synthesis of same type+scope.',
    {
      synthesis_type: z.enum(['person_summary', 'account_health', 'weekly_digest', 'connection_discovery', 'theme_cluster']),
      scope: z.string().describe('Entity ID or date range this synthesis covers'),
      title: z.string(),
      content: z.string().describe('Synthesis content (markdown)'),
      source_ids: z.array(z.string()).optional().describe('Entity IDs that fed this synthesis'),
      expires_at: z.string().optional().describe('ISO datetime when this synthesis expires'),
    },
    async ({ synthesis_type, scope, title, content, source_ids, expires_at }) => {
      const id = generateId();

      // Find previous synthesis of same type+scope to supersede
      const previous = db.prepare(`
        SELECT id FROM syntheses
        WHERE synthesis_type = ? AND scope = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(synthesis_type, scope) as { id: string } | undefined;

      // Insert new row first so the FK reference is valid before updating the old row
      db.prepare(`
        INSERT INTO syntheses (id, synthesis_type, scope, title, content, source_ids, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, synthesis_type, scope, title, content, source_ids ? JSON.stringify(source_ids) : null, expires_at ?? null);

      if (previous) {
        db.prepare('UPDATE syntheses SET superseded_by = ? WHERE id = ?').run(id, previous.id);
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, synthesis_type, scope, supersedes: previous?.id }) }] };
    }
  );

  // ── brain_get_synthesis ──
  server.tool(
    'brain_get_synthesis',
    'Retrieve the latest non-superseded synthesis by type and scope',
    {
      synthesis_type: z.enum(['person_summary', 'account_health', 'weekly_digest', 'connection_discovery', 'theme_cluster']),
      scope: z.string().describe('Entity ID or date range'),
    },
    async ({ synthesis_type, scope }) => {
      const row = db.prepare(`
        SELECT * FROM syntheses
        WHERE synthesis_type = ? AND scope = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(synthesis_type, scope);

      if (!row) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ exists: false }) }] };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(row, null, 2) }] };
    }
  );
}
