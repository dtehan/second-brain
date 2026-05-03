#!/usr/bin/env npx tsx
/**
 * Dedup people records in brain2.
 *
 * Two patterns:
 *   1. Parenthetical shells: "Name (Company)" → merge into "Name"
 *   2. Name variants: manual mapping (typos, nicknames, full/short names)
 *
 * For each pair: reassign all FK references from shell → canonical, then delete shell.
 * Runs in a single transaction so it's all-or-nothing.
 *
 * Usage:
 *   npx tsx scripts/dedup-people.ts          # dry run (default)
 *   npx tsx scripts/dedup-people.ts --apply  # actually execute
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = process.env['BRAIN2_DB'] || `${process.env['HOME']}/Code/brain2/data/brain2.db`;
const DRY_RUN = !process.argv.includes('--apply');

// ── Manual name-variant merges (shell → canonical) ──
// These are non-parenthetical duplicates that can't be auto-detected.
const MANUAL_MERGES: [string, string][] = [
  // [shell name, canonical name]
  ['Andy Margonis', 'Andrew Margonis'],
  ['Andrew Gilbert', 'Andy Gilbert'],          // Andy has the data? Check below
  ['Gregory Bethardy', 'Greg Bethardy'],       // Greg may be the empty one — we'll pick whoever has data
  ['Chis Milan', 'Chris Milan'],               // typo
  ['Kevin resney', 'Kevin Resney'],            // case variant
  ['Jen Mask', 'Jennifer Mask'],
  ['Jen Wray', 'Jennifer Wray'],
  ['Christopher McVey', 'Chris McVey'],
  ['Christopher Weaver', 'Chris Weaver'],      // Chris Weaver has the email
  ['Josue Daniel Herrera', 'Daniel Herrera'],
  ['Moin Iftekhar', 'Iftekhar Moin'],          // reversed name
  ['Pablo Escobar De La Oliva', 'Pablo Escobar de la Oliva'],  // case variant — the lowercase one has email
];

interface Person {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  background: string | null;
  notes: string | null;
}

function main() {
  const db = new Database(DB_PATH);
  sqliteVec.load(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --apply to execute)' : 'APPLYING CHANGES'}\n`);

  // Build merge list: [shellId, canonicalId][]
  const mergePairs: { shell: Person; canonical: Person }[] = [];

  // ── Pattern 1: Parenthetical shells ──
  const shells = db.prepare(`
    SELECT * FROM people WHERE name LIKE '% (%)'
  `).all() as Person[];

  for (const shell of shells) {
    // Extract clean name: "Angela Brewer (Dell)" → "Angela Brewer"
    const match = shell.name.match(/^(.+?)\s*\(/);
    if (!match) continue;
    const cleanName = match[1].trim();

    const canonical = db.prepare('SELECT * FROM people WHERE name = ?').get(cleanName) as Person | undefined;
    if (!canonical) {
      console.log(`  SKIP: "${shell.name}" — no canonical "${cleanName}" found`);
      continue;
    }
    mergePairs.push({ shell, canonical });
  }

  // ── Pattern 2: Manual variant merges ──
  for (const [shellName, canonicalName] of MANUAL_MERGES) {
    const shell = db.prepare('SELECT * FROM people WHERE name = ?').get(shellName) as Person | undefined;
    const canonical = db.prepare('SELECT * FROM people WHERE name = ?').get(canonicalName) as Person | undefined;

    if (!shell) {
      console.log(`  SKIP manual: "${shellName}" not found`);
      continue;
    }
    if (!canonical) {
      console.log(`  SKIP manual: canonical "${canonicalName}" not found`);
      continue;
    }

    // For manual merges, pick the one with more data as canonical
    // If the "shell" actually has more data, swap them
    const shellDataCount = [shell.title, shell.company, shell.email, shell.phone, shell.background].filter(Boolean).length;
    const canonicalDataCount = [canonical.title, canonical.company, canonical.email, canonical.phone, canonical.background].filter(Boolean).length;

    if (shellDataCount > canonicalDataCount) {
      console.log(`  SWAP: "${shellName}" has more data than "${canonicalName}" — swapping`);
      mergePairs.push({ shell: canonical, canonical: shell });
    } else {
      mergePairs.push({ shell, canonical });
    }
  }

  console.log(`\nFound ${mergePairs.length} merge pairs\n`);

  // ── Prepare statements ──
  const stmts = {
    // Merge fields from shell into canonical (only fill nulls)
    mergeFields: db.prepare(`
      UPDATE people SET
        title = COALESCE(title, ?),
        company = COALESCE(company, ?),
        email = COALESCE(email, ?),
        phone = COALESCE(phone, ?),
        background = COALESCE(background, ?),
        notes = COALESCE(notes, ?)
      WHERE id = ?
    `),

    // Reassign item_people (skip conflicts — canonical already linked)
    reassignItemPeople: db.prepare(`
      UPDATE OR IGNORE item_people SET person_id = ? WHERE person_id = ?
    `),
    deleteOrphanedItemPeople: db.prepare(`
      DELETE FROM item_people WHERE person_id = ?
    `),

    // Reassign account_contacts
    reassignAccountContacts: db.prepare(`
      UPDATE OR IGNORE account_contacts SET person_id = ? WHERE person_id = ?
    `),
    deleteOrphanedAccountContacts: db.prepare(`
      DELETE FROM account_contacts WHERE person_id = ?
    `),

    // Reassign todos
    reassignTodos: db.prepare(`
      UPDATE todos SET assigned_by_id = ? WHERE assigned_by_id = ?
    `),

    // Reassign edges (source)
    reassignEdgesSource: db.prepare(`
      UPDATE OR IGNORE edges SET source_id = ? WHERE source_type = 'person' AND source_id = ?
    `),
    deleteOrphanedEdgesSource: db.prepare(`
      DELETE FROM edges WHERE source_type = 'person' AND source_id = ?
    `),

    // Reassign edges (target)
    reassignEdgesTarget: db.prepare(`
      UPDATE OR IGNORE edges SET target_id = ? WHERE target_type = 'person' AND target_id = ?
    `),
    deleteOrphanedEdgesTarget: db.prepare(`
      DELETE FROM edges WHERE target_type = 'person' AND target_id = ?
    `),

    // Reassign tags
    reassignTags: db.prepare(`
      UPDATE OR IGNORE tags SET entity_id = ? WHERE entity_type = 'person' AND entity_id = ?
    `),
    deleteOrphanedTags: db.prepare(`
      DELETE FROM tags WHERE entity_type = 'person' AND entity_id = ?
    `),

    // Reassign syntheses
    reassignSyntheses: db.prepare(`
      UPDATE syntheses SET scope = ? WHERE synthesis_type = 'person_summary' AND scope = ?
    `),

    // Clean search indexes
    deleteSearchFts: db.prepare(`
      DELETE FROM search_fts WHERE entity_type = 'person' AND entity_id = ?
    `),
    deleteSearchMeta: db.prepare(`
      DELETE FROM search_meta WHERE entity_type = 'person' AND entity_id = ?
    `),
    deleteSearchVec: db.prepare(`
      DELETE FROM search_vec WHERE entity_id = ?
    `),

    // Delete the shell person
    deletePerson: db.prepare(`
      DELETE FROM people WHERE id = ?
    `),

    // Count references for reporting
    countItemPeople: db.prepare(`SELECT COUNT(*) as cnt FROM item_people WHERE person_id = ?`),
    countAccountContacts: db.prepare(`SELECT COUNT(*) as cnt FROM account_contacts WHERE person_id = ?`),
  };

  // ── Execute merges ──
  let totalMerged = 0;
  let totalItemPeopleReassigned = 0;

  const execute = db.transaction(() => {
    for (const { shell, canonical } of mergePairs) {
      const ipCount = (stmts.countItemPeople.get(shell.id) as { cnt: number }).cnt;
      const acCount = (stmts.countAccountContacts.get(shell.id) as { cnt: number }).cnt;

      console.log(`  MERGE: "${shell.name}" (${shell.id}) → "${canonical.name}" (${canonical.id})` +
        `  [${ipCount} items, ${acCount} contacts]`);

      // 1. Merge any non-null fields from shell into canonical
      stmts.mergeFields.run(
        shell.title, shell.company, shell.email, shell.phone,
        shell.background, shell.notes, canonical.id
      );

      // 2. Reassign all references
      stmts.reassignItemPeople.run(canonical.id, shell.id);
      stmts.deleteOrphanedItemPeople.run(shell.id);  // delete conflicts

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

      // 3. Clean search indexes for shell
      stmts.deleteSearchFts.run(shell.id);
      stmts.deleteSearchMeta.run(shell.id);
      stmts.deleteSearchVec.run(shell.id);

      // 4. Delete the shell person (cascading FKs handle any remaining refs)
      stmts.deletePerson.run(shell.id);

      totalMerged++;
      totalItemPeopleReassigned += ipCount;
    }
  });

  if (DRY_RUN) {
    console.log('--- DRY RUN — showing what would happen ---\n');
    for (const { shell, canonical } of mergePairs) {
      const ipCount = (stmts.countItemPeople.get(shell.id) as { cnt: number }).cnt;
      const acCount = (stmts.countAccountContacts.get(shell.id) as { cnt: number }).cnt;
      console.log(`  WOULD MERGE: "${shell.name}" → "${canonical.name}"  [${ipCount} items, ${acCount} contacts]`);
      totalMerged++;
      totalItemPeopleReassigned += ipCount;
    }
  } else {
    execute();
  }

  // ── Summary ──
  const remaining = (db.prepare('SELECT COUNT(*) as cnt FROM people').get() as { cnt: number }).cnt;
  console.log(`\n=== Summary ===`);
  console.log(`Pairs merged: ${totalMerged}`);
  console.log(`Item-people links reassigned: ${totalItemPeopleReassigned}`);
  console.log(`People remaining: ${remaining}`);

  db.close();
}

main();
