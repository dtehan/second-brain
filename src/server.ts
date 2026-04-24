import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from './db/connection.js';
import { registerIngestTools } from './tools/ingest.js';
import { registerSearchTools } from './tools/search.js';
import { registerQueryTools } from './tools/query.js';
import { registerEntityTools } from './tools/entities.js';
import { registerGraphTools } from './tools/graph.js';
import { registerSynthesisTools } from './tools/synthesis.js';
import { registerStatsTools } from './tools/stats.js';
import { registerWatermarkTools } from './tools/watermark.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'brain2',
    version: '0.1.0',
  });

  // Initialize database connection
  const db = getDb();

  // Register all tool groups
  registerIngestTools(server, db);
  registerSearchTools(server, db);
  registerQueryTools(server, db);
  registerEntityTools(server, db);
  registerGraphTools(server, db);
  registerSynthesisTools(server, db);
  registerStatsTools(server, db);
  registerWatermarkTools(server, db);

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
