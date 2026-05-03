#!/usr/bin/env npx tsx
/**
 * Phase 2 cleanup: handle remaining "Name (Company)" shells that had no
 * auto-matching canonical record in the first dedup pass.
 *
 * Three actions:
 *   1. MERGE  — name variants with an existing canonical (e.g. "Bruno LoMonaco" → "Bruno Lo Monaco")
 *   2. DELETE — non-person records (distribution lists)
 *   3. RENAME — strip parenthetical, move company to the company field
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphan-shells.ts          # dry run
 *   npx tsx scripts/cleanup-orphan-shells.ts --apply  # execute
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = process.env['BRAIN2_DB'] || `${process.env['HOME']}/Code/brain2/data/brain2.db`;
const DRY_RUN = !process.argv.includes('--apply');

// ── Name variant merges (shell → canonical) ──
const VARIANT_MERGES: [string, string][] = [
  ['Christopher Alvey (Teradata)', 'Chris Alvey'],
  ['Bruno LoMonaco (Teradata)', 'Bruno Lo Monaco'],
  ['PankajVinod Purandare (Teradata)', 'Pankaj Purandare'],
  ['NathanG-TD (Teradata)', 'Nathan Green'],
  ['Moin Iftekhar (Evernorth)', 'Iftekhar Moin'],
];

// ── Non-person records to delete ──
const DELETE_NAMES = [
  'AMS Sales Teams (broad distribution)',
  'Revenue Enablement (WW GTM)',
];

// ── First-name-only shells to keep parenthetical as a note ──
// These have no last name, so stripping the company loses useful context.
// We rename them but store the original parenthetical as background.
const FIRST_NAME_ONLY = new Set([
  'Christina (Boeing)',
  'Ian (Boeing)',
  'Leila (Boeing)',
  'Preston (Boeing)',
  'Eric (TD)',
  'Kapil (Wisdom AI)',
  'Maneesh (Wisdom AI)',
  'Nathan (Wisdom AI)',
]);

function main() {
  const db = new Database(DB_PATH);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --apply to execute)' : 'APPLYING CHANGES'}\n`);

  // Prepared statements
  const stmts = {
    getPerson: db.prepare('SELECT id, name, company, title, email, phone, background, notes FROM people WHERE name = ?'),
    countItemPeople: db.prepare('SELECT COUNT(*) as cnt FROM item_people WHERE person_id = ?'),

    // Merge: reassign refs from shell → canonical, then delete shell
    reassignItemPeople: db.prepare('UPDATE OR IGNORE item_people SET person_id = ? WHERE person_id = ?'),
    deleteOrphanedItemPeople: db.prepare('DELETE FROM item_people WHERE person_id = ?'),
    reassignAccountContacts: db.prepare('UPDATE OR IGNORE account_contacts SET person_id = ? WHERE person_id = ?'),
    deleteOrphanedAccountContacts: db.prepare('DELETE FROM account_contacts WHERE person_id = ?'),
    reassignTodos: db.prepare('UPDATE todos SET assigned_by_id = ? WHERE assigned_by_id = ?'),
    reassignEdgesSource: db.prepare('UPDATE OR IGNORE edges SET source_id = ? WHERE source_type = \'person\' AND source_id = ?'),
    deleteOrphanedEdgesSource: db.prepare('DELETE FROM edges WHERE source_type = \'person\' AND source_id = ?'),
    reassignEdgesTarget: db.prepare('UPDATE OR IGNORE edges SET target_id = ? WHERE target_type = \'person\' AND target_id = ?'),
    deleteOrphanedEdgesTarget: db.prepare('DELETE FROM edges WHERE target_type = \'person\' AND target_id = ?'),
    reassignTags: db.prepare('UPDATE OR IGNORE tags SET entity_id = ? WHERE entity_type = \'person\' AND entity_id = ?'),
    deleteOrphanedTags: db.prepare('DELETE FROM tags WHERE entity_type = \'person\' AND entity_id = ?'),
    reassignSyntheses: db.prepare('UPDATE syntheses SET scope = ? WHERE synthesis_type = \'person_summary\' AND scope = ?'),
    mergeFields: db.prepare('UPDATE people SET title = COALESCE(title, ?), company = COALESCE(company, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?), background = COALESCE(background, ?), notes = COALESCE(notes, ?) WHERE id = ?'),

    // Delete: remove person and all refs
    deleteSearchFts: db.prepare('DELETE FROM search_fts WHERE entity_type = \'person\' AND entity_id = ?'),
    deleteSearchMeta: db.prepare('DELETE FROM search_meta WHERE entity_type = \'person\' AND entity_id = ?'),
    deleteSearchVec: db.prepare('DELETE FROM search_vec WHERE entity_id = ?'),
    deletePerson: db.prepare('DELETE FROM people WHERE id = ?'),

    // Rename: update name and company
    renamePerson: db.prepare('UPDATE people SET name = ?, company = COALESCE(company, ?) WHERE id = ?'),
    setBackground: db.prepare('UPDATE people SET background = COALESCE(background, ?) WHERE id = ?'),
  };

  type Person = { id: string; name: string; company: string | null; title: string | null; email: string | null; phone: string | null; background: string | null; notes: string | null };

  function mergePerson(shell: Person, canonical: Person) {
    const ipCount = (stmts.countItemPeople.get(shell.id) as { cnt: number }).cnt;
    console.log(`  MERGE: "${shell.name}" → "${canonical.name}"  [${ipCount} items]`);

    if (DRY_RUN) return;

    stmts.mergeFields.run(shell.title, shell.company, shell.email, shell.phone, shell.background, shell.notes, canonical.id);
    stmts.reassignItemPeople.run(canonical.id, shell.id);
    stmts.deleteOrphanedItemPeople.run(shell.id);
    stmts.reassignAccountContacts.run(canonical.id, shell.id);
    stmts.deleteOrphanedAccountContacts.run(shell.id);
    stmts.reassignTodos.run(canonical.id, shell.id);
    stmts.reassignEdgesSource.run(canonical.id, shell.id);
    stmts.deleteOrphanedEdgesSource.run(shell.id);
    stmts.reassignEdgesTarget.run(canonical.id, shell.id);
    stmts.deleteOrphanedEdgesTarget.run(shell.id);
    stmts.reassignTags.run(canonical.id, shell.id);
    stmts.deleteOrphanedTags.run(shell.id);
    stmts.reassignSyntheses.run(canonical.id, shell.id);
    stmts.deleteSearchFts.run(shell.id);
    stmts.deleteSearchMeta.run(shell.id);
    stmts.deleteSearchVec.run(shell.id);
    stmts.deletePerson.run(shell.id);
  }

  function deletePerson(person: Person) {
    const ipCount = (stmts.countItemPeople.get(person.id) as { cnt: number }).cnt;
    console.log(`  DELETE: "${person.name}"  [${ipCount} items — links will be dropped]`);

    if (DRY_RUN) return;

    stmts.deleteSearchFts.run(person.id);
    stmts.deleteSearchMeta.run(person.id);
    stmts.deleteSearchVec.run(person.id);
    stmts.deletePerson.run(person.id);  // cascades item_people, account_contacts
  }

  function renamePerson(person: Person, cleanName: string, company: string) {
    console.log(`  RENAME: "${person.name}" → "${cleanName}" (company: ${company})`);

    if (DRY_RUN) return;

    stmts.renamePerson.run(cleanName, company, person.id);

    // For first-name-only, store original name as background for context
    if (FIRST_NAME_ONLY.has(person.name)) {
      stmts.setBackground.run(`Originally ingested as "${person.name}"`, person.id);
    }
  }

  let merged = 0, deleted = 0, renamed = 0;

  const execute = db.transaction(() => {
    // 1. Variant merges
    console.log('--- Variant Merges ---');
    for (const [shellName, canonicalName] of VARIANT_MERGES) {
      const shell = stmts.getPerson.get(shellName) as Person | undefined;
      const canonical = stmts.getPerson.get(canonicalName) as Person | undefined;
      if (!shell) { console.log(`  SKIP: "${shellName}" not found`); continue; }
      if (!canonical) { console.log(`  SKIP: canonical "${canonicalName}" not found`); continue; }
      mergePerson(shell, canonical);
      merged++;
    }

    // 2. Non-person deletes
    console.log('\n--- Non-Person Deletes ---');
    for (const name of DELETE_NAMES) {
      const person = stmts.getPerson.get(name) as Person | undefined;
      if (!person) { console.log(`  SKIP: "${name}" not found`); continue; }
      deletePerson(person);
      deleted++;
    }

    // 3. Rename remaining shells
    console.log('\n--- Renames ---');
    const remaining = db.prepare("SELECT id, name, company, title, email, phone, background, notes FROM people WHERE name LIKE '% (%)'").all() as Person[];
    for (const person of remaining) {
      const match = person.name.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (!match) continue;

      const cleanName = match[1].trim();
      const company = match[2].trim();

      // Check if clean name already exists (would cause UNIQUE conflict)
      const existing = stmts.getPerson.get(cleanName) as Person | undefined;
      if (existing) {
        // Merge into existing instead
        mergePerson(person, existing);
        merged++;
      } else {
        renamePerson(person, cleanName, company);
        renamed++;
      }
    }
  });

  if (DRY_RUN) {
    // Run outside transaction for dry run (just print, no changes)
    console.log('--- Variant Merges ---');
    for (const [shellName, canonicalName] of VARIANT_MERGES) {
      const shell = stmts.getPerson.get(shellName) as Person | undefined;
      const canonical = stmts.getPerson.get(canonicalName) as Person | undefined;
      if (!shell) { console.log(`  SKIP: "${shellName}" not found`); continue; }
      if (!canonical) { console.log(`  SKIP: canonical "${canonicalName}" not found`); continue; }
      mergePerson(shell, canonical);
      merged++;
    }

    console.log('\n--- Non-Person Deletes ---');
    for (const name of DELETE_NAMES) {
      const person = stmts.getPerson.get(name) as Person | undefined;
      if (!person) { console.log(`  SKIP: "${name}" not found`); continue; }
      deletePerson(person);
      deleted++;
    }

    console.log('\n--- Renames ---');
    const remaining = db.prepare("SELECT id, name, company, title, email, phone, background, notes FROM people WHERE name LIKE '% (%)'").all() as Person[];
    for (const person of remaining) {
      const match = person.name.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (!match) continue;
      const cleanName = match[1].trim();
      const company = match[2].trim();
      const existing = stmts.getPerson.get(cleanName) as Person | undefined;
      if (existing) {
        console.log(`  WOULD MERGE (name collision): "${person.name}" → "${existing.name}"`);
        merged++;
      } else {
        renamePerson(person, cleanName, company);
        renamed++;
      }
    }
  } else {
    execute();
  }

  // Summary
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM people').get() as { cnt: number }).cnt;
  const stillParenthetical = (db.prepare("SELECT COUNT(*) as cnt FROM people WHERE name LIKE '% (%)'").get() as { cnt: number }).cnt;
  console.log(`\n=== Summary ===`);
  console.log(`Merged: ${merged}`);
  console.log(`Deleted: ${deleted}`);
  console.log(`Renamed: ${renamed}`);
  console.log(`People remaining: ${total}`);
  console.log(`Still parenthetical: ${stillParenthetical}`);

  db.close();
}

main();
