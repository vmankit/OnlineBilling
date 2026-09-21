import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { query } from '../db/pool.js';

export interface TestContext {
  app: FastifyInstance;
  adminToken: string;
  cashierToken: string;
}

/**
 * Requests go through `app.inject()` — the whole Fastify stack (auth, Zod,
 * error handler) runs, but no socket is opened, so the suite is fast and
 * needs no free port.
 */
export async function createContext(): Promise<TestContext> {
  const app = await buildApp();
  await app.ready();

  const adminToken = await login(app, 'admin@santuhardware.in', 'Admin@12345');

  await request(app, adminToken, 'POST', '/api/auth/users', {
    name: 'Counter Cashier',
    email: 'cashier@santuhardware.in',
    password: 'Cashier@12345',
    role: 'CASHIER',
  });
  const cashierToken = await login(app, 'cashier@santuhardware.in', 'Cashier@12345');

  return { app, adminToken, cashierToken };
}

export async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed for ${email}: ${res.statusCode} ${res.body}`);
  }
  return res.json().token as string;
}

export async function request(
  app: FastifyInstance,
  token: string | null,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  let body: unknown = null;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}

/** Looks up a seeded variant by its SKU. */
export async function variantBySku(sku: string): Promise<{
  id: string;
  item_id: string;
  stock_unit: string;
  pack_unit: string;
  pack_size: number;
  selling_price: number;
  purchase_price: number;
}> {
  const { rows } = await query(
    `SELECT v.id, v.item_id, i.stock_unit, v.pack_unit, v.pack_size,
            v.selling_price, v.purchase_price
       FROM item_variants v JOIN items i ON i.id = v.item_id
      WHERE v.sku = $1`,
    [sku],
  );
  if (!rows[0]) throw new Error(`No seeded variant with SKU ${sku}`);
  return rows[0] as never;
}

export async function stockOf(variantId: string): Promise<number> {
  const { rows } = await query<{ quantity: number }>(
    'SELECT coalesce(sum(quantity), 0)::numeric(18,4) AS quantity FROM stock WHERE variant_id = $1',
    [variantId],
  );
  return Number(rows[0]?.quantity ?? 0);
}

export async function customerByName(name: string): Promise<{ id: string; outstanding_balance: number }> {
  const { rows } = await query(
    'SELECT id, outstanding_balance FROM customers WHERE name LIKE $1 LIMIT 1',
    [`${name}%`],
  );
  if (!rows[0]) throw new Error(`No seeded customer like ${name}`);
  return rows[0] as never;
}

export async function ledgerCount(variantId: string): Promise<number> {
  const { rows } = await query<{ count: number }>(
    'SELECT count(*)::int AS count FROM stock_transactions WHERE variant_id = $1',
    [variantId],
  );
  return rows[0]?.count ?? 0;
}
