# Second Brain

An MCP server that stores, searches, and discovers connections across your meeting notes using AI-powered semantic search. Designed to work with Claude Desktop (or any MCP-compatible client) as the interface.

## How It Works

Second Brain runs as a local MCP server. You talk to Claude Desktop normally — it calls Second Brain tools behind the scenes to store and retrieve your notes. There's no separate UI; Claude *is* the interface.

- Notes are stored in **ChromaDB** with rich metadata (attendees, date, subject)
- Embeddings are generated locally using **sentence-transformers** — no API costs
- Search is **semantic**, not keyword-based — "budget concerns" finds notes about "cost overruns"

## Setup

### 1. Install

```bash
cd second-brain
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

The first time you add or search a note, the embedding model (~80MB) downloads automatically.

### 2. Connect to Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "second-brain": {
      "command": "/path/to/second-brain/.venv/bin/python",
      "args": ["-m", "second_brain.server"]
    }
  }
}
```

Replace `/path/to/second-brain` with your actual path. Restart Claude Desktop.

## Usage Examples

All interaction happens through natural conversation with Claude. Below are examples of what you can say and which tools Claude calls.

---

### Adding a Note

**You:**
> I just had a meeting with Alex Smith and Sarah Johnson about the Data DNA pipeline. Here are my notes:
> - Reviewed OTF pipeline status — on track for March deadline
> - Alex proposed new data integration approach using ClearScape
> - Need to validate against Cigna's schema requirements
> - Action item: John to set up test environment by Friday

Claude looks up the calendar (via Microsoft 365 MCP if configured), fills in the date and attendees, then calls `add_note`:

```
Tool: add_note
  attendees: ["John Doe"]
  date: "2026-03-15T14:00:00"
  subject: "Data DNA Pipeline Review"
  content: "- Reviewed OTF pipeline status — on track for March deadline\n- proposed..."
```

---

### Searching Notes

**You:**
> What have we discussed about OTF across all meetings?

```
Tool: search_notes
  query: "OTF"
```

Returns the most semantically relevant notes about OTF, ranked by relevance — even if they don't contain the exact word "OTF" but discuss related concepts like "operational transformation framework" or "data pipeline orchestration."

---

### Finding Everything About a Person

**You:**
> Give me a summary of all my interactions with Habib

```
Tool: summarize_person
  person: "Habib"
```

Returns all notes where Habib was an attendee, formatted for Claude to summarize the key themes, decisions, and action items across meetings.

---

### Searching by Person + Topic

**You:**
> What has Habib said about data integration specifically?

```
Tool: search_by_person
  person: "Habib"
  query: "data integration"
```

Finds notes where Habib was present AND the content is semantically related to data integration.

---

### Date Range Search

**You:**
> What meetings did I have last week?

```
Tool: search_by_date_range
  start_date: "2026-03-08"
  end_date: "2026-03-14"
```

**You:**
> What did we discuss about MCP in January?

```
Tool: search_by_date_range
  start_date: "2026-01-01"
  end_date: "2026-01-31"
  query: "MCP"
```

---

### Discovering Connections

**You:**
> What other meetings are related to what we discussed in the Cigna demo prep?

```
Tool: find_connections
  note_id: "a1b2c3d4-..."
```

Finds notes that are semantically similar to the Cigna demo prep note — might surface a meeting about SQL optimization with a different client, or an internal discussion about demo environments.

**You:**
> What meetings touch on the topic of AI copilots?

```
Tool: find_connections
  topic: "AI copilots"
```

---

### Topic Summary

**You:**
> Summarize everything we know about ClearScape Analytics across all meetings

```
Tool: summarize_topic
  topic: "ClearScape Analytics"
```

Retrieves all relevant notes and provides them to Claude for cross-meeting summarization.

---

### Browsing Topics

**You:**
> What topics have I been covering in my meetings?

```
Tool: list_topics
```

Returns a list of all meeting subjects, showing which topics come up frequently.

---

### Bulk Import from OneNote

If you have existing meeting notes in OneNote's dash-separated format, paste them in:

**You:**
> Import these meeting notes from OneNote:
>
> \-----------------------------------------------------------
> Tehan, Daniel, Ahmed, Habib
> Tehan, Daniel at 3/10/26 10:00 AM
> RE: Data DNA Weekly Sync
> &nbsp;&nbsp;&nbsp;&nbsp;- Discussed MCP integration timeline
> &nbsp;&nbsp;&nbsp;&nbsp;- Habib raised concerns about API rate limits
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Need to implement backoff strategy
> &nbsp;&nbsp;&nbsp;&nbsp;- Action item: Daniel to prototype MCP server
> \-----------------------------------------------------------
> Smith, John, Tehan, Daniel
> Tehan, Daniel at 3/12/26 2:30 PM
> RE: Cigna MCP Demo Prep
> &nbsp;&nbsp;&nbsp;&nbsp;- Two groups interested
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- Client analytics with Vince
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;- DBA group focusing on SQL optimization
> &nbsp;&nbsp;&nbsp;&nbsp;- Need to prepare demo environment by Friday
> \-----------------------------------------------------------

```
Tool: import_notes
  text: "-----------------------------------------------------------\nTehan, Daniel, Ahmed, Habib\n..."
```

The parser extracts attendees, dates, subjects, and content from each block automatically.

---

### Capturing Teams Chats

