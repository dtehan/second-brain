---
name: brain-extract
description: Extracts reusable knowledge from a Claude session into a new skill (or updates an existing one) — only when the discovery is reusable, non-trivial, specific, and verified. Applies a four-part quality gate before extracting and prefers updating an existing skill over creating a duplicate. Use whenever the user asks to "extract a skill", "save this as a skill", "what did we learn?", "/brain-extract", or at the end of a session that involved non-obvious debugging, misleading errors, tool/MCP quirks, workflow optimizations, or new brain2 conventions worth preserving.
---

# Skill Extraction
## Extract Reusable Knowledge from Work Sessions

Also invoke at the end of sessions that involved non-obvious debugging, trial-and-error discovery, or novel workflow creation.

---

## Core Principle

Not every task produces a skill. Extract only when the knowledge is reusable, non-trivial, and verified. Three lines of working code are better than a speculative abstraction — the same applies to skills.

---

## When to Extract

Extract when the session involved:

1. **Non-obvious solutions** — debugging that required investigation and wouldn't be immediately apparent next time
2. **Misleading errors** — error messages whose actual root cause differs from what they suggest
3. **Tool/API quirks** — how to properly use a tool in ways documentation doesn't cover
4. **Workflow optimizations** — multi-step processes that can be streamlined
5. **brain2-specific patterns** — conventions for ingestion, dreaming, MCP tool usage, or data modeling

## Quality Gate

Before extracting, verify all four:

- **Reusable**: Will this help with future tasks, not just this one instance?
- **Non-trivial**: Does this require discovery, not just documentation lookup?
- **Specific**: Can you describe exact trigger conditions and solution?
- **Verified**: Has this solution actually worked in this session?

---

## Extraction Pipeline

### 1. Search brain2 for Existing Knowledge

Before creating anything, check if this knowledge already exists.

```
brain_search(query='<keywords from the discovery>')
```

Also check existing skills:
```
ls skills/
```

| Search Result | Action |
|---|---|
| Strong match in brain2 or existing skill | Update the existing skill instead of creating new |
| Partial match | Create new, add cross-reference |
| No match | Create new |

### 2. Classify the Knowledge

Determine what form the extracted knowledge should take:

| Type | When | Where to Store |
|---|---|---|
| **Skill** (reusable workflow) | Multi-step process that will recur | `skills/<name>.md` |
| **Resource** (reference material) | Factual knowledge, API details, config recipes | brain2 via `brain_ingest_resource` |
| **Both** | Workflow that also contains reference-worthy details | Skill file + resource for the reference parts |

### 3. Draft the Skill

Use the brain2 skill format:

```markdown
# Skill Title
## One-line Description

Invoke when asked to: "trigger phrase 1", "trigger phrase 2", or "/skill-name".

---

## Overview (if needed)

Brief context on what this skill does and why it exists.

---

## Pipeline

### 1. Step Name

What to do, including specific brain2 MCP tool calls:
```
brain_tool_name(param=value)
```

### 2. Next Step
...

---

## Edge Cases

- Case 1: what to do
- Case 2: what to do
```

### 4. Save the Skill

Write the skill file to `skills/<descriptive-name>.md`.

If the skill is brain2-specific (ingestion, dreaming, data modeling), add it to the skills table in `CLAUDE.md` if it will run on a schedule or is a core workflow.

### 5. Capture to brain2

Save a resource so the knowledge is searchable across sessions:

```
brain_ingest_resource(
  title='Skill: <name>',
  content='<1-2 sentence summary>. Trigger: <when to use>. Location: skills/<name>.md',
  resource_type='skill',
  tags=['skill', '<topic>']
)
```

### 6. Update Memory (if cross-session relevant)

If the extracted knowledge changes how future sessions should behave (e.g., a new ingestion pattern, a tool quirk that affects multiple workflows), save a memory entry:

```
Write memory file to ~/.claude/projects/.../memory/<topic>.md
Update MEMORY.md index
```

Only do this for knowledge that genuinely affects future conversation behavior — most skills don't need a memory entry.

---

## Retrospective Mode

When invoked at the end of a session (`/brain-extract` or "what did we learn?"):

1. Review the conversation for extractable knowledge
2. List candidates with one-line justifications
3. Apply the quality gate to each candidate
4. Extract skills for the top candidates (typically 1-3 per session)
5. Report what was created, where, and why

---

## Anti-Patterns

- **Over-extraction**: Not every task deserves a skill. If the solution is in the docs, link to the docs.
- **Vague triggers**: "Helps with brain2" won't surface when needed. Be specific about when the skill fires.
- **Unverified solutions**: Only extract what actually worked in this session.
- **Duplicate skills**: Always search brain2 and `skills/` first. Update existing skills rather than creating overlapping ones.
- **Premature abstraction**: If you've only seen the pattern once, note it as a resource — don't create a full skill until you've seen it recur or are confident it will.

---

## Automatic Triggers

Consider invoking this skill when ANY of these occurred during the session:

1. Solution required significant investigation not found in documentation
2. Fixed an error where the error message was misleading
3. Found a workaround for a tool or MCP limitation that required experimentation
4. Discovered a brain2 convention or pattern worth preserving
5. Built a new multi-step workflow that others (or future sessions) should reuse
