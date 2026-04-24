import { startServer } from './server.js';

const args = process.argv.slice(2);

if (args[0] === '--import-vault') {
  const vaultPath = args[1] || `${process.env['HOME']}/code/brain/second-brain`;
  console.log(`Importing vault from: ${vaultPath}`);

  const { getDb, closeDb } = await import('./db/connection.js');
  const { importVault } = await import('./migration/import-vault.js');

  const db = getDb();
  const stats = await importVault(db, vaultPath);

  console.log('\n=== Migration Complete ===');
  console.log(`People: ${stats.people}`);
  console.log(`Accounts: ${stats.accounts}`);
  console.log(`Projects: ${stats.projects}`);
  console.log(`Items: ${stats.items}`);
  console.log(`Item-People links: ${stats.item_people}`);
  console.log(`Resources: ${stats.resources}`);
  console.log(`Edges: ${stats.edges}`);
  console.log(`Tags: ${stats.tags}`);
  console.log(`Embeddings: ${stats.embeddings}`);
  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.forEach(e => console.log(`  - ${e}`));
  }

  closeDb();
} else {
  startServer().catch((err) => {
    console.error('Failed to start brain2 MCP server:', err);
    process.exit(1);
  });
}
