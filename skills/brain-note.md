---
name: brain-note
description: Files user-provided meeting notes by matching them against the M365 calendar (±2 day window), then ingesting the meeting with deduplication and clean person-name handling. Use whenever the user asks to "file my notes", "process my notes", "match notes to meetings", "file meeting notes", "/brain-note", or pastes raw meeting notes asking that they be filed against a calendar event.
---

# Note Filing Skill
## User Notes → Calendar Match → brain2 Database

---

## Pipeline

### 1. Receive Raw Notes

The user provides raw meeting notes (text or file). These contain:
- Discussion content, names, topics — but incomplete metadata

### 2. Extract Context Clues

From the note content, extract:
- **Date signals** — explicit dates, "yesterday", "this morning", day names
- **People names** — any names mentioned
- **Topic / title** — first heading or key phrase
- **Account** — any company or customer name
- **Keywords** — project names, product names

### 3. Find the Calendar Meeting

Search M365 calendar for a ±2 day window around the inferred note date.

For each candidate meeting, score:
- **Strong signal**: participant overlap (same names)
- **Medium signal**: topic/title similarity, account name match
- **Weak signal**: date alone

**Decision rules:**

| Confidence | Action |
|---|---|
| One clear match (strong signals) | Proceed automatically |
| Plausible but uncertain | Ask user to confirm |
| Multiple equally-plausible | List top 2-3, ask user to choose |
| No match found | Ask user: is this in the calendar? |

### 4. Ingest to brain2

**IMPORTANT — Person name format:**
- Use **clean names only**: `"Angela Brewer"`, never `"Angela Brewer (Dell)"`
- Company belongs in the `company` field via `brain_upsert_person`, not in the name
- Use the display name from the calendar invite, not variations with company suffixes

Call `brain_ingest_meeting` with:
```
title (from calendar event or inferred),
date (from calendar),
content (user's raw notes — preserved verbatim),
attendees (from calendar invite, merged with names in note — clean names only),
account (if customer meeting),
meeting_type (infer: account | internal | 1:1 | cross-functional),
calendar_event_id (from M365)
```

### 5. Enrich

- `brain_upsert_person(...)` for each attendee — include `email`, `phone`, and `title` if present in the note (e.g. from a signature or introduction line)
- `brain_add_edge(item → account, 'about')` if customer meeting
- `brain_add_todo(...)` for any action items found

### 6. Dedup Check

Before ingesting, `brain_check_dedup(calendar_event_id=<id>)`.
If duplicate exists, tell the user which item covers this meeting and offer to append.

---

## Edge Cases

- **No calendar event**: Ingest without `calendar_event_id`. The item still gets indexed.
- **Ad-hoc meeting**: Confirm with user, file normally.
- **Note covers multiple meetings**: Split into separate ingestion calls.
- **Sparse notes (1-3 lines)**: Still file — short notes are valid.
