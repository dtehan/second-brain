import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { generateId } from '../utils/ids.js';
import { computeFingerprint } from '../utils/fingerprint.js';
import { updateSearchIndex, updateVectorIndex } from '../search/update.js';

function normalizeName(name: string): { name: string; company: string | null } {
  // Strip "Name (Company)" pattern — use clean name, extract company
  const match = name.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (match) {
    return { name: match[1].trim(), company: match[2].trim() };
  }
  return { name: name.trim(), company: null };
}

function ensurePerson(db: Database.Database, rawName: string): string {
  const { name, company } = normalizeName(rawName);

  const existing = db.prepare('SELECT id FROM people WHERE name = ?').get(name) as { id: string } | undefined;
  if (existing) {
    // Backfill company if we extracted one and the record doesn't have it
    if (company) {
      db.prepare('UPDATE people SET company = COALESCE(company, ?) WHERE id = ?').run(company, existing.id);
    }
    return existing.id;
  }

  const id = generateId();
  db.prepare('INSERT OR IGNORE INTO people (id, name, company) VALUES (?, ?, ?)').run(id, name, company ?? null);

  // Re-select: handles the race where a parallel agent inserted first
  const row = db.prepare('SELECT id FROM people WHERE name = ?').get(name) as { id: string };
  if (company) {
    db.prepare('UPDATE people SET company = COALESCE(company, ?) WHERE id = ?').run(company, row.id);
  }
  return row.id;
}

function linkItemPeople(db: Database.Database, itemId: string, personIds: string[]): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO item_people (item_id, person_id) VALUES (?, ?)');
  for (const personId of personIds) {
    stmt.run(itemId, personId);
  }
}

