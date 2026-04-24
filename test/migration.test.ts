import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseVaultFile, extractPeople, parseHealth, parseAeCsa } from '../src/migration/parse-frontmatter.js';
import { parseInteractionTable, parsePortfolioTable, extractAllWikiLinks } from '../src/migration/parse-tables.js';

describe('Frontmatter Parser', () => {
  it('parses meeting frontmatter', () => {
    const content = `---
type: meeting
date: 2025-02-25
attendees:
  - Nathan Green
tags:
  - type/meeting
  - person/nathan
---

# Meeting Title

Some content here.`;

    const parsed = parseVaultFile(content, '20250225 - Nathan 1-on-1.md');
    expect(parsed.frontmatter.type).toBe('meeting');
    expect(parsed.frontmatter.date).toBe('2025-02-25');
    expect(parsed.frontmatter.attendees).toEqual(['Nathan Green']);
    expect(parsed.frontmatter.tags).toEqual(['type/meeting', 'person/nathan']);
    expect(parsed.body).toContain('# Meeting Title');
  });

  it('parses email frontmatter with dedup fields', () => {
    const content = `---
type: email
date: 2026-04-16
attendees:
  - Daniel Tehan
  - John Myers
brain_id: a0c31206-2fa5-46fd-bfe8-feb4dbca1f53
email_message_id: AAMkADg2ZDgwYWIw
conversation_id: AAQkADg2ZDgwYWIw
folder: sent
tags:
  - type/email
---

Email body.`;

    const parsed = parseVaultFile(content, '20260416 - [Email] Subject.md');
    expect(parsed.frontmatter.brain_id).toBe('a0c31206-2fa5-46fd-bfe8-feb4dbca1f53');
    expect(parsed.frontmatter.email_message_id).toBe('AAMkADg2ZDgwYWIw');
    expect(parsed.frontmatter.folder).toBe('sent');
  });

  it('parses chat frontmatter with chat_id', () => {
    const content = `---
type: chat
date: 2026-03-11
attendees:
  - Amy Udelson
brain_id: 6333a9b6-e947-44f9-a9f7-6cbde4e9ff12
chat_id: "19:793649b0-2919-4804-b564@unq.gbl.spaces"
---

Chat content.`;

    const parsed = parseVaultFile(content, '20260311 - [Chat] Subject.md');
    expect(parsed.frontmatter.chat_id).toBe('19:793649b0-2919-4804-b564@unq.gbl.spaces');
  });

  it('extracts people from both attendees and participants', () => {
    expect(extractPeople({ attendees: ['Alice', 'Bob'], participants: ['Bob', 'Charlie'] }))
      .toEqual(['Alice', 'Bob', 'Charlie']); // deduplicated
  });

  it('parses health status', () => {
    expect(parseHealth('🟢 Active')).toBe('green');
    expect(parseHealth('🟡 At Risk')).toBe('yellow');
    expect(parseHealth('🔴 Critical')).toBe('red');
    expect(parseHealth(undefined)).toBe(null);
  });

  it('parses AE/CSA field', () => {
    expect(parseAeCsa('Ginny Brach')).toEqual([{ name: 'Ginny Brach', role: 'ae' }]);
    expect(parseAeCsa('Lou / Kevin S')).toEqual([
      { name: 'Lou', role: 'ae' },
      { name: 'Kevin S', role: 'csa' },
    ]);
    expect(parseAeCsa('')).toEqual([]);
  });
});

describe('Table Parser', () => {
  it('parses Key Interactions table', () => {
    const body = `
# Plutarco Roman

## Key Interactions

| Date | Type | Summary | Link |
|------|------|---------|------|
| 2026-04-20 | Meeting | Comcast Presentation Development | [[20260420 - Comcast Presentation Development]] |
| 2026-04-16 | Email | 3M Onsite Notes | [[20260416 - [Email] 3M Onsite Notes]] |

## Notes
Some other text.
`;

    const rows = parseInteractionTable(body);
    expect(rows.length).toBe(2);
    expect(rows[0].date).toBe('2026-04-20');
    expect(rows[0].type).toBe('Meeting');
    expect(rows[0].link).toBe('20260420 - Comcast Presentation Development');
    expect(rows[1].link).toBe('20260416 - [Email] 3M Onsite Notes');
  });

  it('parses Portfolio Overview table', () => {
    const body = `
# Portfolio

| Account | Health | Platform | AE / CSA | Segment | Plans / Intel |
|---------|--------|----------|----------|---------|---------------|
| [[3M]] | 🟡 At Risk | On-prem | Ginny Brach | Manufacturing | MCP on hold. |
| [[Bell Canada]] | 🟢 Active | Cloud | Clint / Suzanne | Telco | Enterprise MCP signed. |
`;

    const rows = parsePortfolioTable(body);
    expect(rows.length).toBe(2);
    expect(rows[0].account).toBe('3M');
    expect(rows[0].health).toBe('🟡 At Risk');
    expect(rows[0].platform).toBe('On-prem');
    expect(rows[0].ae_csa).toBe('Ginny Brach');
    expect(rows[1].account).toBe('Bell Canada');
    expect(rows[1].ae_csa).toBe('Clint / Suzanne');
  });

  it('extracts wiki links from text', () => {
    const text = 'See [[20260420 - Meeting]] and also [[Bell Canada]] for context.';
    const links = extractAllWikiLinks(text);
    expect(links).toEqual(['20260420 - Meeting', 'Bell Canada']);
  });
});
