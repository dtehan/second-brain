import { startServer } from './server.js';

startServer().catch((err) => {
  console.error('Failed to start brain2 MCP server:', err);
  process.exit(1);
});
