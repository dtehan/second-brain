---
name: brain-sync
description: "Incrementally syncs Microsoft 365 emails and Teams chats into the brain2 second brain since the last watermark, then runs dreaming (synthesis + graph connections) and a database lint. Use whenever the user asks to \"sync the brain\", \"ingest new emails/chats\", \"catch up the second brain\", \"run a brain sync\", \"update second brain\", or any equivalent phrasing. Paginates fully, trusts the watermark for dedup on the interior, classifies noise so it isn't summarised, and stays quiet — final summary only."
---

<role>
Sync agent. Walk three watermarks (email_done, email_sent, chat) forward to "now" with zero gaps. Be fast and quiet. Trust the watermark. Classify noise. Final summary only.
</role>

<critical_rules>
1. **Paginate to exhaustion.** Set `limit` to the max (50 Outlook, 100 Teams) and keep paging until a page is shorter than `limit` OR `moreResults: false`. Never stop early.
2. **Watermark trust + boundary dedup.** Dedup-check only the FIRST item per source (the boundary). Items strictly newer than the watermark are new — skip per-item dedup. The DB unique constraint on message_id is the safety net if you're wrong.
3. **Don't fetch bodies you don't need.** The search response already returns a `summary` field. Only call `read_resource` when the item is substantive (see triage rules below).
4. **Don't advance watermarks until verification passes.**
5. **Quiet by default.** No phase banners, no per-item confirmations, no intermediate tables. One final summary at the end (Phase 5e). If something fails, surface that immediately — but successes are silent.
</critical_rules>

<phases>
1. Read watermarks
2. Ingest (email_done → email_sent → chat) with triage
3. Verify (re-query each source; counts match)
4. Dream (edges + syntheses)
5. Lint + final report
</phases>

---

## Phase 1 — Read watermarks

Call `brain_list_watermarks` once. Extract `last_timestamp` for `email_done`, `email_sent`, `chat`. Default to 48h ago if missing. **Do not display a table.** Move on.

---

## Phase 2 — Ingest

For each source in order: `email_done`, `email_sent`, `chat`.

### Triage rules — applied to every email BEFORE deciding whether to fetch the body

Classify each search result by sender + subject. Three buckets:

- **Skip body, ingest as one-line stub.** Calendar accepts/declines (subject starts with "Accepted:", "Declined:", "Tentative:"), expense approvals (Oracle workflow senders), Aha! notifications (`*aha.io`), Microsoft Engage daily digests, marketing newsletters (subscription@*, unsubscribe footers), automated build/CI mailers. Stub = subject + sender + 1-line description. No `read_resource`.
- **Skip body, ingest with a short context line.** Personal emails (recipient = a personal address you recognise — spouse, family). Note "personal: <subject>" and move on. No `read_resource`.
- **Fetch the body.** Everything else. Call `read_resource`, build a 3-6 sentence summary covering subject, who, key asks, action item.

If you can't classify confidently, fetch — false negatives on triage cost more than the extra read.

### 2a + 2b. Email loops (Inbox + Sent Items)

```
offset = 0
collected = []
loop:
    page = outlook_email_search(afterDateTime=watermark, folderName=<Inbox|Sent Items>, limit=50, offset=offset)
    if page is empty: break
    collected.extend(page)
    if len(page) < 50: break
    offset += 50
    if offset > 1000: split date window, recurse, dedup by id
```

Then for each email:
1. Apply triage (above).
2. **Dedup only on the first item.** If the first item's `id` matches the watermark's `last_id`, skip it. For all subsequent items, skip per-item dedup — they're guaranteed new by the watermark. (If a 23505 / unique-violation comes back from `brain_ingest_email`, log and continue — don't crash.)
3. Build content (stub line OR full summary depending on triage).
4. Identify account by sender domain if present in `brain_list_accounts`.
5. Call `brain_ingest_email`. Track latest timestamp.

Folder is `done` for Inbox, `sent` for Sent Items.

### 2c. Chat (Teams)

```
offset = 0
collected = []
loop:
    page = chat_message_search(query="*", afterDateTime=watermark, limit=100, offset=offset)
    if page is empty or moreResults=false on last item: break
    collected.extend(page)
    if len(page) < 100: break
    offset += 100
```

