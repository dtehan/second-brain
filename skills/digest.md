# Daily Digest
## Morning Briefing via brain2 MCP

Invoke when asked to: "run the digest", "morning briefing", or "what's on today?".
Also runs on a cron schedule (7:03am weekdays).

---

## Tools Available
- brain2 MCP — query the knowledge database (configured in ~/.claude/mcp.json)
- M365 MCP — read calendar and Teams (configured in Claude Desktop)

---

## Pipeline

### 1. Overdue & High-Priority Todos

Call `brain_list_todos(done=false)`.

Flag any todos where:
- `due_date` is in the past (overdue)
- `priority` is 'highest' or 'high'

List each with: todo text, due date, project, assigned by.

### 2. Upcoming Meetings (next 48 hours)

Check M365 calendar for meetings in the next 48 hours.

For each customer account meeting:
- Call `brain_search(query=<account_name>, type_filter='account')` to check if an account exists
- Call `brain_get_account(name=<account_name>)` to check engagement recency
- Flag if account is missing from brain2 or last interaction is 30+ days ago

### 3. Stale Accounts

Call `brain_get_portfolio()`.

Flag any accounts where last interaction is 14+ days ago and health is 'green' or 'yellow'.
These may need proactive outreach.

### 4. Recent Ingestion Summary

Call `brain_list_watermarks()` and `brain_stats()`.

Report:
- Last email ingestion timestamp
- Last chat ingestion timestamp
- Last dreaming run
- Total items in database

Flag if any watermark is older than 48 hours (ingestion may be stalled).

---

## Output

Save the briefing as a synthesis:
```
brain_save_synthesis(
  synthesis_type='weekly_digest',
  content=<briefing>,
  scope='daily_briefing'
)
```

Also print the briefing to stdout so it appears in the cron log.

### Format
```
# Daily Briefing — YYYY-MM-DD

## Overdue Todos
- [ ] Todo text — due DATE — project: PROJECT

## High-Priority Items
- [ ] Todo text — from PERSON

## Upcoming Meetings (48h)
- DATE TIME — Meeting Title
  Account: NAME — last interaction: DATE (or "not in brain2")

## Stale Accounts
- ACCOUNT — N days since last interaction — health: STATUS

## Ingestion Status
- Email: last run DATE
- Chat: last run DATE
- Dreaming: last run DATE
- Total items: N
```

Only include sections that have content. If everything is clean, print:
`All clear — no overdue todos, no stale accounts, ingestion current.`

Keep the briefing scannable. No prose — just actionable items.
