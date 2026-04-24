# brain2 — Personal Knowledge Management System

## Overview

brain2 is a database-first personal knowledge management system with a local MCP server.
All data lives in SQLite at `~/.brain2/brain2.db`. Claude accesses it via 28 MCP tools.

## Quick Reference

### Running the server
```bash
npx tsx src/index.ts           # Start MCP server (stdio)
npx tsx src/index.ts --import-vault ~/code/brain/second-brain  # Run vault migration
```

### Testing
```bash
npm test                       # Run all tests (vitest)
npx tsc --noEmit              # Type-check
```

### Architecture
- **Database**: SQLite + sqlite-vec (384-dim vectors) + FTS5. Single file at `~/.brain2/brain2.db`
- **MCP Server**: TypeScript, @modelcontextprotocol/sdk, stdio transport
- **Embeddings**: Local via @xenova/transformers (all-MiniLM-L6-v2). Cached at `~/.brain2/models/`
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
- Dedup via `email_message_id`, `chat_id`, `calendar_event_id`, or `fingerprint`.
- All content is searchable via `brain_search` (hybrid FTS5 + vector similarity).