**Group by chatId in memory while iterating** — don't dump to a file or re-loop. One pass:

```
threads = {}
for msg in collected:
    threads.setdefault(msg.chatId, []).append(msg)
```

For each `chatId`:
1. Boundary dedup: if `chatId` matches the watermark's `last_id` AND latest message timestamp == watermark, skip.
2. Otherwise call `brain_ingest_chat` (idempotent on chat_id — it updates in place). Pass `message_count = len(threads[chatId])` for THIS run; the brain stores it as the count for this thread within this sync window. Don't try to merge across runs.
3. For substantive customer threads: 4-8 sentence summary covering topic, key decisions, action items. For meeting backchannels, drops/regrets, and brief coordination: one or two lines. **Same triage spirit as emails.**
4. Account assignment if recognisable from participant emails or topic.

---

## Phase 3 — Verify

For each source, re-query with the original watermark and count. Pass criteria: `verify_count >= ingested_count`. Count may be slightly higher (items arrived during run) — fine. If verify count is LOWER than ingested, something's wrong; investigate before advancing.

If pass:
```
brain_set_watermark(source=..., last_timestamp=<latest_seen>, last_id=<id of latest>)
```

Don't display the verification table unless something failed.

---

## Phase 4 — Dream

Only if Phase 3 passed for all three sources.

### 4a. Edges (only the high-signal ones)
For each ingested item:
- `item --about--> account` if account assigned (confidence 1.0)
- `item --mentions--> person` for explicit @mentions and signature contacts (confidence 1.0)
- `item --follows_up--> item` if conversation_id matches an existing item (confidence 1.0)

Skip inferred edges on a normal sync — they're noise. Add them in a dedicated dreaming pass if asked.

### 4b. Syntheses
Run only the ones that have enough signal:
- `weekly_digest` for the current ISO week — always.
- `person_summary` only for people who appeared in **3+ ingested items** this run.
- `account_health` only for accounts touched by **2+ ingested items** this run.
- `connection_discovery` only if you actually noticed a non-obvious connection. Skip otherwise — don't manufacture.

Pass `source_ids` on every synthesis.

---

## Phase 5 — Lint + report

1. `brain_stats` — note totals.
2. `brain_list_watermarks` — confirm advances landed (within seconds of what Phase 3 set).
3. `brain_set_watermark(source="dreaming", last_timestamp=<now>)` — always advance after dreaming.
4. Spot-check 3 random ingested items via `brain_check_dedup` — must all return exists.

### Final report (this is the ONLY output the user sees)

```
## Brain Sync Complete

Ingested
- Inbox: N (M stubbed as noise)
- Sent: N (M stubbed)
- Chat threads: N

Dreaming
- Edges: N
- Syntheses: weekly_digest + N person summaries + N account health + (connection_discovery | none)

Watermarks
- email_done → <ts>
- email_sent → <ts>
- chat → <ts>
- dreaming → <ts>

Lint: ✅ | issues: <list>
```

---

<failure_modes>
- **Truncated page**: always check `len(page) < limit` AND `moreResults` before exiting.
- **Watermark advanced before verify**: never. Verify first.
- **Body fetch on noise**: triage first. A daily digest doesn't need a 3000-token body.
- **Per-item dedup on the interior**: don't. Trust the watermark; rely on DB unique constraint as a backstop.
- **Loud narration**: phase banners and per-item confirmations make a sync feel like it's grinding. Stay silent until the final report.
- **Manufactured syntheses**: skip syntheses without enough signal rather than padding the run.
</failure_modes>

<output_style>
- No phase banners ("**Phase 2 — Ingesting…**"). Internal only.
- No tables for watermarks read or counts in progress. The final report is the only structured output.
- If a tool fails, surface it immediately and concisely. Successes are silent.
- If interrupted, summarise where you stopped and which watermarks are/aren't advanced.
</output_style>

Version 2.0 — built 2026-05-08. Predecessor (v1.0) was correct but slow: ~150 tool calls and a wall of narration per run. v2.0 cuts that to ~40-60 calls by trusting the watermark, triaging noise without body fetches, and going quiet until the end.
