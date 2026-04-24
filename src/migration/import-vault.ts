import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import type Database from 'better-sqlite3';
import { generateId } from '../utils/ids.js';
import { computeFingerprint } from '../utils/fingerprint.js';
import { parseVaultFile, extractPeople, resolveItemType, parseHealth, parseAeCsa, type ParsedVaultFile } from './parse-frontmatter.js';
import { parseInteractionTable, parsePortfolioTable, extractAllWikiLinks } from './parse-tables.js';
import { embed, embedBatch } from '../embeddings/embedder.js';

interface ImportStats {
  people: number;
  accounts: number;
  projects: number;
  items: number;
  item_people: number;
  todos: number;
  resources: number;
  edges: number;
  tags: number;
  embeddings: number;
  errors: string[];
}

export async function importVault(db: Database.Database, vaultPath: string): Promise<ImportStats> {
  const stats: ImportStats = {
    people: 0, accounts: 0, projects: 0, items: 0,
    item_people: 0, todos: 0, resources: 0, edges: 0, tags: 0, embeddings: 0,
    errors: [],
  };

  // Maps for resolving references
  const personIdByName = new Map<string, string>();
  const accountIdByName = new Map<string, string>();
  const itemIdByFilename = new Map<string, string>();

  // ── Step 1: Import People ──
  console.log('Importing people...');
  const peoplePath = join(vaultPath, '35 - People');
  for (const file of listMdFiles(peoplePath)) {
    try {
      const parsed = readAndParse(peoplePath, file);
      const fm = parsed.frontmatter;
      if (fm.type !== 'person') continue;

      const id = fm.brain_id || generateId();
      const name = fm.name || basename(file, '.md');

      db.prepare(`
        INSERT OR IGNORE INTO people (id, name, title, company, email, brain_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, name, fm.title ?? null, fm.company ?? null, fm.email ?? null, fm.brain_id ?? null);

      personIdByName.set(name, id);
      stats.people++;
    } catch (e) {
      stats.errors.push(`People/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 2: Import Accounts ──
  console.log('Importing accounts...');
  const accountsPath = join(vaultPath, '20 - Areas', 'Accounts');
  for (const file of listMdFiles(accountsPath)) {
    try {
      const parsed = readAndParse(accountsPath, file);
      const fm = parsed.frontmatter;
      if (fm.type !== 'account') continue;

      const id = fm.brain_id || generateId();
      const name = fm.account || basename(file, '.md');

      db.prepare(`
        INSERT OR IGNORE INTO accounts (id, name, health, platform, brain_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, name, parseHealth(fm.health as string | undefined), fm.platform ?? null, fm.brain_id ?? null);

      accountIdByName.set(name, id);
      stats.accounts++;
    } catch (e) {
      stats.errors.push(`Accounts/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 2b: Enrich Accounts from Portfolio Overview ──
  console.log('Enriching accounts from Portfolio Overview...');
  const portfolioPath = join(vaultPath, '20 - Areas', 'Account Oversight', 'Portfolio Overview.md');
  try {
    const content = readFileSync(portfolioPath, 'utf-8');
    const parsed = parseVaultFile(content, 'Portfolio Overview.md');
    const rows = parsePortfolioTable(parsed.body);

    for (const row of rows) {
      const accountName = row.account;
      let accountId = accountIdByName.get(accountName);

      // Create account if not yet imported from account note
      if (!accountId) {
        accountId = generateId();
        db.prepare('INSERT OR IGNORE INTO accounts (id, name) VALUES (?, ?)').run(accountId, accountName);
        accountIdByName.set(accountName, accountId);
        stats.accounts++;
      }

      // Update fields from portfolio
      const health = parseHealth(row.health);
      db.prepare(`
        UPDATE accounts SET
          health = COALESCE(?, health),
          platform = COALESCE(?, platform),
          segment = COALESCE(?, segment)
        WHERE id = ?
      `).run(health, row.platform || null, row.segment || null, accountId);

      // Parse AE/CSA contacts
      const contacts = parseAeCsa(row.ae_csa);
      for (const c of contacts) {
        let personId = personIdByName.get(c.name);
        if (!personId) {
          personId = generateId();
          db.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(personId, c.name);
          personIdByName.set(c.name, personId);
        }
        db.prepare('INSERT OR IGNORE INTO account_contacts (account_id, person_id, role) VALUES (?, ?, ?)').run(accountId, personId, c.role);
      }
    }
  } catch (e) {
    stats.errors.push(`Portfolio Overview: ${(e as Error).message}`);
  }

  // ── Step 3: Import Projects ──
  console.log('Importing projects...');
  const projectsPath = join(vaultPath, '10 - Projects');
  for (const file of listMdFiles(projectsPath)) {
    try {
      const parsed = readAndParse(projectsPath, file);
      const id = parsed.frontmatter.brain_id || generateId();
      const name = basename(file, '.md');

      db.prepare('INSERT OR IGNORE INTO projects (id, name, description, brain_id) VALUES (?, ?, ?, ?)').run(
        id, name, parsed.body.substring(0, 2000), parsed.frontmatter.brain_id ?? null
      );
      stats.projects++;
    } catch (e) {
      stats.errors.push(`Projects/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 4: Import Items (meetings, emails, chats) ──
  console.log('Importing items...');
  const meetingsPath = join(vaultPath, '25 - Meetings');
  for (const file of listMdFiles(meetingsPath)) {
    try {
      const parsed = readAndParse(meetingsPath, file);
      const fm = parsed.frontmatter;
      const itemType = resolveItemType(fm);
      if (!itemType) continue; // Skip files without a recognized type

      const id = fm.brain_id || generateId();
      const title = basename(file, '.md').replace(/^\d{8}\s*-\s*/, ''); // Strip date prefix
      const fingerprint = computeFingerprint(parsed.body);

      // Resolve account
      let accountId: string | null = null;
      if (fm.account) {
        accountId = accountIdByName.get(fm.account) ?? null;
      }

      // Determine source
      let source = 'manual';
      if (itemType === 'email') source = 'm365_email';
      else if (itemType === 'chat') source = 'm365_chat';

      db.prepare(`
        INSERT OR IGNORE INTO items (id, title, item_type, date, content, account_id, source,
          email_message_id, conversation_id, chat_id, message_count, calendar_event_id, folder,
          brain_id, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, title, itemType, fm.date ?? null, parsed.body, accountId, source,
        fm.email_message_id ?? null, fm.conversation_id ?? null,
        fm.chat_id ?? null, fm.message_count ?? null,
        fm.meeting_id ?? null, fm.folder ?? null,
        fm.brain_id ?? null, fingerprint
      );

      itemIdByFilename.set(basename(file, '.md'), id);
      stats.items++;

      // ── Step 5: Link attendees/participants ──
      const people = extractPeople(fm);
      for (const name of people) {
        let personId = personIdByName.get(name);
        if (!personId) {
          personId = generateId();
          db.prepare('INSERT OR IGNORE INTO people (id, name) VALUES (?, ?)').run(personId, name);
          personIdByName.set(name, personId);
          stats.people++;
        }
        try {
          db.prepare('INSERT OR IGNORE INTO item_people (item_id, person_id) VALUES (?, ?)').run(id, personId);
          stats.item_people++;
        } catch { /* ignore constraint violations */ }
      }

      // ── Import tags ──
      if (fm.tags?.length) {
        const tagStmt = db.prepare('INSERT OR IGNORE INTO tags (id, entity_type, entity_id, tag) VALUES (?, ?, ?, ?)');
        for (const tag of fm.tags) {
          tagStmt.run(generateId(), 'item', id, tag);
          stats.tags++;
        }
      }
    } catch (e) {
      stats.errors.push(`Items/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 6: Import edges from Key Interactions tables in People notes ──
  console.log('Importing edges from People Key Interactions...');
  for (const file of listMdFiles(peoplePath)) {
    try {
      const parsed = readAndParse(peoplePath, file);
      if (parsed.frontmatter.type !== 'person') continue;

      const personName = parsed.frontmatter.name || basename(file, '.md');
      const personId = personIdByName.get(personName);
      if (!personId) continue;

      const interactions = parseInteractionTable(parsed.body);
      for (const row of interactions) {
        // Resolve item by link filename
        const itemId = itemIdByFilename.get(row.link);
        if (!itemId) continue;

        try {
          db.prepare(`
            INSERT OR IGNORE INTO edges (id, source_type, source_id, target_type, target_id, relation, confidence, evidence)
            VALUES (?, 'person', ?, 'item', ?, 'attended', 1.0, ?)
          `).run(generateId(), personId, itemId, `Key Interaction: ${row.summary}`);
          stats.edges++;
        } catch { /* ignore duplicates */ }
      }
    } catch (e) {
      stats.errors.push(`Edges/People/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 7: Import edges from Engagement Logs in Account notes ──
  console.log('Importing edges from Account Engagement Logs...');
  for (const file of listMdFiles(accountsPath)) {
    try {
      const parsed = readAndParse(accountsPath, file);
      if (parsed.frontmatter.type !== 'account') continue;

      const accountName = parsed.frontmatter.account || basename(file, '.md');
      const accountId = accountIdByName.get(accountName);
      if (!accountId) continue;

      const engagements = parseInteractionTable(parsed.body);
      for (const row of engagements) {
        const itemId = itemIdByFilename.get(row.link);
        if (!itemId) continue;

        // Also update item's account_id if not set
        db.prepare('UPDATE items SET account_id = COALESCE(account_id, ?) WHERE id = ?').run(accountId, itemId);

        try {
          db.prepare(`
            INSERT OR IGNORE INTO edges (id, source_type, source_id, target_type, target_id, relation, confidence, evidence)
            VALUES (?, 'account', ?, 'item', ?, 'about', 1.0, ?)
          `).run(generateId(), accountId, itemId, `Engagement: ${row.summary}`);
          stats.edges++;
        } catch { /* ignore duplicates */ }
      }
    } catch (e) {
      stats.errors.push(`Edges/Accounts/${file}: ${(e as Error).message}`);
    }
  }

  // ── Step 8: Import Resources ──
  console.log('Importing resources...');
  const resourcesPath = join(vaultPath, '30 - Resources');
  importResourcesRecursive(db, resourcesPath, stats);

  // ── Step 9: Set watermarks based on latest imported data ──
  console.log('Setting initial watermarks...');
  setInitialWatermarks(db);

  // ── Step 10: Generate embeddings ──
  console.log('Generating embeddings (this may take a few minutes)...');
  await generateAllEmbeddings(db, stats);

  return stats;
}

function listMdFiles(dirPath: string): string[] {
  try {
    return readdirSync(dirPath).filter(f => extname(f) === '.md').sort();
  } catch {
    return [];
  }
}

function readAndParse(dirPath: string, filename: string): ParsedVaultFile {
  const content = readFileSync(join(dirPath, filename), 'utf-8');
  return parseVaultFile(content, filename);
}

function importResourcesRecursive(db: Database.Database, dirPath: string, stats: ImportStats): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        importResourcesRecursive(db, join(dirPath, entry.name), stats);
      } else if (entry.name.endsWith('.md')) {
        try {
          const parsed = readAndParse(dirPath, entry.name);
          const id = generateId();
          const title = basename(entry.name, '.md');

          db.prepare('INSERT OR IGNORE INTO resources (id, title, content, topic) VALUES (?, ?, ?, ?)').run(
            id, title, parsed.body.substring(0, 10000), parsed.frontmatter.type === 'reference' ? (parsed.frontmatter as any).topic ?? null : null
          );
          stats.resources++;
        } catch (e) {
          stats.errors.push(`Resources/${entry.name}: ${(e as Error).message}`);
        }
      }
    }
  } catch { /* directory doesn't exist */ }
}

function setInitialWatermarks(db: Database.Database): void {
  // Email watermark: latest email date
  const latestEmail = db.prepare("SELECT MAX(date) as d FROM items WHERE item_type = 'email'").get() as { d: string | null };
  if (latestEmail.d) {
    db.prepare(`
      INSERT OR REPLACE INTO watermarks (source, last_timestamp, updated_at) VALUES ('email_done', ?, datetime('now'))
    `).run(latestEmail.d + 'T23:59:59Z');
    db.prepare(`
      INSERT OR REPLACE INTO watermarks (source, last_timestamp, updated_at) VALUES ('email_sent', ?, datetime('now'))
    `).run(latestEmail.d + 'T23:59:59Z');
  }

  // Chat watermark: latest chat date
  const latestChat = db.prepare("SELECT MAX(date) as d FROM items WHERE item_type = 'chat'").get() as { d: string | null };
  if (latestChat.d) {
    db.prepare(`
      INSERT OR REPLACE INTO watermarks (source, last_timestamp, updated_at) VALUES ('chat', ?, datetime('now'))
    `).run(latestChat.d + 'T23:59:59Z');
  }
}

async function generateAllEmbeddings(db: Database.Database, stats: ImportStats): Promise<void> {
  // Collect all entities that need embeddings
  const entries: Array<{ id: string; text: string }> = [];

  // Items
  const items = db.prepare('SELECT id, title, content FROM items').all() as Array<{ id: string; title: string; content: string }>;
  for (const item of items) {
    entries.push({ id: item.id, text: `${item.title}\n${item.content}`.substring(0, 2000) });
  }

  // People
  const people = db.prepare('SELECT id, name, title, company, background FROM people').all() as Array<{
    id: string; name: string; title: string | null; company: string | null; background: string | null;
  }>;
  for (const p of people) {
    const text = [p.name, p.title, p.company, p.background].filter(Boolean).join(' ');
    entries.push({ id: p.id, text });

    // Also update search index for people
    db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(p.id);
    db.prepare('INSERT INTO search_fts (entity_type, entity_id, title, content, tags_text) VALUES (?, ?, ?, ?, ?)').run(
      'person', p.id, p.name, text, ''
    );
    db.prepare(`
      INSERT OR REPLACE INTO search_meta (entity_id, entity_type, title, updated_at) VALUES (?, 'person', ?, datetime('now'))
    `).run(p.id, p.name);
  }

  // Accounts
  const accounts = db.prepare('SELECT id, name, overview, notes FROM accounts').all() as Array<{
    id: string; name: string; overview: string | null; notes: string | null;
  }>;
  for (const a of accounts) {
    const text = [a.name, a.overview, a.notes].filter(Boolean).join(' ');
    entries.push({ id: a.id, text });

    db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(a.id);
    db.prepare('INSERT INTO search_fts (entity_type, entity_id, title, content, tags_text) VALUES (?, ?, ?, ?, ?)').run(
      'account', a.id, a.name, text, ''
    );
    db.prepare(`
      INSERT OR REPLACE INTO search_meta (entity_id, entity_type, title, updated_at) VALUES (?, 'account', ?, datetime('now'))
    `).run(a.id, a.name);
  }

  // Update FTS for items
  for (const item of items) {
    db.prepare('DELETE FROM search_fts WHERE entity_id = ?').run(item.id);
    db.prepare('INSERT INTO search_fts (entity_type, entity_id, title, content, tags_text) VALUES (?, ?, ?, ?, ?)').run(
      'item', item.id, item.title, item.content, ''
    );
    const dateRow = db.prepare('SELECT date FROM items WHERE id = ?').get(item.id) as { date: string | null };
    db.prepare(`
      INSERT OR REPLACE INTO search_meta (entity_id, entity_type, title, date, updated_at) VALUES (?, 'item', ?, ?, datetime('now'))
    `).run(item.id, item.title, dateRow?.date ?? null);
  }

  // Generate embeddings in batches
  console.log(`Generating embeddings for ${entries.length} entities...`);
  const BATCH_SIZE = 32;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => e.text);
    const embeddings = await embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      const buf = Buffer.from(embeddings[j].buffer);
      db.prepare('INSERT OR REPLACE INTO search_vec (entity_id, embedding) VALUES (?, ?)').run(batch[j].id, buf);
      stats.embeddings++;
    }

    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= entries.length) {
      console.log(`  ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} embeddings generated`);
    }
  }
}
