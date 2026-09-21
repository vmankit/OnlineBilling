import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  // Render redeploys run the image straight after build; applying pending
  // migrations on boot keeps the schema in step with the code.
  const applied = await runMigrations();
  if (applied.length) console.log(`Applied ${applied.length} migration(s) on boot.`);

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down.`);
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: Error) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
