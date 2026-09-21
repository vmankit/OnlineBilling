import pg from 'pg';
import { env } from '../config/env.js';

const { Pool, types } = pg;

// numeric/decimal -> JS number. Every numeric column in this schema is bounded
// well inside IEEE-754 safe range (max 14,2 money / 18,4 qty), and the API
// contract is JSON numbers rather than strings.
types.setTypeParser(types.builtins.NUMERIC, (v: string) => (v === null ? null : Number(v)));
types.setTypeParser(types.builtins.INT8, (v: string) => (v === null ? null : Number(v)));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client?: Db,
): Promise<pg.QueryResult<T>> {
  return (client ?? pool).query<T>(text, params as never[]);
}

/**
 * Runs `fn` inside a single PostgreSQL transaction.
 * Commits on success, rolls back on ANY thrown error, always releases.
 * This is the only sanctioned way to write multi-table documents
 * (invoice + stock + payment must be all-or-nothing).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken; pool will discard it */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
