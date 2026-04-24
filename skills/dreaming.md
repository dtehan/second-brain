# Dreaming Skill
## Incremental Connection Building via Claude Code CLI

Invoke when asked to: "dream", "build connections", "run dreaming", or "update syntheses".
Also runs on a schedule.

---

## Overview

The dreaming process builds higher-order knowledge on top of raw items in brain2.
It extracts entities, strengthens relationships, generates summaries, and discovers connections.

All processing uses the brain2 MCP tools — this is a pure Claude Code skill.

---

## Pipeline

### 1. Get Watermark

```
brain_get_watermark(source='dreaming')
```

Get the last time dreaming was run. If no watermark, process all items.

### 2. Fetch Unprocessed Items

```
brain_list_items(date_from=<watermark_date>)
```

### 3. Entity Extraction

For each unprocessed item, read the full content via `brain_get_item(id)`.
Identify mentions of:
- **People**: names not already in attendees list
- **Companies/Accounts**: customer names, competitors
- **Projects**: internal project references
- **Topics**: key themes (AI, MCP, security, compliance, etc.)

For each discovered entity:
- `brain_upsert_person(name, company)` for new people
- `brain_add_edge(item → person/account/project, 'mentions')` with confidence 0.8

### 4. Person Summaries

For people with new interactions since last dreaming:

1. `brain_get_person(name)` — get full profile + interactions
2. Synthesize a summary:
   - Interaction frequency and trend (increasing/decreasing)
   - Key topics discussed across interactions
   - Open items/commitments
   - Relationship context (role, org, relevance to my work)
3. `brain_save_synthesis(type='person_summary', scope=<person_id>, title=<name>, content=<summary>)`

### 5. Account Health

For each account with recent interactions:

1. `brain_get_account(name)` — get profile + engagements
2. Assess health based on:
   - Interaction frequency vs. baseline
   - Contact breadth (single-threaded vs. multi-contact)
   - Topic diversity (broad engagement vs. narrow)
   - Days since last contact
   - Presence of open action items
3. If health signal changed, generate explanation
4. `brain_save_synthesis(type='account_health', scope=<account_id>, title=<account>, content=<assessment>)`

### 6. Weekly Themes (run on Mondays)

1. `brain_list_items(date_from=<7 days ago>)` — get the week's items
2. Identify top 3-5 themes across all items
3. Note emerging patterns or shifts
4. Flag items that seem disconnected from main work streams
5. `brain_save_synthesis(type='weekly_digest', scope=<week_start_date>, title='Weekly Themes', content=<digest>)`

### 7. Connection Discovery

For each recent item:
1. `brain_search(query=<item title and key phrases>)`
2. Review top results for non-obvious connections
3. For each discovered connection:
   - `brain_add_edge(item_a → item_b, 'related_to', confidence=<0.7-0.9>)`
   - Include explanation in the evidence field

### 8. Update Watermark

```
brain_set_watermark(source='dreaming', last_timestamp=<latest_processed_item_date>)
```

---

## Scheduling

Run dreaming via Claude Code cron/triggers:
- **Daily**: Entity extraction, person summaries, account health
- **Monday**: Weekly themes synthesis
- **On-demand**: User says "dream" or "build connections"

---

## Output

All dreaming results are stored as syntheses, queryable via:
- `brain_get_synthesis(type='person_summary', scope=<person_id>)`
- `brain_get_synthesis(type='account_health', scope=<account_id>)`
- `brain_get_synthesis(type='weekly_digest', scope=<week_date>)`
