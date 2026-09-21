import pg from 'pg';

/**
 * Drops and recreates the test database once per run, then applies migrations
 * and the seed. Starting from a known, empty schema is what lets the tests
 * assert on exact invoice numbers and stock balances.
 */
// globalSetup runs in Vitest's own process, before any test environment is
// created, so `test.env` from vitest.config has not been applied yet. The
// connection string is therefore resolved here the same way the config does,
// and pushed into process.env for the migrate/seed modules imported below.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres@localhost:5433/santu_hardware_test';

export async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_SSL = 'false';
  process.env.JWT_SECRET ??= 'test-secret-value-that-is-long-enough';

  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Kick off anything still holding the database open from a previous run.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  // Imported lazily: these modules read DATABASE_URL at import time, and it
  // must point at the database we have just created.
  const { runMigrations } = await import('../db/migrate.js');
  const { seed } = await import('../db/seed.js');
  const { closePool } = await import('../db/pool.js');

  await runMigrations();
  await seed();
  await closePool();
}
