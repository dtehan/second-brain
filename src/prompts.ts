import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const SKILLS_DIR = join(import.meta.dirname, '..', 'skills');

const DESCRIPTIONS: Record<string, string> = {
  'brain-day': 'Daily prep brief — meetings with account context + overdue todos for today, tomorrow, or a named weekday',
  'brain-extract': 'Extract reusable knowledge from work sessions into new skills',
  'brain-note': 'File user notes by matching them to calendar meetings',
  'brain-sync': 'Sync M365 emails and Teams chats to brain2, with verification, then dream and lint',
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
