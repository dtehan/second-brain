import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { hybridSearch } from '../search/hybrid.js';

export function registerSearchTools(server: McpServer, db: Database.Database): void {

  server.tool(
    'brain_search',
    'Hybrid semantic + full-text search across all entities. Returns ranked results combining keyword matches and meaning similarity.',
    {
      query: z.string().describe('Search query (natural language or keywords)'),
      type_filter: z.enum(['item', 'person', 'account', 'project', 'idea', 'resource', 'synthesis']).optional().describe('Filter by entity type'),
      date_from: z.string().optional().describe('Filter items from this date (YYYY-MM-DD)'),
      date_to: z.string().optional().describe('Filter items up to this date (YYYY-MM-DD)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ query, type_filter, date_from, date_to, limit }) => {
      const results = await hybridSearch(db, query, {
        typeFilter: type_filter,
        dateFrom: date_from,
        dateTo: date_to,
        limit,
      });

      const formatted = results.map(r => ({
        id: r.entity_id,
        type: r.entity_type,
        title: r.title,
        date: r.date,
        score: Math.round(r.score * 100) / 100,
        match: r.match_type,
        snippet: r.snippet,
      }));

      return { content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }] };
    }
  );
}
