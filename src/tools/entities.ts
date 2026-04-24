import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { generateId } from '../utils/ids.js';
import { embed } from '../embeddings/embedder.js';

function updateSearchIndex(db: Database.Database, entityId: string, entityType: string, title: string, content: string): void {
  db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(entityId);
  db.prepare('INSERT INTO search_fts (entity_type, entity_id, title, content, tags_text) VALUES (?, ?, ?, ?, ?)').run(
    entityType, entityId, title, content, ''
  );
  db.prepare(`
    INSERT INTO search_meta (entity_id, entity_type, title, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(entity_id) DO UPDATE SET title=excluded.title, updated_at=datetime('now')
  `).run(entityId, entityType, title);
}

async function updateVectorIndex(db: Database.Database, entityId: string, text: string): Promise<void> {
  const embedding = await embed(text);
  const buf = Buffer.from(embedding.buffer);
  db.prepare('DELETE FROM search_vec WHERE entity_id = ?').run(entityId);
  db.prepare('INSERT INTO search_vec (entity_id, embedding) VALUES (?, ?)').run(entityId, buf);
}

export function registerEntityTools(server: McpServer, db: Database.Database): void {

  // ── brain_upsert_person ──
  server.tool(
    'brain_upsert_person',
    'Create or update a person. Non-null fields merge (existing values not overwritten with null).',
    {
      name: z.string().describe('Person full name'),
      title: z.string().optional(),
      company: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      background: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ name, title, company, email, phone, background, notes }) => {
      const existing = db.prepare('SELECT * FROM people WHERE name = ?').get(name) as {
        id: string; title: string | null; company: string | null; email: string | null; phone: string | null;
        background: string | null; notes: string | null;
      } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE people SET
            title = COALESCE(?, title),
            company = COALESCE(?, company),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            background = COALESCE(?, background),
            notes = COALESCE(?, notes)
          WHERE name = ?
        `).run(title ?? null, company ?? null, email ?? null, phone ?? null, background ?? null, notes ?? null, name);

        const searchText = [name, title ?? existing.title, company ?? existing.company, background ?? existing.background].filter(Boolean).join(' ');
        updateSearchIndex(db, existing.id, 'person', name, searchText);
        await updateVectorIndex(db, existing.id, searchText);

        return { content: [{ type: 'text' as const, text: JSON.stringify({ id: existing.id, action: 'updated', name }) }] };
      }

      const id = generateId();
      db.prepare('INSERT INTO people (id, name, title, company, email, phone, background, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, name, title ?? null, company ?? null, email ?? null, phone ?? null, background ?? null, notes ?? null
      );

      const searchText = [name, title, company, background].filter(Boolean).join(' ');
      updateSearchIndex(db, id, 'person', name, searchText);
      await updateVectorIndex(db, id, searchText);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, action: 'created', name }) }] };
    }
  );

  // ── brain_upsert_account ──
  server.tool(
    'brain_upsert_account',
    'Create or update an account. Use account_contacts for people roles (AE, CSA, etc).',
    {
      name: z.string().describe('Account name'),
      health: z.enum(['green', 'yellow', 'red']).optional(),
      platform: z.string().optional(),
      segment: z.string().optional(),
      arr: z.string().optional(),
      overview: z.string().optional(),
      notes: z.string().optional(),
      contacts: z.array(z.object({
        person_name: z.string(),
        role: z.string().describe('Role: ae, csa, se, tam, sponsor, champion, decision_maker, technical_contact, etc.'),
      })).optional().describe('People associated with this account and their roles'),
    },
    async ({ name, health, platform, segment, arr, overview, notes, contacts }) => {
      const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name) as { id: string } | undefined;

      let accountId: string;
      let action: string;

      if (existing) {
        accountId = existing.id;
        action = 'updated';
        db.prepare(`
          UPDATE accounts SET
            health = COALESCE(?, health),
            platform = COALESCE(?, platform),
            segment = COALESCE(?, segment),
            arr = COALESCE(?, arr),
            overview = COALESCE(?, overview),
            notes = COALESCE(?, notes)
          WHERE id = ?
        `).run(health ?? null, platform ?? null, segment ?? null, arr ?? null, overview ?? null, notes ?? null, accountId);
      } else {
        accountId = generateId();
        action = 'created';
        db.prepare('INSERT INTO accounts (id, name, health, platform, segment, arr, overview, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          accountId, name, health ?? null, platform ?? null, segment ?? null, arr ?? null, overview ?? null, notes ?? null
        );
      }

      // Update contacts
      if (contacts?.length) {
        for (const c of contacts) {
          const personId = (() => {
            const p = db.prepare('SELECT id FROM people WHERE name = ?').get(c.person_name) as { id: string } | undefined;
            if (p) return p.id;
            const newId = generateId();
            db.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run(newId, c.person_name);
            return newId;
          })();

          db.prepare('INSERT OR REPLACE INTO account_contacts (account_id, person_id, role) VALUES (?, ?, ?)').run(accountId, personId, c.role);
        }
      }

      const searchText = [name, overview, notes].filter(Boolean).join(' ');
      updateSearchIndex(db, accountId, 'account', name, searchText);
      await updateVectorIndex(db, accountId, searchText);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id: accountId, action, name }) }] };
    }
  );

  // ── brain_upsert_project ──
  server.tool(
    'brain_upsert_project',
    'Create or update a project',
    {
      name: z.string().describe('Project name'),
      status: z.enum(['active', 'done', 'someday', 'archived']).optional(),
      description: z.string().optional(),
    },
    async ({ name, status, description }) => {
      const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(name) as { id: string } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE projects SET
            status = COALESCE(?, status),
            description = COALESCE(?, description)
          WHERE id = ?
        `).run(status ?? null, description ?? null, existing.id);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ id: existing.id, action: 'updated', name }) }] };
      }

      const id = generateId();
      db.prepare('INSERT INTO projects (id, name, status, description) VALUES (?, ?, ?, ?)').run(
        id, name, status ?? 'active', description ?? null
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, action: 'created', name }) }] };
    }
  );

  // ── brain_add_todo ──
  server.tool(
    'brain_add_todo',
    'Add a todo item with optional source, project, and assignee',
    {
      text: z.string().describe('Todo text'),
      priority: z.enum(['highest', 'high', 'normal', 'low']).optional(),
      due_date: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      source_item_id: z.string().optional().describe('Item ID this todo came from'),
      project: z.string().optional().describe('Project name'),
      assigned_by: z.string().optional().describe('Person name who assigned it'),
    },
    async ({ text, priority, due_date, source_item_id, project, assigned_by }) => {
      const id = generateId();

      let projectId: string | null = null;
      if (project) {
        const p = db.prepare('SELECT id FROM projects WHERE name = ?').get(project) as { id: string } | undefined;
        if (p) projectId = p.id;
      }

      let assignedById: string | null = null;
      if (assigned_by) {
        const p = db.prepare('SELECT id FROM people WHERE name = ?').get(assigned_by) as { id: string } | undefined;
        if (p) assignedById = p.id;
      }

      db.prepare('INSERT INTO todos (id, text, priority, due_date, source_item_id, project_id, assigned_by_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, text, priority ?? null, due_date ?? null, source_item_id ?? null, projectId, assignedById
      );

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, text, priority }) }] };
    }
  );

  // ── brain_update_todo ──
  server.tool(
    'brain_update_todo',
    'Update a todo (mark done, change text, priority, due date)',
    {
      id: z.string().describe('Todo ID'),
      text: z.string().optional(),
      done: z.boolean().optional(),
      priority: z.enum(['highest', 'high', 'normal', 'low']).optional(),
      due_date: z.string().optional(),
    },
    async ({ id, text, done, priority, due_date }) => {
      const sets: string[] = [];
      const params: unknown[] = [];

      if (text !== undefined) { sets.push('text = ?'); params.push(text); }
      if (done !== undefined) { sets.push('done = ?'); params.push(done ? 1 : 0); }
      if (priority !== undefined) { sets.push('priority = ?'); params.push(priority); }
      if (due_date !== undefined) { sets.push('due_date = ?'); params.push(due_date); }

      if (sets.length === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No fields to update' }) }] };
      }

      params.push(id);
      db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, updated: true }) }] };
    }
  );

  // ── brain_list_todos ──
  server.tool(
    'brain_list_todos',
    'List todos with filters by completion status, project, person, and priority',
    {
      done: z.boolean().optional(),
      project: z.string().optional().describe('Project name'),
      person: z.string().optional().describe('Assigned by person name'),
      priority: z.enum(['highest', 'high', 'normal', 'low']).optional(),
      limit: z.number().optional().default(100),
    },
    async ({ done, project, person, priority, limit }) => {
      let sql = `
        SELECT t.id, t.text, t.done, t.priority, t.due_date, t.created_at,
               p.name as project_name, pp.name as assigned_by_name
        FROM todos t
        LEFT JOIN projects p ON t.project_id = p.id
        LEFT JOIN people pp ON t.assigned_by_id = pp.id
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (done !== undefined) { conditions.push('t.done = ?'); params.push(done ? 1 : 0); }
      if (project) { conditions.push('p.name = ?'); params.push(project); }
      if (person) { conditions.push('pp.name = ?'); params.push(person); }
      if (priority) { conditions.push('t.priority = ?'); params.push(priority); }

      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY t.created_at DESC LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    }
  );
}
