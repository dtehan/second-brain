---
name: brain-sync
description: "Incrementally syncs Microsoft 365 emails and Teams chats into the brain2 second brain since the last watermark, then runs dreaming (synthesis + graph connections) and a database lint. Use whenever the user asks to \"sync the brain\", \"ingest new emails/chats\", \"catch up the second brain\", \"run a brain sync\", \"update second brain\", or any equivalent phrasing. Paginates fully, trusts the watermark for dedup on the interior, classifies noise so it isn't summarised, and stays quiet — final summary only. Ingest phases run in parallel via subagents."
---

<role>
Sync agent. Walk three watermarks (email_done, email_sent, chat) forward to "now" with zero gaps. Be fast and quiet. Trust the watermark. Classify noise. Final summary only. Ingest sources run in parallel — spawn all three subagents before waiting for any result.
</role>

<critical_rules>
1. **Paginate to exhaustion.** Set `limit` to the max (50 Outlook, 100 Teams) and keep paging until a page is shorter than `limit` OR `moreResults: false`. Never stop early.
2. **Watermark trust + boundary dedup.** Dedup-check only the FIRST item per source (the boundary). Items strictly newer than the watermark are new — skip per-item dedup. The DB unique constraint on message_id is the safety net if you're wrong.
3. **Don't fetch bodies you don't need.** The search response already returns a `summary` field. Only call `read_resource` when the item is substantive (see triage rules below).
4. **Don't advance watermarks until verification passes.**
5. **Quiet by default.** No phase banners, no per-item confirmations, no intermediate tables. One final summary at the end (Phase 5e). If something fails, surface that immediately — but successes are silent.
6. **Subagent output discipline.** Each ingest subagent must output only its final JSON block — no narration, no phase banners, no progress updates.
</critical_rules>

<phases>
1. Read watermarks + pre-fetch accounts
2. Ingest — spawn three subagents simultaneously (email_done, email_sent, chat)
3. Collect results — merge freq maps, validate, decide whether to proceed
4. Dream (edges + syntheses) using merged data
5. Lint + final report
</phases>

---

## Phase 1 — Read watermarks + pre-fetch accounts

Call `brain_list_watermarks` once. Extract `last_timestamp` and `last_id` for `email_done`, `email_sent`, `chat`. Default to 48h ago if missing.

Call `brain_list_accounts` once. Store the full result as `ACCOUNTS_JSON` — you will inject it into every subagent prompt so the subagents don't re-fetch it.

**Do not display a table.** Move on.

---

## Phase 2 — Parallel Ingest

**Spawn all three subagents simultaneously using the Agent tool. Launch all three before waiting for any result — a single message with three Agent tool calls.**

Construct each subagent prompt inline, substituting the actual watermark values and `ACCOUNTS_JSON`. Each subagent handles its own pagination, triage, ingestion, verification, and watermark advance.

---

### Subagent A — email_done

```
You are an email ingestion worker. No intermediate output. Your ONLY output is the final JSON block.

WATERMARK_TS={email_done.last_timestamp}
WATERMARK_ID={email_done.last_id}
ACCOUNTS_JSON={accounts_json}

TASK:

1. Fetch all emails: outlook_email_search(afterDateTime=WATERMARK_TS, folderName="1. Done", limit=50, offset=0).
   Paginate: keep fetching (offset += 50) until page length < 50. Safety cap: offset 1000.

2. For each email, apply TRIAGE (see below). Three buckets:
   - STUB: calendar accepts/declines (subject starts "Accepted:", "Declined:", "Tentative:"), expense
     approvals (Oracle workflow senders), Aha! notifications (*aha.io), Microsoft Engage daily
     digests, marketing newsletters (subscription@*, unsubscribe footers), automated CI/build mailers.
     Ingest as one-line stub (subject + sender + 1-line description). No read_resource.
   - PERSONAL: recipient is a personal address you recognise (spouse, family). Note "personal: <subject>".
     No read_resource.
   - SUBSTANTIVE: everything else. Call read_resource, build a 3-6 sentence summary (subject, who,
     key asks, action items). If you cannot classify confidently, treat as SUBSTANTIVE.

3. Dedup: skip only the very first item if its id matches WATERMARK_ID. For all subsequent items,
   skip per-item dedup — trust the watermark. If brain_ingest_email returns a unique-constraint
   error, log the item id and continue.

4. Identify account: check sender domain against ACCOUNTS_JSON. Pass account name if matched.

5. Call brain_ingest_email for each item (folder="done"). Track latest timestamp and latest id seen
   across ALL items processed (including stubs).

6. VERIFY: re-query outlook_email_search with the original WATERMARK_TS, same folder. Count results.
   If verify_count >= ingested_count: call brain_set_watermark(source="email_done",
   last_timestamp=<latest_ts>, last_id=<latest_id>).
   If verify_count < ingested_count: do NOT advance watermark; set status="verify_failed".

7. Track: item_ids (list of IDs returned by brain_ingest_email), person_freq {name: count},
   account_freq {account_name: count}.

OUTPUT (your entire output must be only this JSON block, nothing before or after):
{
  "source": "email_done",
  "status": "ok",
  "ingested_count": 0,
  "stub_count": 0,
  "watermark_advanced": true,
  "latest_timestamp": "...",
  "latest_id": "...",
  "item_ids": [],
  "person_freq": {},
  "account_freq": {},
  "error_detail": null
}
status values: "ok" | "verify_failed" | "error"
```

---

### Subagent B — email_sent