Second Brain can store Teams chat conversations alongside meeting notes. Claude Desktop orchestrates the flow — it fetches chats via the Microsoft 365 MCP, then calls Second Brain tools to store them.

**You:**
> Capture my Teams chats from this week about Vantage migration

Claude fetches chats via M365, groups messages by thread, then for each conversation:

**Step 1 — Find the right subject:**
```
Tool: suggest_subject
  participants: ["Daniel Tehan", "Habib Matar"]
  topic_hint: "Vantage migration"
```

Returns existing notes ranked by participant overlap and topic relevance:
```
Suggested subjects based on participant overlap and topic relevance:
- Vantage DB Migration Planning (2026-03-10) — Daniel Tehan, Habib Matar, Sarah Jones
- Data Platform Roadmap (2026-03-08) — Daniel Tehan, John Smith
```

Claude picks the matching subject (or creates a new one if nothing fits).

**Step 2 — Store the chat:**
```
Tool: add_chat_note
  participants: ["Daniel Tehan", "Habib Matar"]
  date: "2026-03-14"
  subject: "Vantage DB Migration Planning"
  content: "Daniel: We need to finish the schema migration by Friday\nHabib: I'll handle the index changes, can you do the stored procs?\nDaniel: Yes, I'll have them done by Thursday"
  chat_id: "19:abc123@thread.v2"
  message_count: 12
```

Chat notes are tagged with `[Chat]` in list and search results, so they're visually distinct from meeting notes. The `chat_id` field prevents the same conversation from being stored twice — if you run the capture again, duplicates are rejected automatically.

Once stored, chat notes appear in all existing tools — `search_notes`, `summarize_topic`, `summarize_person`, `find_connections`, etc.

---

### Capturing Outlook Emails

Second Brain can store email threads from your Outlook folders ("1. Done" and "Sent") alongside meeting and chat notes. Claude Desktop orchestrates the flow — it checks what's already stored, fetches new emails via the Microsoft 365 MCP, summarizes threads, and stores them with deduplication.

**You:**
> Capture my emails from the Done folder since January

Claude runs the following flow:

**Step 1 — Check what's already processed:**
```
Tool: list_processed_ids
  source_type: "email"
```

Returns:
```
**email**: none processed
```

**Step 2 — Fetch emails via M365:**
```
Tool (M365): outlook_email_search
  folderName: "1. Done"
  afterDateTime: "2026-01-01"
```

Claude reads each thread, groups by conversation, skips any `conversation_id` already in the processed list, and summarizes each thread.

**Step 3 — Store each thread:**
```
Tool: add_email_note
  participants: ["Daniel Tehan", "Jane Doe", "Bob Smith"]
  date: "2026-02-10"
  subject: "Q1 Budget Approval"
  content: "Thread summary:\n- Jane requested budget sign-off for Q1 data platform costs\n- Bob approved with a note to revisit cloud spend in April\n- Daniel confirmed resource allocation"
  conversation_id: "AAQkAGI2..."
  email_message_id: "AAMkAGI2..."
  folder: "done"
```

**You:**
> Now do the same for my Sent folder

```
Tool: list_processed_ids
  source_type: "email"
```

Returns the conversation IDs already stored — Claude skips those and only processes new threads from Sent.

```
Tool: add_email_note
  participants: ["Daniel Tehan", "Carol Lee"]
  date: "2026-02-15"
  subject: "Follow-up: ClearScape Demo"
  content: "Daniel sent follow-up with demo recording and next steps..."
  conversation_id: "AAQkAHJ3..."
  folder: "sent"
```

Email notes are tagged with `[Email]` in list and search results. The `conversation_id` field prevents duplicates across folders — if the same thread appears in both Done and Sent, it's only stored once.

**You:**
> What emails have I processed so far?

```
Tool: list_processed_ids
  source_type: "email"
```

Returns:
```
**email** (2 processed):
  - AAQkAGI2...
  - AAQkAHJ3...
```

Once stored, email notes appear in all existing tools — `search_notes`, `summarize_topic`, `summarize_person`, `find_connections`, etc.

---

### Deleting a Note

**You:**
> Delete that test note I added earlier

```
Tool: delete_note
  note_id: "a1b2c3d4-..."
```

---

## All Tools

| Tool | Description |
|------|-------------|
| `add_note` | Add a meeting note with attendees, date, subject, content |
| `add_email_note` | Store an Outlook email thread (with deduplication via `conversation_id`) |
| `add_chat_note` | Store a Teams chat conversation (with deduplication via `chat_id`) |
| `list_processed_ids` | List already-stored email/chat IDs to avoid re-ingesting duplicates |
| `suggest_subject` | Find existing subjects matching a chat's participants and topic |
| `import_notes` | Bulk import from OneNote export format |
| `get_note` | Retrieve a specific note by ID |
| `list_notes` | List notes with pagination |
| `delete_note` | Remove a note |
| `search_notes` | Semantic search across all notes |
| `search_by_person` | Find notes involving a specific person |
| `search_by_date_range` | Find notes in a date range |
| `find_connections` | Find semantically related notes |
| `summarize_topic` | Get all notes about a topic (for Claude to summarize) |
| `summarize_person` | Get all notes involving a person (for Claude to summarize) |
| `list_topics` | List meeting subjects/topic coverage |

## Running Tests

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

## Data Storage

Notes are stored in `data/chroma/` (gitignored). To start fresh, delete that directory. The embedding model is cached in `~/.cache/huggingface/`.
