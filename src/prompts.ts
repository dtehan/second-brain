import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills');

const DESCRIPTIONS: Record<string, string> = {
  'chat-ingestion': 'Fetch Microsoft Teams chats and file them to brain2',
  'digest': 'Daily morning briefing — todos, meetings, stale accounts, ingestion status',
  'dreaming': 'Incremental connection building — entities, summaries, themes, connections',
  'email-ingestion': 'Fetch M365 emails and file them to brain2',
  'lint': 'Database maintenance checklist — data quality, stale items',
  'note-filing': 'File user notes by matching them to calendar meetings',
  'skill-extraction': 'Extract reusable knowledge from work sessions into new skills',
};

export function registerPrompts(server: McpServer): void {
  const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const name = basename(file, '.md');
    const description = DESCRIPTIONS[name] || name;
    const content = readFileSync(join(SKILLS_DIR, file), 'utf-8');

    server.prompt(name, description, () => ({
      messages: [{
        role: 'user',
        content: { type: 'text', text: content },
      }],
    }));
  }
}
