# Email Ingestion Skill
## M365 Outlook → brain2 Database Pipeline

Invoke when asked to: "process emails", "ingest emails", "sync emails", or "check my email".

---

## Pipeline Steps

### 1. Get Watermark

Use the brain2 MCP to check the last-processed timestamp:
- `brain_get_watermark(source='email_done')` for received emails
- `brain_get_watermark(source='email_sent')` for sent emails

If no watermark exists (first run), fall back to last 7 days.

### 2. Fetch from M365

Use the M365 MCP to fetch from Done and Sent folders.
**Only fetch items after the watermark timestamp.**

For each email, collect:
- `email_message_id` — the individual message ID
- `conversation_id` — the thread ID
- `subject` — email subject line
- `date` — sent/received date (ISO format)
- `participants` — all To/From/CC names (deduplicated)
- `folder` — "done" or "sent"
- Full email body

**IMPORTANT — Person name format:**
- Use **clean names only**: `"Angela Brewer"`, never `"Angela Brewer (Dell)"`
- Company belongs in the `company` field via `brain_upsert_person`, not in the name
- Nicknames: use the form from the email header (e.g. if header says "Chris Weaver", use that consistently)

### 3. Check Dedup

For each email, call:
```
brain_check_dedup(email_message_id=<id>)
```
If `exists: true` → **skip this email**.

### 4. Summarise

Summarise the email content into bullet points covering:
- What was discussed or decided
- Any requests made of me
- Any commitments I made
- Key context (account, project, people involved)

Keep summaries factual and concise — 3 to 8 bullet points.

### 5. Extract Contact Info

Scan the email body and signature for contact details:
- Email addresses
- Phone numbers
- Job titles

Build a `contact_info` array for each participant where info is found.

### 6. Ingest to brain2

Call `brain_ingest_email` with:
```
subject, date, content (summary), participants,
email_message_id, conversation_id, folder,
account (if customer email),
contact_info (extracted from signatures)
```

The server automatically:
- Creates people stubs for new participants
- Links participants to the item
- Updates contact info on person records
- Generates embedding and updates search indexes

### 7. Enrich People

For each participant, call `brain_upsert_person` with any additional info discovered
(title, company, email, phone). Existing fields won't be overwritten.

### 8. Account Linking

If the email involves a customer account:
- `brain_add_edge(source_type='item', source_id=<item_id>, target_type='account', target_id=<account_id>, relation='about')`

### 9. Extract Action Items

Scan the summary for tasks I own. For each:
- `brain_add_todo(text, source_item_id=<item_id>, assigned_by=<person_name>, priority=<if manager/skip-level: 'highest'>)`

### 10. Update Watermark

After processing each folder:
```
brain_set_watermark(source='email_done', last_timestamp=<latest_email_date>, last_id=<latest_email_id>)
brain_set_watermark(source='email_sent', last_timestamp=<latest_email_date>, last_id=<latest_email_id>)
```

---

## Batch Processing

When processing multiple emails:
- Work in chronological order (oldest first)
- Log each email filed: "Filed: [Email] Subject (date)"
- At the end, report: N emails processed, N skipped (already exists), N people updated
