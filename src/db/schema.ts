import type Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
-- ============================================================
-- brain2 SQLite Schema v1
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Core Entity Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS items (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    item_type       TEXT NOT NULL CHECK (item_type IN ('meeting', 'email', 'chat', 'note')),
    date            TEXT,
    content         TEXT NOT NULL,
    summary         TEXT,
    meeting_type    TEXT CHECK (meeting_type IN ('account', 'internal', '1:1', 'cross-functional', NULL)),
    account_id      TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'm365_email', 'm365_chat', 'm365_calendar')),
    -- Dedup fields
    email_message_id TEXT UNIQUE,
    conversation_id  TEXT,
    chat_id          TEXT,
    message_count    INTEGER,
    calendar_event_id TEXT,
    folder           TEXT CHECK (folder IN ('done', 'sent', NULL)),
    -- Provenance
    brain_id         TEXT,
    fingerprint      TEXT UNIQUE,
    -- Timestamps
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    title       TEXT,
    company     TEXT,
    email       TEXT,
    phone       TEXT,
    background  TEXT,
    notes       TEXT,
    brain_id    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    health      TEXT CHECK (health IN ('green', 'yellow', 'red', NULL)),
    platform    TEXT,
    segment     TEXT,
    arr         TEXT,
    overview    TEXT,
    notes       TEXT,
    brain_id    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'someday', 'archived')),
    description TEXT,
    brain_id    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
    id              TEXT PRIMARY KEY,
    text            TEXT NOT NULL,
    done            INTEGER NOT NULL DEFAULT 0,
    priority        TEXT CHECK (priority IN ('highest', 'high', 'normal', 'low', NULL)),
    due_date        TEXT,
    source_item_id  TEXT REFERENCES items(id) ON DELETE SET NULL,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    assigned_by_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ideas (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'explored', 'archived')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    source_url  TEXT,
    topic       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Knowledge Graph Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS item_people (
    item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, person_id)
);

CREATE TABLE IF NOT EXISTS account_contacts (
    account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    person_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    PRIMARY KEY (account_id, person_id, role)
);

CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'person', 'account', 'project', 'idea', 'resource')),
    entity_id   TEXT NOT NULL,
    tag         TEXT NOT NULL,
    UNIQUE(entity_type, entity_id, tag)
);

CREATE TABLE IF NOT EXISTS edges (
    id          TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    relation    TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 1.0,
    evidence    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_type, source_id, target_type, target_id, relation)
);

-- ============================================================
-- Search Layer
-- ============================================================

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    entity_type,
    entity_id,
    title,
    content,
    tags_text,
    tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS search_meta (
    entity_id   TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    title       TEXT,
    date        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Watermarks
-- ============================================================

CREATE TABLE IF NOT EXISTS watermarks (
    source          TEXT PRIMARY KEY,
    last_timestamp  TEXT,
    last_id         TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- Synthesis Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS syntheses (
    id              TEXT PRIMARY KEY,
    synthesis_type  TEXT NOT NULL CHECK (synthesis_type IN ('person_summary', 'account_health', 'weekly_digest', 'connection_discovery', 'theme_cluster')),
    scope           TEXT,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    source_ids      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT,
    superseded_by   TEXT REFERENCES syntheses(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id              TEXT PRIMARY KEY,
    item_a_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    item_b_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    similarity      REAL NOT NULL,
    shared_entities TEXT,
    explanation     TEXT,
    discovered_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(item_a_id, item_b_id)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_items_date ON items(date);
CREATE INDEX IF NOT EXISTS idx_items_item_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_account ON items(account_id);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
CREATE INDEX IF NOT EXISTS idx_items_email_id ON items(email_message_id);
CREATE INDEX IF NOT EXISTS idx_items_chat_id ON items(chat_id);
CREATE INDEX IF NOT EXISTS idx_items_calendar_id ON items(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_items_fingerprint ON items(fingerprint);

CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
CREATE INDEX IF NOT EXISTS idx_people_company ON people(company);

CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
CREATE INDEX IF NOT EXISTS idx_accounts_health ON accounts(health);

CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id);
CREATE INDEX IF NOT EXISTS idx_todos_assigned ON todos(assigned_by_id);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_entity ON tags(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);

CREATE INDEX IF NOT EXISTS idx_search_meta_type ON search_meta(entity_type);

CREATE INDEX IF NOT EXISTS idx_syntheses_type ON syntheses(synthesis_type, scope);

-- ============================================================
-- Triggers for updated_at
-- ============================================================

CREATE TRIGGER IF NOT EXISTS items_updated AFTER UPDATE ON items
BEGIN UPDATE items SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS people_updated AFTER UPDATE ON people
BEGIN UPDATE people SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS accounts_updated AFTER UPDATE ON accounts
BEGIN UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS projects_updated AFTER UPDATE ON projects
BEGIN UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS todos_updated AFTER UPDATE ON todos
BEGIN UPDATE todos SET updated_at = datetime('now') WHERE id = NEW.id; END;
`;

export function initializeSchema(db: Database.Database): void {
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  let currentVersion = 0;
  if (hasVersionTable) {
    const row = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined;
    currentVersion = row?.version ?? 0;
  }

  if (currentVersion >= SCHEMA_VERSION) return;

  // Apply (or re-apply, idempotently) the base schema.
  db.exec(SCHEMA_SQL);

  if (currentVersion < 1) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    currentVersion = 1;
  }

  for (const m of MIGRATIONS) {
    if (m.version > currentVersion) {
      m.fn(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
      currentVersion = m.version;
    }
  }
}

export { SCHEMA_VERSION };
