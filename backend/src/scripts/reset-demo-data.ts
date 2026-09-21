/**
 * Clears every demo record so the shop starts clean.
 *
 *   npx tsx src/scripts/reset-demo-data.ts            # shows what would go
 *   npx tsx src/scripts/reset-demo-data.ts --apply    # does it
 *
 * Everything below was invented for testing: the bills, purchases, returns,
 * quotations, payments, stock movements, the customers and suppliers, the
 * demo staff logins, and the prices and stock levels the demo scripts wrote
 * onto the catalogue.
 *
 * What is kept: the admin login, the shop's own settings, units and the
 * warehouse. The items are then re-imported from the old app's export
 * (import-erpnext-items.ts), which brings the catalogue back exactly as the
 * shop had it — names, units, brands and the stock in that file — rather than
 * with numbers made up afterwards.
 *
 * One transaction: either all of it goes or none of it does. Take a
 * pg_dump first; this cannot be undone from inside the app.
 */
import { closePool, withTransaction } from '../db/pool.js';

const APPLY = process.argv.includes('--apply');

/** Children before parents, so nothing is left pointing at a deleted row. */
const TABLES = [
  'payment_allocations',
  'payment_methods_used',
  'payments',
  'sales_return_items',
  'sales_returns',
  'sales_invoice_items',
  'sales_invoices',
  'quotation_items',
  'quotations',
  'purchase_invoice_items',
  'purchase_invoices',
  'expenses',
  'stock_transactions',
  'stock',
  'audit_logs',
  'customers',
  'suppliers',
  'item_variants',
  'items',
] as const;

const DEMO_LOGINS = ['manager@santuhardware.in', 'cashier@santuhardware.in'];

async function main(): Promise<void> {
  await withTransaction(async (client) => {
    console.log(APPLY ? 'Deleting:' : 'Would delete (dry run):');
    for (const table of TABLES) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      console.log(`  ${table.padEnd(24)} ${rows[0]!.n}`);
    }
    const { rows: staff } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE lower(email) = ANY($1)',
      [DEMO_LOGINS],
    );
    console.log(`  demo staff logins        ${staff[0]!.n}`);

    if (!APPLY) {
      console.log('\nDry run — nothing was changed. Re-run with --apply.');
      throw new Error('DRY_RUN');
    }

    await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await client.query('DELETE FROM users WHERE lower(email) = ANY($1)', [DEMO_LOGINS]);

    // The first real bill should be number 1, not 1,033.
    await client.query('UPDATE invoice_sequences SET next_number = 1');

    // Nothing may be left behind.
    for (const table of TABLES) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      if (rows[0]!.n !== 0) throw new Error(`${table} still has ${rows[0]!.n} rows.`);
    }
    console.log('\nAll demo records removed. Invoice numbering restarts at 1.');
  });
}

main()
  .catch((e: Error) => {
    if (e.message !== 'DRY_RUN') {
      console.error(`\nNothing was changed. ${e.message}`);
      process.exitCode = 1;
    }
  })
  .finally(closePool);