export function registerIngestTools(server: McpServer, db: Database.Database): void {

  // ── brain_ingest_meeting ──
  server.tool(
    'brain_ingest_meeting',
    'Ingest a meeting note with attendees, account, and calendar event ID',
    {
      title: z.string().describe('Meeting title'),
      date: z.string().describe('ISO date: YYYY-MM-DD'),
      content: z.string().describe('Full meeting notes (markdown)'),
      summary: z.string().optional().describe('AI-generated summary'),
      attendees: z.array(z.string()).optional().describe('List of attendee names'),
      account: z.string().optional().describe('Account name (creates link if exists)'),
      meeting_type: z.enum(['account', 'internal', '1:1', 'cross-functional']).optional(),
      calendar_event_id: z.string().optional().describe('M365 calendar event ID for dedup'),
      source: z.enum(['manual', 'm365_calendar']).optional().default('manual'),
    },
    async ({ title, date, content, summary, attendees, account, meeting_type, calendar_event_id, source }) => {
      const fingerprint = computeFingerprint(content);
      const resolvedSource = source ?? 'manual';

      let accountId: string | null = null;
      if (account) {
        const acc = db.prepare('SELECT id FROM accounts WHERE name = ?').get(account) as { id: string } | undefined;
        if (acc) accountId = acc.id;
      }

      const existing = calendar_event_id
        ? (db.prepare('SELECT id FROM items WHERE calendar_event_id = ?').get(calendar_event_id) as { id: string } | undefined)
        : undefined;

      let id: string;
      let action: 'created' | 'updated';

      if (existing) {
        id = existing.id;
        action = 'updated';
        db.prepare(`
          UPDATE items SET
            title = ?, date = ?, content = ?, summary = ?, meeting_type = ?,
            account_id = ?, source = ?, fingerprint = ?
          WHERE id = ?
        `).run(title, date, content, summary ?? null, meeting_type ?? null, accountId, resolvedSource, fingerprint, id);
      } else {
        id = generateId();
        action = 'created';
        db.prepare(`
          INSERT INTO items (id, title, item_type, date, content, summary, meeting_type, account_id, source, calendar_event_id, fingerprint)
          VALUES (?, ?, 'meeting', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, title, date, content, summary ?? null, meeting_type ?? null, accountId, resolvedSource, calendar_event_id ?? null, fingerprint);
      }

      if (attendees?.length) {
        const personIds = attendees.map(name => ensurePerson(db, name));
        linkItemPeople(db, id, personIds);
      }

      updateSearchIndex(db, id, 'item', title, content, date, []);
      await updateVectorIndex(db, id, `${title}\n${content}`);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, title, date, attendees_count: attendees?.length ?? 0, action }) }] };
    }
  );

  // ── brain_ingest_email ──
  server.tool(
    'brain_ingest_email',
    'Ingest an email from M365 with dedup fields. Extracts contact info from body/signature to update person records.',
    {
      subject: z.string().describe('Email subject line'),
      date: z.string().describe('ISO date: YYYY-MM-DD'),
      content: z.string().describe('Email summary (markdown)'),
      participants: z.array(z.string()).describe('All To/From/CC names'),
      email_message_id: z.string().describe('M365 message ID for dedup'),
      conversation_id: z.string().optional().describe('M365 thread ID'),
      folder: z.enum(['done', 'sent']).describe('Source folder'),
      account: z.string().optional().describe('Account name if customer email'),
      contact_info: z.array(z.object({
        name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        title: z.string().optional(),
      })).optional().describe('Contact details extracted from email signatures'),
    },
    async ({ subject, date, content, participants, email_message_id, conversation_id, folder, account, contact_info }) => {
      const fingerprint = computeFingerprint(content);

      let accountId: string | null = null;
      if (account) {
        const acc = db.prepare('SELECT id FROM accounts WHERE name = ?').get(account) as { id: string } | undefined;
        if (acc) accountId = acc.id;
      }

      const existing = db.prepare('SELECT id FROM items WHERE email_message_id = ?').get(email_message_id) as { id: string } | undefined;

      let id: string;
      let action: 'created' | 'updated';

      if (existing) {
        id = existing.id;
        action = 'updated';
        db.prepare(`
          UPDATE items SET
            title = ?, date = ?, content = ?, account_id = ?,
            conversation_id = ?, folder = ?, fingerprint = ?
          WHERE id = ?
        `).run(subject, date, content, accountId, conversation_id ?? null, folder, fingerprint, id);
      } else {
        id = generateId();
        action = 'created';
        db.prepare(`
          INSERT INTO items (id, title, item_type, date, content, account_id, source, email_message_id, conversation_id, folder, fingerprint)
          VALUES (?, ?, 'email', ?, ?, ?, 'm365_email', ?, ?, ?, ?)
        `).run(id, subject, date, content, accountId, email_message_id, conversation_id ?? null, folder, fingerprint);
      }

      const personIds = participants.map(name => ensurePerson(db, name));
      linkItemPeople(db, id, personIds);

      // Update contact info on person records
      if (contact_info?.length) {
        const updateStmt = db.prepare(`
          UPDATE people SET
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            title = COALESCE(?, title),
            updated_at = datetime('now')
          WHERE name = ?
        `);
        for (const ci of contact_info) {
          updateStmt.run(ci.email ?? null, ci.phone ?? null, ci.title ?? null, ci.name);
        }
      }

      updateSearchIndex(db, id, 'item', subject, content, date, []);
      await updateVectorIndex(db, id, `${subject}\n${content}`);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, subject, date, participants_count: participants.length, action }) }] };
    }
  );

  // ── brain_ingest_note ──
  server.tool(
    'brain_ingest_note',
    'Ingest a free-form note, idea, or resource',
    {
      title: z.string().describe('Note title'),
      content: z.string().describe('Note content (markdown)'),
      note_type: z.enum(['note', 'idea', 'resource']).describe('Type of note'),
      topic: z.string().optional().describe('Topic tag (for resources)'),
      source_url: z.string().optional().describe('Source URL (for resources)'),
    },
    async ({ title, content, note_type, topic, source_url }) => {
      const id = generateId();

      if (note_type === 'idea') {
        db.prepare('INSERT INTO ideas (id, title, content) VALUES (?, ?, ?)').run(id, title, content);
        updateSearchIndex(db, id, 'idea', title, content, null, []);
      } else if (note_type === 'resource') {
        db.prepare('INSERT INTO resources (id, title, content, source_url, topic) VALUES (?, ?, ?, ?, ?)').run(id, title, content, source_url ?? null, topic ?? null);
        updateSearchIndex(db, id, 'resource', title, content, null, topic ? [topic] : []);
      } else {
        const fingerprint = computeFingerprint(content);
        db.prepare(`
          INSERT INTO items (id, title, item_type, date, content, fingerprint)
          VALUES (?, ?, 'note', date('now'), ?, ?)
        `).run(id, title, content, fingerprint);
        updateSearchIndex(db, id, 'item', title, content, null, []);
      }

      await updateVectorIndex(db, id, `${title}\n${content}`);

      return { content: [{ type: 'text' as const, text: JSON.stringify({ id, title, type: note_type }) }] };
    }
  );

  // ── brain_check_dedup ──
  server.tool(
    'brain_check_dedup',
    'Check if content already exists by email_message_id, chat_id, calendar_event_id, or fingerprint',
    {
      email_message_id: z.string().optional(),
      chat_id: z.string().optional(),
      calendar_event_id: z.string().optional(),
      fingerprint: z.string().optional(),
      content: z.string().optional().describe('Raw content to fingerprint and check'),
    },
    async ({ email_message_id, chat_id, calendar_event_id, fingerprint, content }) => {
      let existing: { id: string; title: string; message_count?: number } | undefined;

      // ORDER BY guards against the legacy case where multiple rows share the same dedup key
      // (pre-v2 schema). After v2 the unique indexes make these queries return at most one row.
      if (email_message_id) {
        existing = db.prepare(
          'SELECT id, title FROM items WHERE email_message_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1'
        ).get(email_message_id) as typeof existing;
      } else if (chat_id) {
        existing = db.prepare(
          'SELECT id, title, message_count FROM items WHERE chat_id = ? ORDER BY COALESCE(message_count, 0) DESC, datetime(updated_at) DESC LIMIT 1'
        ).get(chat_id) as typeof existing;
      } else if (calendar_event_id) {
        existing = db.prepare(
          'SELECT id, title FROM items WHERE calendar_event_id = ? ORDER BY datetime(updated_at) DESC LIMIT 1'
        ).get(calendar_event_id) as typeof existing;
      } else if (fingerprint || content) {
        const fp = fingerprint || computeFingerprint(content!);
        existing = db.prepare(
          'SELECT id, title FROM items WHERE fingerprint = ? ORDER BY datetime(updated_at) DESC LIMIT 1'
        ).get(fp) as typeof existing;
      }

      if (existing) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ exists: true, ...existing }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ exists: false }) }] };
    }
  );
}
