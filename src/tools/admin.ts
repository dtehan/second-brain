import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { mergeItems } from '../db/merge-items.js';

export function registerAdminTools(server: McpServer, db: Database.Database): void {

  // ── brain_merge_items ──
  server.tool(
    'brain_merge_items',
    'Merge two item rows: re-target every reference (item_people, todos, edges, connections, tags, syntheses, search indexes) from drop_id to keep_id, then delete drop_id. Use this to clean up duplicates left over from the pre-v2 ingest path.',
    {
      keep_id: z.string().describe('Item ID to keep'),
      drop_id: z.string().describe('Item ID to merge into keep_id and delete'),
    },
    async ({ keep_id, drop_id }) => {
      const result = mergeItems(db, keep_id, drop_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );
}
