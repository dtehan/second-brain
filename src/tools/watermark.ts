import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export function registerWatermarkTools(server: McpServer, db: Database.Database): void {

  server.tool(
    'brain_get_watermark',
    'Get the last-processed timestamp/ID for a source (email_done, email_sent, chat, dreaming)',
    {
      source: z.string().describe('Watermark source: email_done | email_sent | chat | dreaming'),
    },
    async ({ source }) => {
      const row = db.prepare('SELECT source, last_timestamp, last_id, updated_at FROM watermarks WHERE source = ?').get(source) as {
        source: string; last_timestamp: string | null; last_id: string | null; updated_at: string;
      } | undefined;

      if (!row) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ source, exists: false, last_timestamp: null, last_id: null }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...row, exists: true }) }] };
    }
  );

  server.tool(
    'brain_set_watermark',
    'Update the watermark after successful processing',
    {
      source: z.string().describe('Watermark source: email_done | email_sent | chat | dreaming'),
      last_timestamp: z.string().describe('ISO datetime of last processed item'),
      last_id: z.string().optional().describe('ID of last processed item (for cursor-based paging)'),
    },
    async ({ source, last_timestamp, last_id }) => {
      db.prepare(`
        INSERT INTO watermarks (source, last_timestamp, last_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(source) DO UPDATE SET
          last_timestamp = excluded.last_timestamp,
          last_id = excluded.last_id,
          updated_at = datetime('now')
      `).run(source, last_timestamp, last_id ?? null);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, source, last_timestamp }) }] };
    }
  );

  server.tool(
    'brain_list_watermarks',
    'List all watermarks with their timestamps',
    {},
    async () => {
      const rows = db.prepare('SELECT source, last_timestamp, last_id, updated_at FROM watermarks ORDER BY source').all();
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] };
    }
  );
}
