import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export function registerStatsTools(server: McpServer, db: Database.Database): void {

  // ── brain_stats ──
  server.tool(
    'brain_stats',
    'Database statistics: entity counts, recent activity, graph metrics',
    {},
    async () => {
      const counts = {
        items: (db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number }).n,
        meetings: (db.prepare("SELECT COUNT(*) as n FROM items WHERE item_type = 'meeting'").get() as { n: number }).n,
        emails: (db.prepare("SELECT COUNT(*) as n FROM items WHERE item_type = 'email'").get() as { n: number }).n,
        chats: (db.prepare("SELECT COUNT(*) as n FROM items WHERE item_type = 'chat'").get() as { n: number }).n,
        notes: (db.prepare("SELECT COUNT(*) as n FROM items WHERE item_type = 'note'").get() as { n: number }).n,
        people: (db.prepare('SELECT COUNT(*) as n FROM people').get() as { n: number }).n,
        accounts: (db.prepare('SELECT COUNT(*) as n FROM accounts').get() as { n: number }).n,
        projects: (db.prepare('SELECT COUNT(*) as n FROM projects').get() as { n: number }).n,
        todos_open: (db.prepare('SELECT COUNT(*) as n FROM todos WHERE done = 0').get() as { n: number }).n,
        todos_done: (db.prepare('SELECT COUNT(*) as n FROM todos WHERE done = 1').get() as { n: number }).n,
        ideas: (db.prepare('SELECT COUNT(*) as n FROM ideas').get() as { n: number }).n,
        resources: (db.prepare('SELECT COUNT(*) as n FROM resources').get() as { n: number }).n,
        edges: (db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number }).n,
        tags: (db.prepare('SELECT COUNT(*) as n FROM tags').get() as { n: number }).n,
        syntheses: (db.prepare('SELECT COUNT(*) as n FROM syntheses WHERE superseded_by IS NULL').get() as { n: number }).n,
      };

      const recentItems = db.prepare(`
        SELECT item_type, date, title FROM items ORDER BY created_at DESC LIMIT 5
      `).all();

      const dateRange = db.prepare(`
        SELECT MIN(date) as earliest, MAX(date) as latest FROM items
      `).get() as { earliest: string | null; latest: string | null };

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        counts,
        date_range: dateRange,
        recent_items: recentItems,
      }, null, 2) }] };
    }
  );

}
