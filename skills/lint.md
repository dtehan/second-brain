# Database Lint Skill
## brain2 Maintenance Checklist

Invoke when asked to: "lint the database", "run maintenance", "clean up brain2", or "check data quality".

---

## Step 1 — Overdue Todos

Call `brain_list_todos(done=false)`.

Flag any todos where `due_date` is in the past. Report each with:
- Todo text
- Due date
- Project (if any)
- Assigned by (if any)
- Suggested action: mark done / reschedule / remove

**Do NOT change todo status.** Report and wait for user decision.

---

## Step 2 — Stale Accounts

Call `brain_get_portfolio()`.

For each account, check `last_interaction` date. Flag accounts where:
- Last interaction is 30+ days ago
- Health is not "churned"

Report each stale account with:
- Account name, health, platform
- Days since last interaction
- Primary contacts (AE, CSA)

---

## Step 3 — Orphaned People

Call `brain_list_people()`.

For each person, call `brain_get_person(name=<name>)`. Flag people who have:
- Zero items linked (no meetings, emails, or chats)
- No account associations
- No edges

These are likely stubs that were created but never enriched.
Report the list — do not auto-delete.

---

## Step 4 — Data Quality Checks

### Items without attendees
Call `brain_list_items(item_type='meeting', limit=50)` and check each for attendees.
Flag meetings with zero attendees.

### People missing key fields
From the people list, flag anyone missing both email and company.
Only flag people with 2+ interactions (ignore one-off mentions).

### Accounts missing contacts
From the portfolio, flag accounts with no AE or CSA assigned.

---

## Step 5 — Stale Projects

Call `brain_search(query='*', type_filter='project')`.

For each active project:
- Check for recent related items (last 14 days)
- Flag projects with no recent activity as potentially stale

---

## Step 6 — Teams Messages (requires M365 MCP)

Search Teams for direct messages and @mentions from the past 7 days.

Flag messages that contain:
- A direct question requiring a response
- An explicit request or task directed at me
- A decision needing input

**Skip:**
- Scheduling confirmations
- FYI forwards and announcements
- Automated notifications and bot messages
- Messages already replied to

Report flagged messages with: sender, date, message excerpt, suggested action.

---

## Lint Report

After completing all steps, save a synthesis:
```
brain_save_synthesis(
  synthesis_type='weekly_digest',
  content=<report>,
  scope='lint'
)
```

Report structure:
```
# Database Lint Report — YYYY-MM-DD

## Overdue Todos
- N todos overdue (list with suggested action)

## Stale Accounts
- N accounts with no recent interaction (list with days since last)

## Orphaned People
- N people with no linked items

## Data Quality
- N meetings without attendees
- N people missing contact info
- N accounts missing key contacts

## Stale Projects
- N projects with no recent activity

## Teams Messages
- N messages need response (list with sender and excerpt)
```

Only include sections that have findings. If everything is clean, report:
`All clear — no data quality issues found.`
