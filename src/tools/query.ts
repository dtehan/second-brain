import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

export function registerQueryTools(server: McpServer, db: Database.Database): void {

  // ── brain_get_item ──
  server.tool(
    'brain_get_item',
    'Get a specific item by ID, including attendees and related edges',
    {
      id: z.string().describe('Item ID'),
    },
    async ({ id }) => {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!item) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Item not found' }) }] };
      }

      const attendees = db.prepare(`
        SELECT p.id, p.name, p.title, p.company
        FROM item_people ip JOIN people p ON ip.person_id = p.id
        WHERE ip.item_id = ?
      `).all(id);

      const edges = db.prepare(`
        SELECT * FROM edges
        WHERE (source_type = 'item' AND source_id = ?) OR (target_type = 'item' AND target_id = ?)
      `).all(id, id);

      const tags = db.prepare("SELECT tag FROM tags WHERE entity_type = 'item' AND entity_id = ?").all(id);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...item as object, attendees, edges, tags }, null, 2) }] };
    }
  );

  // ── brain_get_person ──
  server.tool(
    'brain_get_person',
    'Get a person profile with interaction history, account roles, and related entities',
    {
      name: z.string().describe('Person name (exact match)'),
    },
    async ({ name }) => {
      const person = db.prepare('SELECT * FROM people WHERE name = ?').get(name);
      if (!person) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Person not found' }) }] };
      }

      const personId = (person as { id: string }).id;

      const interactions = db.prepare(`
        SELECT i.id, i.title, i.item_type, i.date, i.summary
        FROM item_people ip JOIN items i ON ip.item_id = i.id
        WHERE ip.person_id = ?
        ORDER BY i.date DESC
        LIMIT 50
      `).all(personId);

      const accountRoles = db.prepare(`
        SELECT a.name as account_name, ac.role
        FROM account_contacts ac JOIN accounts a ON ac.account_id = a.id
        WHERE ac.person_id = ?
      `).all(personId);

      const edges = db.prepare(`
        SELECT * FROM edges
        WHERE (source_type = 'person' AND source_id = ?) OR (target_type = 'person' AND target_id = ?)
      `).all(personId, personId);

      const synthesis = db.prepare(`
        SELECT * FROM syntheses
        WHERE synthesis_type = 'person_summary' AND scope = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(personId);

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        ...person as object,
        interactions,
        account_roles: accountRoles,
        edges,
        latest_synthesis: synthesis,
      }, null, 2) }] };
    }
  );

  // ── brain_get_account ──
  server.tool(
    'brain_get_account',
    'Get an account profile with contacts (by role), engagement history, and health synthesis',
    {
      name: z.string().describe('Account name (exact match)'),
    },
    async ({ name }) => {
      const account = db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
      if (!account) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Account not found' }) }] };
      }

      const accountId = (account as { id: string }).id;

      const contacts = db.prepare(`
        SELECT p.name, p.title, p.company, p.email, p.phone, ac.role
        FROM account_contacts ac JOIN people p ON ac.person_id = p.id
        WHERE ac.account_id = ?
        ORDER BY ac.role, p.name
      `).all(accountId);

      const engagements = db.prepare(`
        SELECT i.id, i.title, i.item_type, i.date, i.summary
        FROM items i
        WHERE i.account_id = ?
        ORDER BY i.date DESC
        LIMIT 50
      `).all(accountId);

      const synthesis = db.prepare(`
        SELECT * FROM syntheses
        WHERE synthesis_type = 'account_health' AND scope = ? AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1
      `).get(accountId);

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        ...account as object,
        contacts,
        engagements,
        latest_synthesis: synthesis,
      }, null, 2) }] };
    }
  );

  // ── brain_list_items ──
  server.tool(
    'brain_list_items',
    'List items with filters by type, date range, account, and person',
    {
      item_type: z.enum(['meeting', 'email', 'chat', 'note']).optional(),
      date_from: z.string().optional().describe('From date (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('To date (YYYY-MM-DD)'),
      account: z.string().optional().describe('Account name'),
      person: z.string().optional().describe('Person name (must be an attendee)'),
      limit: z.number().optional().default(50),
    },
    async ({ item_type, date_from, date_to, account, person, limit }) => {
      let sql = 'SELECT i.id, i.title, i.item_type, i.date, i.summary, i.source FROM items i';
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (person) {
        sql += ' JOIN item_people ip ON i.id = ip.item_id JOIN people p ON ip.person_id = p.id';
        conditions.push('p.name = ?');
        params.push(person);
      }

      if (account) {
        sql += person ? '' : '';
        conditions.push('i.account_id = (SELECT id FROM accounts WHERE name = ?)');
        params.push(account);
      }

      if (item_type) { conditions.push('i.item_type = ?'); params.push(item_type); }
      if (date_from) { conditions.push('i.date >= ?'); params.push(date_from); }
      if (date_to) { conditions.push('i.date <= ?'); params.push(date_to); }

      if (conditions.length) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY i.date DESC LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ── brain_list_people ──
  server.tool(
    'brain_list_people',
    'List people with optional company or account filter',
    {
      company: z.string().optional(),
      account: z.string().optional().describe('Filter to people associated with this account'),
      limit: z.number().optional().default(100),
    },
    async ({ company, account, limit }) => {
      if (account) {
        const rows = db.prepare(`
          SELECT p.id, p.name, p.title, p.company, p.email, ac.role
          FROM account_contacts ac
          JOIN people p ON ac.person_id = p.id
          JOIN accounts a ON ac.account_id = a.id
          WHERE a.name = ?
          ORDER BY p.name LIMIT ?
        `).all(account, limit);
        return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
      }

      let sql = 'SELECT id, name, title, company, email FROM people';
      const params: unknown[] = [];
      if (company) { sql += ' WHERE company = ?'; params.push(company); }
      sql += ' ORDER BY name LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );

  // ── brain_list_accounts ──
  server.tool(
    'brain_list_accounts',
    'List all accounts with optional health filter',
    {
      health: z.enum(['green', 'yellow', 'red']).optional(),
      limit: z.number().optional().default(100),
    },
    async ({ health, limit }) => {
      let sql = 'SELECT id, name, health, platform, segment, arr FROM accounts';
      const params: unknown[] = [];
      if (health) { sql += ' WHERE health = ?'; params.push(health); }
      sql += ' ORDER BY name LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );
}
