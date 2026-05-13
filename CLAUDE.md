# brain2 — Personal Knowledge Management System

## Overview

brain2 is a database-first personal knowledge management system with a local MCP server.
All data lives in SQLite at `data/brain2.db`. Claude accesses it via 26 MCP tools.

## Quick Reference

### Running the server
```bash
npx tsx src/index.ts           # Start MCP server (stdio)
npx tsx src/index.ts --import-vault <path>  # Run vault migration
```

### Testing
```bash
npm test                       # Run all tests (vitest)
npx tsc --noEmit              # Type-check
```

### Architecture
- **Database**: SQLite + sqlite-vec (384-dim vectors) + FTS5. Single file at `data/brain2.db`
- **MCP Server**: TypeScript, @modelcontextprotocol/sdk, stdio transport
- **Embeddings**: Local via @xenova/transformers (all-MiniLM-L6-v2). Cached at `data/models/`
- **Dreaming**: Claude Code CLI skills call brain2 MCP tools. No LLM calls from the server.

### Entity Types
- **items**: meetings, emails, chats, notes (unified table)
- **people**: one row per person, with contact info
- **accounts**: customer accounts with health/platform/segment
- **account_contacts**: people linked to accounts with roles (ae, csa, se, tam, etc.)
- **projects**: active work with a finish line
- **todos**: action items with priority, due date, source, assignee
- **ideas**: captured ideas
- **resources**: reference material

### Knowledge Graph
- **item_people**: who attended which meeting/email/chat
- **account_contacts**: who is associated with which account and in what role
- **edges**: generic relationships between any entities (mentions, related_to, attended, about, etc.)
- **tags**: flexible tagging on any entity

### Ingestion Pattern (watermark-based)
1. `brain_get_watermark(source)` — get last-processed timestamp
2. Fetch only items newer than watermark from M365
3. Process and ingest via `brain_ingest_*` tools
4. `brain_set_watermark(source, timestamp)` — advance watermark

### Key Conventions
- People are identified by `name` (unique). Use `brain_upsert_person` — it merges without overwriting existing non-null fields.
- Accounts use `account_contacts` for team roles, not hardcoded columns.
- Dedup via `email_message_id`, `chat_id`, `calendar_event_id`, or `fingerprint`. All four are UNIQUE (chat_id and calendar_event_id are partial unique indexes — multiple NULLs allowed).
- `brain_ingest_email` / `brain_ingest_chat` / `brain_ingest_meeting` are idempotent on their dedup key: re-ingesting returns the existing id and updates the row in place. For chat, an incoming `message_count` lower than the stored one is silently skipped (returned `action: "skipped"`) to guard against out-of-order replays.
- Cleanup: `brain_merge_items(keep_id, drop_id)` re-targets every reference to `drop_id` (item_people, edges, todos, syntheses, search indexes) and deletes the row. Use it for any duplicates left behind by the pre-v2 ingest path.
- All content is searchable via `brain_search` (hybrid FTS5 + vector similarity).

### Skills
`skills/` — Prompt skill files for Claude Desktop and Claude Code CLI.

| File | Purpose |
|---|---|
| `brain-sync.md` | Sync M365 emails with verification, then dream + lint (Teams chat unavailable — chat_message_search times out) |
| `brain-day.md` | Daily prep brief — meetings (with account context) + overdue todos for today, tomorrow, or a named weekday |
| `brain-note.md` | File user notes by matching them to calendar meetings |
| `brain-extract.md` | Extract reusable knowledge from work sessions into new skills |

### Invocation model

All skills are invoked manually from Claude Desktop (where the brain2 and M365 MCPs are configured). There are no scheduled jobs — `brain-sync` is run when the user wants to catch up the brain, `brain-day` when they want a day brief, `lint` when they want maintenance, etc.
