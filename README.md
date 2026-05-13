# brain2

Database-first personal knowledge management system powered by a local [MCP](https://modelcontextprotocol.io) server. All data lives in a single SQLite file. Claude accesses it via 29 MCP tools through Claude Desktop or Claude Code.

Replaces an earlier Obsidian vault-based system with structured storage, semantic search, and automated ingestion pipelines.

## Features

- **Unified knowledge store** — meetings, emails, chats, notes, people, accounts, projects, todos, ideas, and resources in one database
- **Knowledge graph** — flexible edges between any entities (mentions, related_to, attended, about, etc.)
- **Hybrid search** — FTS5 full-text search + sqlite-vec vector similarity (384-dim, all-MiniLM-L6-v2)
- **Watermark-based ingestion** — incremental M365 email sync with dedup (Teams chat sync currently unavailable)
- **Dreaming** — connection building, person summaries, account health assessment, and theme discovery — runs at the end of each sync
- **Daily digest** — morning briefing with meetings (account context, open threads, heads-up) and overdue todos

## Requirements

- Node.js 20+
- Claude Desktop or Claude Code (for MCP integration)
- Microsoft 365 MCP (for email/chat ingestion)

## Setup

```bash
npm install
```

### Configure MCP

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`) or Claude Code config (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "brain2": {
      "command": "npx",
      "args": ["tsx", "/path/to/brain2/src/index.ts"],
      "env": {
        "BRAIN2_DB": "/path/to/brain2/data/brain2.db"
      }
    }
  }
}
```

### Import from Obsidian vault (optional)

```bash
npx tsx src/index.ts --import-vault ~/path/to/obsidian-vault
```

Parses frontmatter, tables, and imports all entity types (meetings, emails, chats, people, accounts, projects, todos, resources).

## Usage

```bash
npx tsx src/index.ts          # Start MCP server (stdio)
npm test                      # Run tests
npx tsc --noEmit              # Type-check
```

Once the server is running, Claude can use all 29 tools and 4 skill prompts through natural conversation:

- *"What's happening with the Dell account?"* — searches items, gets account profile and contacts
- *"Process my emails"* — runs the email ingestion pipeline
- *"Who have I met with most this month?"* — queries the knowledge graph
- *"Add a todo to follow up with Sarah by Friday"* — creates a todo with due date

## Architecture

```
data/brain2.db               SQLite + sqlite-vec + FTS5
data/models/                 Cached embedding model (all-MiniLM-L6-v2)

src/
  index.ts                   Entry point (stdio MCP transport + vault migration CLI)
  server.ts                  MCP server setup and tool registration
  db/
    connection.ts            SQLite connection with sqlite-vec extension
    schema.ts                Table definitions and migrations
  tools/
    ingest.ts                Ingest meetings, emails, chats, notes (5 tools)
    entities.ts              Upsert people/accounts/projects, manage todos (6 tools)
    query.ts                 Get/list items, people, accounts (6 tools)
    search.ts                Hybrid FTS5 + vector search (1 tool)
    graph.ts                 Edges and knowledge graph traversal (3 tools)
    synthesis.ts             Save/retrieve dreaming syntheses (2 tools)
    watermark.ts             Ingestion watermark tracking (3 tools)
    stats.ts                 Database stats and portfolio view (2 tools)
  embeddings/                Local embedding generation via @xenova/transformers
  search/                    Hybrid search ranking logic
  migration/                 Obsidian vault import
  utils/                     Hashing, ID generation

  prompts.ts                 Registers skills as MCP prompts for Claude Desktop

skills/                      Skill prompts (MCP prompts + Claude Code skills)
  brain-sync.md              Sync M365 → brain2 (email + chat) + dream + lint
  brain-day.md               Daily prep brief
  brain-note.md              File user notes to calendar meetings
  brain-extract.md           Extract reusable knowledge from work sessions
```

## Skills

Skills are available as **MCP prompts** in Claude Desktop (via the `/` menu) and as **Claude Code skills** (via `~/.claude/skills/`). Both read from the same `skills/*.md` files.

| Skill | Description |
|---|---|
| `brain-sync` | Sync M365 emails with verification, then dream + lint (Teams chat unavailable) |
| `brain-day` | Daily prep brief — meetings with account context + overdue todos |
| `brain-note` | File user notes by matching them to calendar meetings |
| `brain-extract` | Extract reusable knowledge from work sessions |

## Data Model

### Core entities
- **items** — unified table for meetings, emails, chats, notes
- **people** — one row per person with contact info (name, title, company, email, phone)
- **accounts** — customer accounts with health, platform, segment, ARR
- **projects** — active work with status tracking
- **todos** — action items with priority, due date, source item, assignee
- **ideas** / **resources** — captured ideas and reference material

### Relationships
- **item_people** — who attended/participated in which item
- **account_contacts** — people linked to accounts with roles (ae, csa, se, tam, etc.)
- **edges** — generic typed relationships between any entities
- **tags** — flexible tagging on any entity

### Search
- **FTS5** index on item content and titles
- **sqlite-vec** 384-dimensional vectors for semantic similarity
- Hybrid ranking combines both signals

## License

Private.
