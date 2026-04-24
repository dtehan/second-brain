# Chat Ingestion Skill
## Microsoft Teams → brain2 Database Pipeline

Invoke when asked to: "process Teams chats", "ingest chats", "sync Teams", or "check my chats".

---

## Pipeline Steps

### 1. Get Watermark

Call `brain_get_watermark(source='chat')` to get the last-processed timestamp.
If no watermark exists, fall back to last 7 days.

### 2. Fetch from M365

Use the M365 MCP to fetch recent Teams direct messages and group chats.
**Only fetch chats with activity after the watermark timestamp.**

For each chat thread, collect:
- `chat_id` — the Teams chat/thread ID
- `message_count` — total number of messages in the thread
- `participants` — all participants in the conversation
- `date` — date of the most recent message (ISO format)
- Full message content (chronological order)

### 3. Deduplicate

For each chat, call `brain_check_dedup(chat_id=<id>)`.

**Three outcomes:**

| Result | Action |
|---|---|
| `exists: false` | File as new chat |
| `exists: true`, same `message_count` | Skip — no new messages |
| `exists: true`, lower `message_count` | File as update note with **only the new messages** |

### 4. Determine Subject

For new chats:
1. Look at the participants and topic to infer a subject
2. Search brain2 for recent items involving the same participants:
   `brain_search(query=<participant names>)`
3. If a related meeting exists, use a similar subject line

### 5. Summarise

Summarise the chat into bullet points:
- What was discussed
- Decisions made
- Requests directed at me
- Commitments I made

For long chats (50+ messages), include key verbatim quotes.

### 6. Ingest to brain2

Call `brain_ingest_chat` with:
```
subject, date, content (summary), participants,
chat_id, message_count, account (if customer chat)
```

### 7. Enrich People and Accounts

Same as email ingestion:
- `brain_upsert_person(...)` for any new participants
- `brain_add_edge(...)` if customer account involved
- `brain_add_todo(...)` for action items

### 8. Update Watermark

```
brain_set_watermark(source='chat', last_timestamp=<latest_chat_date>)
```

---

## Batch Processing

- Work in chronological order
- Log each result: "Filed: [Chat] Subject", "Skipped: [Chat] Subject (no new)", "Updated: [Chat] Subject (+N messages)"
- Final report: N new, N updated, N skipped, N people touched