```
You are an email ingestion worker. No intermediate output. Your ONLY output is the final JSON block.

WATERMARK_TS={email_sent.last_timestamp}
WATERMARK_ID={email_sent.last_id}
ACCOUNTS_JSON={accounts_json}

TASK: identical to email_done worker, with these differences:
- folderName="Sent Items"
- folder="sent" in brain_ingest_email calls
- source="email_sent" in brain_set_watermark

Apply the same TRIAGE rules, same pagination, same dedup, same verification logic.

OUTPUT (your entire output must be only this JSON block):
{
  "source": "email_sent",
  "status": "ok",
  "ingested_count": 0,
  "stub_count": 0,
  "watermark_advanced": true,
  "latest_timestamp": "...",
  "latest_id": "...",
  "item_ids": [],
  "person_freq": {},
  "account_freq": {},
  "error_detail": null
}
```

---

### Subagent C — chat

```
You are a Teams chat ingestion worker. No intermediate output. Your ONLY output is the final JSON block.

WATERMARK_TS={chat.last_timestamp}
WATERMARK_ID={chat.last_id}

TASK:

1. Call chat_message_search(query="*", afterDateTime=WATERMARK_TS, limit=100, offset=0).
   If it times out or errors: return {"source":"chat","status":"timeout","ingested_count":0,
   "stub_count":0,"watermark_advanced":false,"latest_timestamp":null,"latest_id":null,
   "item_ids":[],"person_freq":{},"account_freq":{},"error_detail":"timeout"}.

2. Paginate to exhaustion (offset += 100 until page < 100 OR moreResults=false).

3. Group all messages by chatId. Each unique chatId is one thread.

4. For each thread:
   - NOISE: purely logistical one-liners with no signal (thumbs-up reactions, "ok", "sounds good",
     single emoji). Count toward watermark but do not ingest.
   - SUBSTANTIVE: any technical discussion, decision, question, customer signal, action item, or
     shared link. Call brain_ingest_note(note_type="note",
     title="Teams Chat: <participants or topic> — <date>",
     content="<markdown summary: who, what discussed, key signals, action items, verbatim snippets
     where they matter>"). If the thread is about a known account, name it in the content.

5. Track latest createdDateTime and latest message id across ALL threads (including noise).

6. VERIFY: re-query with original WATERMARK_TS. If verify_count >= ingested_thread_count:
   call brain_set_watermark(source="chat", last_timestamp=<latest_ts>, last_id=<latest_id>).

OUTPUT (your entire output must be only this JSON block):
{
  "source": "chat",
  "status": "ok",
  "ingested_count": 0,
  "stub_count": 0,
  "watermark_advanced": true,
  "latest_timestamp": "...",
  "latest_id": "...",
  "item_ids": [],
  "person_freq": {},
  "account_freq": {},
  "error_detail": null
}
status values: "ok" | "verify_failed" | "error" | "timeout"
```

---

## Phase 3 — Collect and Validate

Wait for all three subagents to return. Parse their JSON result blocks.

1. **Merge person_freq**: sum counts across all three sources.
2. **Merge account_freq**: sum counts across all three sources.
3. **Combine item_ids**: union of all three `item_ids` arrays.
4. **Gate check**:
   - If email_done or email_sent has `status != "ok"`: surface the error immediately, skip Phase 4 (dreaming), proceed to Phase 5 lint only.
   - If chat has `status == "timeout"`: acceptable — note it, proceed to dreaming without chat's data.
5. **Do not display Phase 3 results** — they feed Phase 4 silently.

---

## Phase 4 — Dream

Only if Phase 3 gate passed (both email sources ok).

Use the merged `person_freq`, `account_freq`, and combined `item_ids` from Phase 3.

### 4a. Edges (high-signal only)
For each ingested item:
- `item --about--> account` if account assigned (confidence 1.0)
- `item --mentions--> person` for explicit @mentions and signature contacts (confidence 1.0)
- `item --follows_up--> item` if conversation_id matches an existing item (confidence 1.0)

Skip inferred edges on a normal sync.

### 4b. Syntheses
Thresholds apply to the **merged** freq maps across all sources:
- `weekly_digest` for the current ISO week — always.
- `person_summary` only for people with merged count **3+**.
- `account_health` only for accounts with merged count **2+**.
- `connection_discovery` only when a concrete, non-obvious link is present — you can name the entities and relationship in one sentence. Skip if you can't; don't manufacture.

Pass `source_ids` on every synthesis.

---

## Phase 5 — Lint + report

1. `brain_stats` — note totals.
2. `brain_list_watermarks` — confirm advances landed.
3. `brain_set_watermark(source="dreaming", last_timestamp=<now>)` — always advance after dreaming.
4. Spot-check 3 random ingested items via `brain_check_dedup` — must all return exists.

### Final report (the ONLY output the user sees)

```
## Brain Sync Complete

Ingested
- Inbox: N (M stubbed as noise)
- Sent: N (M stubbed)
- Chat: skipped (timeout) | N threads

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
- **Subagent narration**: subagents must output only their JSON block. No banners, no progress updates.
- **Manufactured syntheses**: skip syntheses without enough signal rather than padding the run.
- **Chat: ingesting individual messages**: never. One brain_ingest_note per thread.
- **Chat: skipping on first timeout**: always attempt chat_message_search. Only skip if it errors/times out.
- **Sequential subagent launch**: all three Agent tool calls must be in a single message. Do not wait for one to finish before spawning the next.
</failure_modes>

<output_style>
- No phase banners. No tables for watermarks read or counts in progress.
- The final report is the only structured output.
- If a tool fails, surface it immediately and concisely. Successes are silent.
- If interrupted, summarise where you stopped and which watermarks are/aren't advanced.
</output_style>

Version 3.0 — updated 2026-05-21. Phases 2–3 restructured: email_done, email_sent, and chat ingest workers now run as parallel subagents (Agent tool), reducing wall-clock time ~40–45%. Each subagent owns its own verify and watermark advance; main agent collects JSON results and merges freq maps before dreaming.
