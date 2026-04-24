/**
 * Parse markdown tables from People notes (Key Interactions) and Account notes (Engagement Logs).
 *
 * Table format:
 * | Date | Type | Summary | Link |
 * |------|------|---------|------|
 * | 2026-04-20 | Meeting | Description text | [[20260420 - Meeting Title]] |
 */

export interface InteractionRow {
  date: string;
  type: string;
  summary: string;
  link: string; // wiki link filename (without [[ ]])
}

export interface PortfolioRow {
  account: string; // account name (from wiki link)
  health: string;  // raw health string (emoji + text)
  platform: string;
  ae_csa: string;  // raw "AE / CSA" field
  segment: string;
  plans: string;   // "Plans / Intel" field
}

/**
 * Parse a Key Interactions or Engagement Log table from a markdown body.
 * Returns rows from the table section.
 */
export function parseInteractionTable(body: string): InteractionRow[] {
  const rows: InteractionRow[] = [];

  const lines = body.split('\n');
  let inTable = false;
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table header: | Date | Type | Summary | Link |
    if (!inTable && trimmed.startsWith('|') && /date/i.test(trimmed) && /type/i.test(trimmed)) {
      inTable = true;
      headerFound = false;
      continue;
    }

    // Skip separator row: |------|------|---------|------|
    if (inTable && !headerFound && trimmed.startsWith('|') && trimmed.includes('---')) {
      headerFound = true;
      continue;
    }

    // Parse data rows
    if (inTable && headerFound && trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 4) {
        const link = extractWikiLink(cells[3]);
        rows.push({
          date: cells[0],
          type: cells[1],
          summary: cells[2],
          link,
        });
      }
    } else if (inTable && headerFound && !trimmed.startsWith('|')) {
      // End of table
      inTable = false;
      headerFound = false;
    }
  }

  return rows;
}

/**
 * Parse the Portfolio Overview table.
 * Format: | Account | Health | Platform | AE / CSA | Segment | Plans / Intel |
 */
export function parsePortfolioTable(body: string): PortfolioRow[] {
  const rows: PortfolioRow[] = [];
  const lines = body.split('\n');
  let inTable = false;
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inTable && trimmed.startsWith('|') && /account/i.test(trimmed) && /health/i.test(trimmed)) {
      inTable = true;
      headerFound = false;
      continue;
    }

    if (inTable && !headerFound && trimmed.startsWith('|') && trimmed.includes('---')) {
      headerFound = true;
      continue;
    }

    if (inTable && headerFound && trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 6) {
        rows.push({
          account: extractWikiLink(cells[0]) || cells[0],
          health: cells[1],
          platform: cells[2],
          ae_csa: cells[3],
          segment: cells[4],
          plans: cells[5],
        });
      }
    } else if (inTable && headerFound && !trimmed.startsWith('|')) {
      inTable = false;
      headerFound = false;
    }
  }

  return rows;
}

/**
 * Extract wiki link text: [[20260420 - Meeting Title]] -> "20260420 - Meeting Title"
 * Handles nested brackets like [[20260416 - [Email] Subject]]
 */
function extractWikiLink(text: string): string {
  // Find [[ and then match everything until ]]
  const start = text.indexOf('[[');
  if (start === -1) return text;
  const end = text.indexOf(']]', start + 2);
  if (end === -1) return text;
  return text.substring(start + 2, end);
}

/**
 * Extract all wiki links from a body of text
 */
export function extractAllWikiLinks(body: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    links.push(match[1]);
  }
  return links;
}
