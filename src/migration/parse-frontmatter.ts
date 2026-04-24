import matter from 'gray-matter';

export interface VaultFrontmatter {
  type?: string;
  date?: string;
  name?: string;
  title?: string;
  company?: string;
  email?: string;
  account?: string;
  attendees?: string[];
  participants?: string[];
  meeting_type?: string;
  health?: string;
  platform?: string;
  segment?: string;
  arr?: string;
  ae?: string;
  tags?: string[];
  brain_id?: string;
  email_message_id?: string;
  conversation_id?: string;
  chat_id?: string;
  message_count?: number;
  meeting_id?: string;
  folder?: string;
  source?: string;
  [key: string]: unknown;
}

export interface ParsedVaultFile {
  frontmatter: VaultFrontmatter;
  body: string;
  filename: string;
}

export function parseVaultFile(content: string, filename: string): ParsedVaultFile {
  const { data, content: body } = matter(content);

  // gray-matter converts date strings to Date objects — convert back to ISO strings
  if (data.date instanceof Date) {
    data.date = data.date.toISOString().split('T')[0];
  }

  return {
    frontmatter: data as VaultFrontmatter,
    body: body.trim(),
    filename,
  };
}

/**
 * Extract people names from frontmatter attendees/participants arrays
 */
export function extractPeople(fm: VaultFrontmatter): string[] {
  const people = new Set<string>();
  for (const name of fm.attendees ?? []) {
    if (name && typeof name === 'string') people.add(name.trim());
  }
  for (const name of fm.participants ?? []) {
    if (name && typeof name === 'string') people.add(name.trim());
  }
  return Array.from(people);
}

/**
 * Determine item_type from frontmatter type field
 */
export function resolveItemType(fm: VaultFrontmatter): 'meeting' | 'email' | 'chat' | 'note' | null {
  switch (fm.type) {
    case 'meeting': return 'meeting';
    case 'email': return 'email';
    case 'chat': return 'chat';
    default: return null;
  }
}

/**
 * Parse health status from emoji+text format (e.g., "🟡 At Risk" -> "yellow")
 */
export function parseHealth(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.includes('🟢') || raw.toLowerCase().includes('active')) return 'green';
  if (raw.includes('🟡') || raw.toLowerCase().includes('at risk')) return 'yellow';
  if (raw.includes('🔴') || raw.toLowerCase().includes('critical')) return 'red';
  return null;
}

/**
 * Parse the "AE / CSA" field from portfolio overview into contact role pairs
 */
export function parseAeCsa(raw: string | undefined): Array<{ name: string; role: string }> {
  if (!raw || raw.trim() === '') return [];
  const contacts: Array<{ name: string; role: string }> = [];

  // Format: "Name1 / Name2" where first is AE and second is CSA
  // Or just "Name" (AE only)
  const parts = raw.split('/').map(s => s.trim()).filter(Boolean);

  if (parts.length >= 1 && parts[0]) {
    contacts.push({ name: parts[0], role: 'ae' });
  }
  if (parts.length >= 2 && parts[1]) {
    contacts.push({ name: parts[1], role: 'csa' });
  }

  return contacts;
}
