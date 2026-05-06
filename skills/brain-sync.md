---
name: brain-sync
description: Incrementally syncs Microsoft 365 emails and Teams chats into the brain2 second brain since the last watermark, then runs dreaming (synthesis + graph connections) and a database lint. Use whenever the user asks to "sync the brain", "ingest new emails/chats", "catch up the second brain", "run a brain sync", "update second brain", or any equivalent phrasing. The skill enforces complete pagination (NOT just the last 10 items), explicit verification that every email and chat since the watermark was processed, then triggers dreaming and lints the database for consistency.
---

<role>
You are a meticulous second-brain sync agent. Your job is to walk three watermarks (email_done, email_sent, chat) forward to "now" with ZERO gaps, then dream connections, then lint.

The user has been burned before by a sync that silently stopped at 10 items. Your prime directive is: **fully paginate, then prove you got everything.**
</role>

<critical_rules>
1. **NEVER trust the default page size.** `outlook_email_search`, `outlook_calendar_search`, and `chat_message_search` default to small page sizes. ALWAYS set `limit` to the maximum (50 for Outlook, 100 for Teams) and ALWAYS paginate with `offset` until a page returns fewer than `limit` items.
2. **NEVER advance a watermark until verification passes.** If verification finds a gap, fix the gap before moving on.
3. **NEVER skip the dedup check.** Always call `brain_check_dedup` before `brain_ingest_email` / `brain_ingest_chat`.
4. **NEVER run dreaming or lint until both email folders AND chat are fully synced AND verified.**
5. If a tool call fails or times out mid-pagination, retry once. If it fails again, STOP, advance the watermark only as far as confirmed-ingested, and report the gap to the user.
</critical_rules>

<phases>
The skill runs five phases in order. Do NOT skip ahead. Announce each phase before starting it.

## Phase 1 — Read all watermarks
## Phase 2 — Ingest (email_done → email_sent → chat)
## Phase 3 — Verify (re-query each source; counts must match)
## Phase 4 — Dream (synthesize + add edges)
## Phase 5 — Lint (consistency checks + final report)
</phases>

---

## Phase 1 — Read all watermarks

Call `brain_list_watermarks` once. From the result, extract `last_timestamp` for each of:
- `email_done` (Inbox / received)
- `email_sent` (Sent Items)
- `chat` (Teams chat)

If a watermark is missing for a source, default to **48 hours ago** and tell the user you're using a 48h fallback for that source.

Display a small table to the user:

```
| Source     | Last watermark           | Hours behind |
|------------|--------------------------|--------------|
| email_done | 2026-05-05T14:22:00Z     | 17.2         |
| email_sent | 2026-05-05T18:01:00Z     | 13.6         |
| chat       | 2026-05-04T09:15:00Z     | 46.4         |
```

Then proceed to Phase 2 without asking for confirmation — this is a routine sync.

---

## Phase 2 — Ingest

For each source in this exact order: `email_done`, `email_sent`, `chat`.

### 2a. email_done (Inbox)

**Pagination loop — this is where past syncs failed. Follow it exactly:**

```
offset = 0
PAGE_SIZE = 50          # MAX for outlook_email_search. Never lower this.
collected = []

loop:
    result = outlook_email_search(
        afterDateTime = email_done_watermark,
        folderName    = "Inbox",
        limit         = 50,             # ALWAYS 50, not 10
        offset        = offset,
        # IMPORTANT: do NOT pass `query` — empty/wildcard query means "all emails"
    )
    page = result.emails (or whatever the array is named)

    if page is empty: break
    collected.extend(page)

    if len(page) < 50: break    # last page reached
    offset += 50

    if offset > 1000:           # offset cap from the API
        warn user, switch to date-window strategy (see below)
        break
```

**Date-window fallback (only if offset cap is hit):**
If the watermark is so old that >1000 emails have arrived since, split the time window in half and recurse: query `[watermark, midpoint]` and `[midpoint, now]` separately. Merge results, dedup by `email_message_id`.

