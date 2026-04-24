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

  // ── brain_get_portfolio ──
  server.tool(
    'brain_get_portfolio',
    'Get all accounts as a portfolio overview with health, platform, contacts by role, and last interaction date',
    {},
    async () => {
      const accounts = db.prepare('SELECT id, name, health, platform, segment, arr FROM accounts ORDER BY name').all() as Array<{
        id: string; name: string; health: string | null; platform: string | null; segment: string | null; arr: string | null;
      }>;

      const portfolio = accounts.map(acc => {
        const contacts = db.prepare(`
          SELECT p.name, ac.role
          FROM account_contacts ac JOIN people p ON ac.person_id = p.id
          WHERE ac.account_id = ?
          ORDER BY ac.role
        `).all(acc.id) as Array<{ name: string; role: string }>;

        const lastInteraction = db.prepare(`
          SELECT date, title, item_type FROM items WHERE account_id = ? ORDER BY date DESC LIMIT 1
        `).get(acc.id) as { date: string; title: string; item_type: string } | undefined;

        const interactionCount = (db.prepare('SELECT COUNT(*) as n FROM items WHERE account_id = ?').get(acc.id) as { n: number }).n;

        return {
          ...acc,
          contacts,
          last_interaction: lastInteraction ?? null,
          interaction_count: interactionCount,
        };
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(portfolio, null, 2) }] };
    }
  );
}