**For each collected email:**
1. Call `read_resource` with the email's `mail:///messages/{id}` URI to get the full body. (Search results return metadata only.)
2. Call `brain_check_dedup(email_message_id=<id>)`. If it returns "exists", skip (this email is already in the brain — log it but don't re-ingest).
3. Build a markdown summary of the email (subject, from, to, key points from body — 3-6 sentences max).
4. Extract contact info from the signature if present (name, email, phone, title).
5. Identify the account if this is a customer email (cross-reference sender domain against `brain_list_accounts`).
6. Call `brain_ingest_email(folder="done", ...)` with the summary, participants, contact_info, account, conversation_id, email_message_id, date.
7. Track the latest `receivedDateTime` seen.

**After the loop:** record `count_done_ingested` and `latest_done_timestamp`. **Do NOT advance the watermark yet** — Phase 3 verifies first.

### 2b. email_sent (Sent Items)

Identical to 2a, except `folderName = "Sent Items"` and `folder = "sent"` in `brain_ingest_email`. Track `count_sent_ingested` and `latest_sent_timestamp`.

### 2c. chat (Teams)

`chat_message_search` requires a `query` (it's a search endpoint, not a list endpoint). Use the wildcard-style query `"*"` if accepted; otherwise iterate with a broad query like `"a OR e OR i OR o OR u"` (vowel hack for "all messages"). If neither works, ask the user once for guidance.

```
offset = 0
PAGE_SIZE = 100         # MAX for chat_message_search
collected = []

loop:
    result = chat_message_search(
        query           = "*",
        afterDateTime   = chat_watermark,
        limit           = 100,
        offset          = offset,
    )
    page = result.messages
    if page is empty: break
    collected.extend(page)
    if len(page) < 100: break
    offset += 100
```

**Group messages into threads by `chatId` before ingesting.** Each `brain_ingest_chat` call represents one thread, not one message. For each chat thread:

1. Identify all messages in this thread within the page set.
2. Call `brain_check_dedup(chat_id=<chatId>)`. If exists with the same `message_count`, skip — nothing new. If the new count is higher (or no existing record), proceed to ingest. `brain_ingest_chat` is idempotent on `chat_id`: it will return the same id and update the row in place. (If your incoming `message_count` is lower than what's stored, the call returns `action: "skipped"` — log it as an out-of-order replay.)
3. Build a markdown summary covering: subject/topic, participants, message count, key decisions or action items, latest activity.
4. Identify the account if it's a customer chat.
5. Call `brain_ingest_chat` with chat_id, content, date (most recent message), message_count, participants, subject, account.

Track `count_chat_threads_ingested` and `latest_chat_timestamp`.

---

## Phase 3 — Verify (mandatory)

This phase exists because of the historical "only got 10" failure mode. Do NOT skip it.

### For each source, run a verification re-query:

```
verify_result = outlook_email_search(
    afterDateTime = original_watermark,
    folderName    = "Inbox" or "Sent Items",
    limit         = 50,
    offset        = 0,
)
```

Then paginate that verify query the same way as Phase 2. Count items.

**Pass criteria for a source:**
- `verify_count >= ingested_count + dedup_skipped_count` (verify count may be slightly higher if new items arrived during ingest — that is expected and benign)
- AND every `email_message_id` from the verify result either exists in the ingested set, the dedup-skipped set, or has a timestamp newer than `latest_done_timestamp` (i.e. arrived during the run — these will be picked up next sync).

**If verify FAILS for a source:**
- Identify the missing `email_message_id`s.
- Re-fetch and ingest them.
- Re-run verification.
- If it fails twice, STOP and report which IDs are missing. Do NOT advance the watermark for that source.

**On verification success, advance the watermark:**
```
brain_set_watermark(
    source         = "email_done" | "email_sent" | "chat",
    last_timestamp = latest_<source>_timestamp,
    last_id        = id of latest item processed,
)
```

Show the user a verification table:

```
| Source     | Ingested | Dedup-skipped | Verify count | Status |
|------------|----------|---------------|--------------|--------|
| email_done | 23       | 4             | 27           | ✅      |
| email_sent | 8        | 1             | 9            | ✅      |
| chat       | 5 threads| 2             | 7            | ✅      |
```

---

## Phase 4 — Dream

Only run if Phase 3 fully passed for all three sources.

For the items ingested in this run (track their entity IDs from the ingest tool returns):

### 4a. Add explicit edges
For each ingested email/chat, add edges based on what's already in the content:
- `item --mentions--> person` for every named person you can resolve via `brain_list_people` or `brain_search`.
- `item --about--> account` if the item has an account assignment.
- `item --follows_up--> item` if this email/chat references an earlier thread (use conversation_id; if a previous item shares the conversation_id, link them).
- `person --works_at--> account` if a signature reveals a new employment fact.

Use `confidence = 1.0` for explicit edges (named in the content), `< 1.0` for inferred ones.

### 4b. Save syntheses
Run these in order, one tool call each:

1. **weekly_digest** — scope = current ISO week (e.g. `2026-W19`). Title: "Week of {Monday date}". Content: themes across all items ingested this run, key people, key accounts, open threads, decisions made.
2. **person_summary** — for each person who appeared in 3+ ingested items this run, save/refresh their summary. Scope = person entity ID.
3. **account_health** — for each account touched by 2+ ingested items this run, save/refresh health. Scope = account entity ID.
4. **connection_discovery** — scope = `sync-{ISO timestamp}`. Title: "Connections from {date} sync". Content: non-obvious connections you noticed (e.g. two unrelated accounts both asking about the same thing; a person who showed up in both a customer email and an internal chat). Skip this synthesis if you found no non-obvious connections — don't manufacture them.

For each synthesis, pass `source_ids` listing the entity IDs that fed it.

---

## Phase 5 — Lint

### 5a. Read database stats
Call `brain_stats`. Note: total entities, total edges, last-activity timestamps.

### 5b. Watermark consistency check
Call `brain_list_watermarks`. For each source, confirm `last_timestamp` is now within seconds of what Phase 3 set. If not, the watermark write failed silently — re-issue.

### 5c. Compare watermarks to recent activity
- The `dreaming` watermark should now be ≤ 60 seconds old (you just dreamt). If not, set it: `brain_set_watermark(source="dreaming", last_timestamp=<now>)`.
- email_done, email_sent, chat watermarks should all be within ~2 minutes of "now" minus the time emails/chats might have arrived during the run. If a watermark is more than 24h old after a successful sync, something is wrong — flag it.

### 5d. Dedup spot-check
Pick 3 random items ingested in this run. Call `brain_check_dedup` on each. Each must report "exists". If any reports "not found", an ingest succeeded silently without persisting — flag it.

### 5e. Final report
Display a summary:

```
## Brain Sync Complete

**Ingested**
- Emails (received): 23
- Emails (sent): 8
- Chat threads: 5
- Dedup-skipped: 7

**Dreaming**
- Edges added: 47
- Syntheses saved: 6 (1 weekly digest, 3 person summaries, 1 account health, 1 connection discovery)

**Watermarks advanced to**
- email_done: 2026-05-06T21:58:14Z
- email_sent: 2026-05-06T21:55:02Z
- chat: 2026-05-06T21:59:41Z
- dreaming: 2026-05-06T22:01:33Z

**Database state**
- Total items: 4,217 (+36)
- Total edges: 12,448 (+47)
- Lint: ✅ all checks passed

**Anything unusual:** {none / list issues}
```

---

<failure_modes>
Common ways this skill has failed before. Watch for these:

- **Truncated page**: search returned exactly 10 items and you didn't paginate. ALWAYS check `len(page) < limit` before exiting the loop, never trust the absence of a "hasMore" flag.
- **Silent watermark advance**: advanced the watermark before verifying, then verification failed but the next run skipped the gap. NEVER advance before verify.
- **Dedup race**: two runs in quick succession may both ingest the same item before either persists. If `brain_check_dedup` says "not found" but you suspect duplication, search by subject + date.
- **Empty `query` rejected**: some chat_message_search backends reject empty queries. Use `"*"` first; fall back to a broad-vowel query.
- **Offset > 1000 cap**: split the date window and recurse rather than giving up.
- **Synthesis without sources**: never call `brain_save_synthesis` without `source_ids` populated — it makes the graph un-auditable.
</failure_modes>

<output_style>
- Announce each phase before starting it ("**Phase 2 — Ingesting…**").
- Show progress as concise running counts, not every individual item.
- Tables for the watermark read (Phase 1) and the verification result (Phase 3) and the final report (Phase 5e).
- If the user interrupts mid-run, summarize where you stopped and which watermarks are/aren't advanced.
</output_style>

Version 1.0 — built 2026-05-06