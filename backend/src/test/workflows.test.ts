import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '../db/pool.js';
import {
  createContext, customerByName, ledgerCount, request, stockOf, variantBySku,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createContext();
});

afterAll(async () => {
  await ctx.app.close();
  await closePool();
});

// ----------------------------------------------------------------- 1. login
describe('authentication', () => {
  it('signs in a seeded admin and returns their permissions', async () => {
    const res = await request(ctx.app, null, 'POST', '/api/auth/login', {
      email: 'admin@santuhardware.in',
      password: 'Admin@12345',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await request(ctx.app, null, 'POST', '/api/auth/login', {
      email: 'admin@santuhardware.in',
      password: 'not-the-password',
    });
    const noSuchUser = await request(ctx.app, null, 'POST', '/api/auth/login', {
      email: 'nobody@santuhardware.in',
      password: 'not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
  });

  it('refuses an unauthenticated request', async () => {
    const res = await request(ctx.app, null, 'GET', '/api/items');
    expect(res.status).toBe(401);
  });
});

// --------------------------------------------------- 2/3. item and customer
describe('masters', () => {
  it('creates an item with packaging variants', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/items', {
      name: 'Test Cement OPC 53 Grade',
      item_code: 'TST-CEMENT',
      stock_unit: 'KG',
      tax_rate: 28,
      hsn_code: '2523',
      variants: [
        {
          name: '50 KG Bag', sku: 'TST-CEMENT-50', barcode: '9990000000017',
          pack_size: 50, pack_unit: 'KG', purchase_price: 380, selling_price: 440,
          mrp: 470, min_stock: 100, is_default: true, is_active: true,
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.variants).toHaveLength(1);
    expect(res.body.data.variants[0].stock).toBe(0);
  });

  it('refuses a duplicate item code', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/items', {
      name: 'Another Cement', item_code: 'TST-CEMENT', stock_unit: 'KG',
      variants: [{ name: '1 KG', sku: 'DUP-1', pack_size: 1, pack_unit: 'KG' }],
    });
    expect(res.status).toBe(409);
  });

  it('finds an item by a partial, out-of-order search', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/items?q=asian%20apex');
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toContain('Apex Ultima');
  });

  it('resolves a barcode straight to one variant', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/items/barcode/8901234500042');
    expect(res.status).toBe(200);
    expect(res.body.data.variant.sku).toBe('AP-APEXULT-20L');
  });

  it('creates a customer', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/customers', {
      name: 'Test Builder & Co', mobile: '9000000001', address: 'Chhapra Road, Saran', credit_limit: 100000,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.outstanding_balance).toBe(0);
  });
});

// ------------------------------- 4/5/6. sale, stock deduction, full payment
describe('sale', () => {
  it('deducts stock, records a payment and numbers the invoice INV-00001', async () => {
    const variant = await variantBySku('AP-APEXULT-20L');
    const before = await stockOf(variant.id);
    const ledgerBefore = await ledgerCount(variant.id);

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      status: 'COMPLETED',
      items: [
        { variant_id: variant.id, quantity: 2, sold_unit: 'LITRE', rate: 11400 },
      ],
      payments: [{ method: 'CASH', amount: 22800 }],
    });

    expect(res.status).toBe(201);
    const sale = res.body.data;

    // 7. invoice numbering — never "SINV"
    expect(sale.invoice_number).toBe('INV-00001');
    expect(sale.invoice_number.startsWith('SINV')).toBe(false);

    expect(sale.grand_total).toBe(22800);
    expect(sale.paid_amount).toBe(22800);
    expect(sale.due_amount).toBe(0);
    expect(sale.payment_status).toBe('PAID');

    // Sold 2 LITRE out of LITRE stock: a straight 2 off the balance.
    expect(await stockOf(variant.id)).toBe(before - 2);
    expect(await ledgerCount(variant.id)).toBe(ledgerBefore + 1);
  });

  it('allocates the next number to the next bill', async () => {
    const variant = await variantBySku('BO-PUTTY-20');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'KG', rate: 760 }],
      payments: [{ method: 'CASH', amount: 760 }],
    });
    expect(res.body.data.invoice_number).toBe('INV-00002');
  });
});

// ------------------------------------------------ 12. unit conversion on sale
describe('unit conversion', () => {
  it('deducts 0.3048 metre for every foot sold from metre stock', async () => {
    const variant = await variantBySku('AS-CPVC-1-M');
    const before = await stockOf(variant.id);

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 10, sold_unit: 'FEET', rate: 82 }],
      payments: [{ method: 'CASH', amount: 820 }],
    });

    expect(res.status).toBe(201);
    const line = res.body.data.items[0];
    expect(line.quantity).toBe(10);
    expect(line.sold_unit).toBe('FEET');
    expect(Number(line.stock_qty)).toBeCloseTo(3.048, 4);
    expect(await stockOf(variant.id)).toBeCloseTo(before - 3.048, 4);
  });

  it('records what was typed as well as what was deducted', async () => {
    const variant = await variantBySku('AS-CPVC-1-M');
    const { rows } = await query(
      `SELECT entered_qty, entered_unit, quantity FROM stock_transactions
        WHERE variant_id = $1 AND txn_type = 'SALE' ORDER BY created_at DESC LIMIT 1`,
      [variant.id],
    );
    expect(Number(rows[0]!.entered_qty)).toBe(10);
    expect(rows[0]!.entered_unit).toBe('FEET');
    expect(Number(rows[0]!.quantity)).toBeCloseTo(-3.048, 4);
  });
});

// ------------------------------------------------- 7/8. split and partial pay
describe('payments', () => {
  it('accepts a split payment across cash and UPI', async () => {
    const variant = await variantBySku('AP-APEXULT-4L');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 4, sold_unit: 'LITRE', rate: 2450 }],
      payments: [
        { method: 'CASH', amount: 4000 },
        { method: 'UPI', amount: 5800 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.grand_total).toBe(9800);
    expect(res.body.data.paid_amount).toBe(9800);
    expect(res.body.data.payment_status).toBe('PAID');

    const methods = res.body.data.payments[0].methods.map((m: { method: string }) => m.method);
    expect(methods).toContain('CASH');
    expect(methods).toContain('UPI');
  });

  it('leaves a partial payment as a due on the customer ledger', async () => {
    const customer = await customerByName('Ramesh');
    const variant = await variantBySku('AP-ROYALE-20L');

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: customer.id,
      items: [{ variant_id: variant.id, quantity: 20, sold_unit: 'LITRE', rate: 2500 }],
      payments: [{ method: 'CASH', amount: 30000 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.grand_total).toBe(50000);
    expect(res.body.data.due_amount).toBe(20000);
    expect(res.body.data.payment_status).toBe('PARTIAL');

    const after = await customerByName('Ramesh');
    expect(Number(after.outstanding_balance)).toBe(
      Number(customer.outstanding_balance) + 20000,
    );
  });

  it('refuses a credit balance with no saved customer', async () => {
    const variant = await variantBySku('BS-GSB550-1');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'PCS', rate: 4100 }],
      payments: [{ method: 'CASH', amount: 1000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/saved customer/i);
  });

  it('refuses a credit balance for a customer with no address', async () => {
    const created = await request(ctx.app, ctx.adminToken, 'POST', '/api/customers', { name: 'No Address Trader' });
    expect(created.status).toBe(201);
    const variant = await variantBySku('BS-GSB550-1');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: created.body.data.id,
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'PCS', rate: 4100 }],
      payments: [{ method: 'CASH', amount: 1000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/address/i);
  });

  it('settles dues when money is received later', async () => {
    const customer = await customerByName('Ramesh');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/payments', {
      customer_id: customer.id,
      methods: [{ method: 'UPI', amount: 5000, reference: 'UPI/TEST' }],
    });

    expect(res.status).toBe(201);
    const after = await customerByName('Ramesh');
    expect(Number(after.outstanding_balance)).toBe(
      Number(customer.outstanding_balance) - 5000,
    );
  });

  it('refuses a receipt larger than the customer owes', async () => {
    const customer = await customerByName('Ramesh');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/payments', {
      customer_id: customer.id,
      methods: [{ method: 'CASH', amount: 10_000_000 }],
    });
    expect(res.status).toBe(400);
  });
});

// ------------------------------------------------- 9/10. purchase raises stock
describe('purchase', () => {
  it('raises stock and books the supplier payable', async () => {
    const variant = await variantBySku('TST-CEMENT-50');
    const before = await stockOf(variant.id);
    const suppliers = await request(ctx.app, ctx.adminToken, 'GET', '/api/suppliers');
    const supplierId = suppliers.body.data[0].id;

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/purchases', {
      supplier_id: supplierId,
      supplier_invoice_number: 'SUP/2026/118',
      paid_amount: 10000,
      items: [
        {
          variant_id: variant.id, quantity: 100, purchase_unit: 'KG',
          rate: 380, discount_amt: 0, update_purchase_price: true,
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.purchase_number).toBe('PUR-00001');
    expect(res.body.data.grand_total).toBe(38000);
    expect(res.body.data.due_amount).toBe(28000);

    expect(await stockOf(variant.id)).toBe(before + 100);
  });

  it('filters purchase bills by date and totals the whole filter', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/purchases?from=2020-01-01&to=2099-12-31&pageSize=1');
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(38000);
    expect(res.body.summary.paid).toBe(10000);
    expect(res.body.summary.unpaid).toBe(28000);
    expect(res.body.summary.payable).toBeGreaterThanOrEqual(28000);

    const none = await request(ctx.app, ctx.adminToken, 'GET', '/api/purchases?from=2020-01-01&to=2020-01-02');
    expect(none.body.total).toBe(0);
    expect(none.body.summary.total).toBe(0);
  });

  it('pays a mahajan against the oldest bill and refuses to overpay', async () => {
    const suppliers = await request(ctx.app, ctx.adminToken, 'GET', '/api/suppliers');
    const supplierId = suppliers.body.data[0].id;
    const before = (await request(ctx.app, ctx.adminToken, 'GET', `/api/suppliers/${supplierId}`)).body.data;
    const owed = Number(before.outstanding_balance);

    const tooMuch = await request(ctx.app, ctx.adminToken, 'POST', '/api/payments/supplier', {
      supplier_id: supplierId, amount: owed + 1,
    });
    expect(tooMuch.status).toBe(400);

    const ok = await request(ctx.app, ctx.adminToken, 'POST', '/api/payments/supplier', {
      supplier_id: supplierId, amount: 8000, method: 'UPI',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.direction).toBe('OUT');

    const after = (await request(ctx.app, ctx.adminToken, 'GET', `/api/suppliers/${supplierId}`)).body.data;
    expect(Number(after.outstanding_balance)).toBe(owed - 8000);
    const bill = after.purchases.find((p: { purchase_number: string }) => p.purchase_number === 'PUR-00001');
    expect(Number(bill.due_amount)).toBe(20000);
    expect(Number(bill.paid_amount)).toBe(18000);
  });
});

// ------------------------------------------------------------- expenses
describe('expenses', () => {
  it('records an expense, totals it, and cancels without deleting', async () => {
    const created = await request(ctx.app, ctx.adminToken, 'POST', '/api/expenses', {
      category: 'Transport', amount: 450, paid_to: 'Tempo wala',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.expense_number).toBe('EXP-00001');

    await request(ctx.app, ctx.adminToken, 'POST', '/api/expenses', { category: 'Tea / Nashta', amount: 60 });

    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/expenses');
    expect(list.body.summary.total).toBe(510);

    const cancelled = await request(
      ctx.app, ctx.adminToken, 'POST', `/api/expenses/${created.body.data.id}/cancel`,
      { reason: 'Galti se likha' },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const after = await request(ctx.app, ctx.adminToken, 'GET', '/api/expenses');
    // Still listed for the record, no longer counted as money spent.
    expect(after.body.total).toBe(2);
    expect(after.body.summary.total).toBe(60);
  });

  it('keeps a cashier out of the expense book', async () => {
    const res = await request(ctx.app, ctx.cashierToken, 'POST', '/api/expenses', {
      category: 'Other', amount: 10,
    });
    expect(res.status).toBe(403);
  });
});

// --------------------------------------------------------- 11. sales return
describe('sales return', () => {
  it('returns stock and caps the quantity at what was sold', async () => {
    const variant = await variantBySku('NL-BEAUTY-10L');
    const customer = await customerByName('Sunil');

    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: customer.id,
      items: [{ variant_id: variant.id, quantity: 20, sold_unit: 'LITRE', rate: 390 }],
      payments: [{ method: 'CASH', amount: 7800 }],
    });
    expect(sale.status).toBe(201);
    const invoiceId = sale.body.data.id;
    const lineId = sale.body.data.items[0].id;
    const afterSale = await stockOf(variant.id);

    const tooMany = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales-returns', {
      invoice_id: invoiceId,
      items: [{ invoice_item_id: lineId, quantity: 50 }],
    });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.error.message).toMatch(/can still be returned/);
    // The rejected return must not have moved anything.
    expect(await stockOf(variant.id)).toBe(afterSale);

    const ok = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales-returns', {
      invoice_id: invoiceId,
      refund_mode: 'CREDIT_NOTE',
      items: [{ invoice_item_id: lineId, quantity: 5 }],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.return_number).toBe('CRN-00001');
    expect(await stockOf(variant.id)).toBe(afterSale + 5);

    const second = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales-returns', {
      invoice_id: invoiceId,
      items: [{ invoice_item_id: lineId, quantity: 16 }],
    });
    expect(second.status).toBe(422);
  });

  it('cancelling a part-returned bill puts back only what is still out', async () => {
    const variant = await variantBySku('NL-BEAUTY-10L');
    const customer = await customerByName('Sunil');
    const before = await stockOf(variant.id);

    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: customer.id,
      items: [{ variant_id: variant.id, quantity: 10, sold_unit: 'LITRE', rate: 390 }],
      payments: [{ method: 'CASH', amount: 3900 }],
    });
    expect(sale.status).toBe(201);

    const returned = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales-returns', {
      invoice_id: sale.body.data.id,
      refund_mode: 'CREDIT_NOTE',
      items: [{ invoice_item_id: sale.body.data.items[0].id, quantity: 4 }],
    });
    expect(returned.status).toBe(201);
    expect(await stockOf(variant.id)).toBe(before - 6);

    const cancelled = await request(
      ctx.app, ctx.adminToken, 'POST', `/api/sales/${sale.body.data.id}/cancel`,
      { reason: 'Customer changed their mind' },
    );
    expect(cancelled.status).toBe(200);

    // Cancelling used to put the full 10 back on top of the 4 already
    // returned, leaving the shop 4 litres richer than it started.
    expect(await stockOf(variant.id)).toBe(before);
  });
});

// ---------------------------------------------- 11a. per-unit rate precision
describe('selling by a smaller unit', () => {
  it('keeps a fractional per-gram rate exact instead of rounding it to paise', async () => {
    const variant = await variantBySku('BO-PUTTY-1');
    // 42 a kilo is 0.042 a gram. Stored at two decimals that became 0.04, so
    // 500 g showed a rate of 0.04 beside a line total of 21.00.
    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 500, sold_unit: 'GRAM', rate: 0.042 }],
      payments: [{ method: 'CASH', amount: 21 }],
    });
    expect(sale.body.error?.message ?? '').toBe('');
    expect(sale.status).toBe(201);

    const line = sale.body.data.items[0];
    expect(Number(line.rate)).toBeCloseTo(0.042, 4);
    expect(Number(line.line_total)).toBe(21);
    // 500 g is half a kilo of stock.
    expect(Number(line.stock_qty)).toBeCloseTo(0.5, 4);
  });
});

// ------------------------------------------------------- 11b. sales totals
describe('sales list totals', () => {
  it('totals the whole filter, not just the page on screen', async () => {
    const onePage = await request(ctx.app, ctx.adminToken, 'GET', '/api/sales?pageSize=1');
    expect(onePage.status).toBe(200);

    const { rows } = await query<{ sales: number; received: number; balance: number }>(
      `SELECT coalesce(sum(grand_total), 0)::float AS sales,
              coalesce(sum(paid_amount), 0)::float AS received,
              coalesce(sum(due_amount), 0)::float  AS balance
         FROM sales_invoices WHERE status <> 'CANCELLED'`,
    );

    // A one-row page must still report every bill's money. The screen used
    // to add up only the rows it was showing.
    expect(onePage.body.summary.sales).toBeCloseTo(rows[0]!.sales, 2);
    expect(onePage.body.summary.received).toBeCloseTo(rows[0]!.received, 2);
    expect(onePage.body.summary.balance).toBeCloseTo(rows[0]!.balance, 2);
  });

  it('keeps cancelled bills listed but out of the money', async () => {
    const all = await request(ctx.app, ctx.adminToken, 'GET', '/api/sales?pageSize=100');
    const cancelled = all.body.data.filter((s: { status: string }) => s.status === 'CANCELLED');
    expect(cancelled.length).toBeGreaterThan(0);

    const counted = all.body.data
      .filter((s: { status: string }) => s.status !== 'CANCELLED')
      .reduce((sum: number, s: { grand_total: number }) => sum + Number(s.grand_total), 0);
    expect(all.body.summary.sales).toBeCloseTo(counted, 2);
  });

  it('includes the whole of the last day when filtered by plain dates', async () => {
    // "Today" is the database's today. A date taken from JS in UTC is the day
    // before between midnight and 05:30 IST, which made this test fail for
    // the first five and a half hours of every day.
    const { rows } = await query<{ today: string }>(`SELECT to_char(now(), 'YYYY-MM-DD') AS today`);
    const today = rows[0]!.today;
    const res = await request(ctx.app, ctx.adminToken, 'GET', `/api/sales?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    // Bills made during this test run are dated today; a "to" that meant
    // midnight would have returned none of them.
    expect(res.body.total).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------ 12. stock summary
describe('stock summary', () => {
  it('counts items, not variants, so Home and the Items list agree', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/items/summary');
    expect(res.status).toBe(200);
    const summary = res.body.data;

    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/items?pageSize=1');
    expect(summary.items).toBe(list.body.total);

    // Home's Low Stock card opens exactly this list, so the two counts have
    // to be of the same thing — counting variants made them disagree.
    const low = await request(ctx.app, ctx.adminToken, 'GET', '/api/items?lowStockOnly=true&pageSize=1');
    expect(summary.low_count).toBe(low.body.total);
  });

  it('values a pack price against stock held in the stock unit', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/items/summary');
    const { rows } = await query<{ expected: string }>(
      `SELECT coalesce(sum(q.qty * v.purchase_price / nullif(v.pack_size, 0)), 0)::float AS expected
         FROM item_variants v
         JOIN items i ON i.id = v.item_id AND i.is_active
         LEFT JOIN LATERAL (SELECT coalesce(sum(s.quantity), 0) AS qty
                              FROM stock s WHERE s.variant_id = v.id) q ON true
        WHERE v.is_active`,
    );
    expect(res.body.data.stock_value).toBeCloseTo(Number(rows[0]!.expected), 2);
  });
});

// ------------------------------------------ 13. historical price immutability
describe('price changes', () => {
  it('reports a drift between a held rate and the current master price', async () => {
    const variant = await variantBySku('AP-APEXULT-20L');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales/price-check', {
      items: [{ variant_id: variant.id, rate: 9500 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].old_rate).toBe(9500);
    expect(res.body.data[0].new_rate).toBe(11400);
    expect(res.body.data[0].difference).toBe(1900);
  });

  it('leaves an issued invoice untouched when the item price changes', async () => {
    const variant = await variantBySku('JK-PRIMER-4L');

    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 4, sold_unit: 'LITRE', rate: 920 }],
      payments: [{ method: 'CASH', amount: 3680 }],
    });
    const invoiceId = sale.body.data.id;

    const item = await request(ctx.app, ctx.adminToken, 'GET', `/api/items/${variant.item_id}`);
    const payload = item.body.data;
    await request(ctx.app, ctx.adminToken, 'PUT', `/api/items/${variant.item_id}`, {
      ...payload,
      variants: payload.variants.map((v: { id: string }) =>
        v.id === variant.id ? { ...v, selling_price: 1400 } : v,
      ),
    });

    const after = await request(ctx.app, ctx.adminToken, 'GET', `/api/sales/${invoiceId}`);
    expect(Number(after.body.data.items[0].rate)).toBe(920);
    expect(Number(after.body.data.grand_total)).toBe(3680);

    const audit = await query(
      `SELECT action FROM audit_logs WHERE action = 'PRICE_CHANGE' AND entity_id = $1`,
      [variant.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});

// -------------------------------------------- 14. transaction rollback
describe('data integrity', () => {
  it('writes nothing at all when one line of a bill is unsellable', async () => {
    const good = await variantBySku('BO-PUTTY-5');
    const stockBefore = await stockOf(good.id);
    const { rows: seqBefore } = await query<{ next_number: number }>(
      `SELECT next_number FROM invoice_sequences WHERE doc_type = 'SALES_INVOICE'`,
    );
    const { rows: countBefore } = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM sales_invoices',
    );

    // Second line asks for far more than exists: the whole bill must fail.
    // A saved customer is used so the credit-balance rule cannot fire first —
    // the rejection under test has to come from the stock check.
    const customer = await customerByName('Test Builder');
    const scarce = await variantBySku('BS-GSB550-1');
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: customer.id,
      items: [
        { variant_id: good.id, quantity: 5, sold_unit: 'KG', rate: 198 },
        { variant_id: scarce.id, quantity: 999, sold_unit: 'PCS', rate: 4100 },
      ],
      payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    // Stock untouched, no invoice row, and the number was handed back.
    expect(await stockOf(good.id)).toBe(stockBefore);

    const { rows: countAfter } = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM sales_invoices',
    );
    expect(countAfter[0]!.count).toBe(countBefore[0]!.count);

    const { rows: seqAfter } = await query<{ next_number: number }>(
      `SELECT next_number FROM invoice_sequences WHERE doc_type = 'SALES_INVOICE'`,
    );
    expect(Number(seqAfter[0]!.next_number)).toBe(Number(seqBefore[0]!.next_number));
  });

  it('never issues the same invoice number twice under concurrency', async () => {
    const variant = await variantBySku('GN-NAIL-2-KG');
    const bills = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
          customer_name: 'Walk-in Customer',
          items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'KG', rate: 95 }],
          payments: [{ method: 'CASH', amount: 95 }],
        }),
      ),
    );

    expect(bills.every((b) => b.status === 201)).toBe(true);
    const numbers = bills.map((b) => b.body.data.invoice_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('keeps a cancelled invoice on file and puts its stock back', async () => {
    const variant = await variantBySku('GN-ELBOW-15-1');
    const before = await stockOf(variant.id);

    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 3, sold_unit: 'PCS', rate: 120 }],
      payments: [{ method: 'CASH', amount: 360 }],
    });
    expect(await stockOf(variant.id)).toBe(before - 3);

    const cancelled = await request(
      ctx.app, ctx.adminToken, 'POST', `/api/sales/${sale.body.data.id}/cancel`,
      { reason: 'Customer changed their mind' },
    );

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await stockOf(variant.id)).toBe(before);

    const stillThere = await query(
      'SELECT status FROM sales_invoices WHERE id = $1',
      [sale.body.data.id],
    );
    expect(stillThere.rows[0]).toBeTruthy();
  });
});

// ------------------------------------------------------ 15. permission checks
describe('permissions', () => {
  it('lets a cashier bill but not change item prices', async () => {
    const variant = await variantBySku('BO-PUTTY-5');

    const sale = await request(ctx.app, ctx.cashierToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'KG', rate: 198 }],
      payments: [{ method: 'CASH', amount: 198 }],
    });
    expect(sale.status).toBe(201);

    const item = await request(ctx.app, ctx.cashierToken, 'GET', `/api/items/${variant.item_id}`);
    const update = await request(
      ctx.app, ctx.cashierToken, 'PUT', `/api/items/${variant.item_id}`, item.body.data,
    );
    expect(update.status).toBe(403);
  });

  it('does not let a cashier cancel an invoice or record a purchase', async () => {
    const sales = await request(ctx.app, ctx.cashierToken, 'GET', '/api/sales');
    const anyInvoice = sales.body.data[0];

    const cancel = await request(
      ctx.app, ctx.cashierToken, 'POST', `/api/sales/${anyInvoice.id}/cancel`,
      { reason: 'should not be allowed' },
    );
    expect(cancel.status).toBe(403);

    const purchase = await request(ctx.app, ctx.cashierToken, 'POST', '/api/purchases', {
      supplier_id: '00000000-0000-0000-0000-000000000000',
      items: [],
    });
    expect(purchase.status).toBe(403);
  });
});

// ------------------------------------------------------- 16. stock adjustment
describe('stock adjustment', () => {
  it('converts the entered unit and records the reason in the ledger', async () => {
    const variant = await variantBySku('GN-NAIL-2-KG');
    const before = await stockOf(variant.id);

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/stock/adjustments', {
      variant_id: variant.id,
      quantity: -500,
      unit: 'GRAM',
      reason: 'Rusted stock written off',
    });

    expect(res.status).toBe(201);
    // 500 g off a KG-stocked item is half a kilo, not 500.
    expect(await stockOf(variant.id)).toBeCloseTo(before - 0.5, 4);

    const { rows } = await query(
      `SELECT entered_qty, entered_unit, quantity, notes FROM stock_transactions
        WHERE variant_id = $1 AND txn_type = 'ADJUSTMENT' ORDER BY created_at DESC LIMIT 1`,
      [variant.id],
    );
    expect(rows[0]!.entered_unit).toBe('GRAM');
    expect(Number(rows[0]!.quantity)).toBeCloseTo(-0.5, 4);
    expect(rows[0]!.notes).toMatch(/Rusted/);
  });
});

// ------------------------------------------------------------------ reports
describe('reports', () => {
  it('reports profit from the cost snapshotted at sale time', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/reports/profit');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.length).toBeGreaterThan(0);
    expect(res.body.data.totals.revenue).toBeGreaterThan(0);
    expect(res.body.data.totals.cost).toBeGreaterThan(0);
  });

  it('exports a report as CSV', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/reports/daily-sales?format=csv',
      headers: { authorization: `Bearer ${ctx.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\n')[0]).toBe('Date,Bills,Sales,Discount,Collected,Due');
  });

  it('keeps reports away from a cashier', async () => {
    const res = await request(ctx.app, ctx.cashierToken, 'GET', '/api/reports/profit');
    expect(res.status).toBe(403);
  });
});

// ------------------------------------------------------------ error envelope
describe('error handling', () => {
  it('returns a field-level message for an invalid body', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/customers', { name: 'X' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields[0].path).toBe('name');
  });

  it('never leaks a stack trace', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});

// ------------------------------------------------------------- quotations
describe('quotations', () => {
  it('holds a price without touching stock', async () => {
    const variant = await variantBySku('AP-ROYALE-4L');
    const customer = await customerByName('Gupta');
    const stockBefore = await stockOf(variant.id);

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/quotations', {
      customer_id: customer.id,
      valid_until: '2026-12-31',
      items: [{ variant_id: variant.id, quantity: 8, sold_unit: 'LITRE', rate: 2800 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.quotation_number).toBe('QTN-00001');
    expect(res.body.data.status).toBe('OPEN');
    expect(Number(res.body.data.grand_total)).toBe(22400);

    // A quotation reserves nothing.
    expect(await stockOf(variant.id)).toBe(stockBefore);
    const { rows } = await query(
      `SELECT count(*)::int AS count FROM stock_transactions
        WHERE reference_type = 'QUOTATION'`,
    );
    expect(rows[0]!.count).toBe(0);
  });

  it('reports the drift between the quoted and the current price', async () => {
    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/quotations?status=OPEN');
    const quotationId = list.body.data[0].id;

    const res = await request(
      ctx.app, ctx.adminToken, 'GET', `/api/quotations/${quotationId}/for-billing`,
    );
    expect(res.status).toBe(200);
    // Quoted at 2800 against a 2900 master price.
    expect(res.body.data.differences).toHaveLength(1);
    expect(res.body.data.differences[0].old_rate).toBe(2800);
    expect(res.body.data.differences[0].new_rate).toBe(2900);
  });

  it('bills a quotation at the quoted price and marks it converted', async () => {
    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/quotations?status=OPEN');
    const quotation = list.body.data[0];
    const variant = await variantBySku('AP-ROYALE-4L');
    const stockBefore = await stockOf(variant.id);

    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: quotation.customer_id,
      quotation_id: quotation.id,
      // The operator chose KEEP QUOTATION PRICE.
      items: [{ variant_id: variant.id, quantity: 8, sold_unit: 'LITRE', rate: 2800 }],
      payments: [{ method: 'CASH', amount: 22400 }],
    });

    expect(sale.status).toBe(201);
    expect(Number(sale.body.data.items[0].rate)).toBe(2800);
    // Now the stock moves — at billing time, not at quotation time.
    expect(await stockOf(variant.id)).toBe(stockBefore - 8);

    const after = await request(ctx.app, ctx.adminToken, 'GET', `/api/quotations/${quotation.id}`);
    expect(after.body.data.status).toBe('CONVERTED');
    expect(after.body.data.converted_invoice_number).toBe(sale.body.data.invoice_number);
  });

  it('refuses to bill the same quotation twice', async () => {
    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/quotations?status=CONVERTED');
    const quotation = list.body.data[0];
    const variant = await variantBySku('AP-ROYALE-4L');

    const res = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_id: quotation.customer_id,
      quotation_id: quotation.id,
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'LITRE', rate: 2800 }],
      payments: [{ method: 'CASH', amount: 2800 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already been billed/i);

    const forBilling = await request(
      ctx.app, ctx.adminToken, 'GET', `/api/quotations/${quotation.id}/for-billing`,
    );
    expect(forBilling.status).toBe(409);
  });

  it('cannot cancel a quotation that is already billed', async () => {
    const list = await request(ctx.app, ctx.adminToken, 'GET', '/api/quotations?status=CONVERTED');
    const res = await request(
      ctx.app, ctx.adminToken, 'POST', `/api/quotations/${list.body.data[0].id}/cancel`,
    );
    expect(res.status).toBe(409);
  });

  it('keeps the quoted price even after the item master changes', async () => {
    const variant = await variantBySku('NL-BEAUTY-1L');

    const quote = await request(ctx.app, ctx.adminToken, 'POST', '/api/quotations', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 3, sold_unit: 'LITRE', rate: 400 }],
    });
    expect(quote.status).toBe(201);

    const item = await request(ctx.app, ctx.adminToken, 'GET', `/api/items/${variant.item_id}`);
    await request(ctx.app, ctx.adminToken, 'PUT', `/api/items/${variant.item_id}`, {
      ...item.body.data,
      variants: item.body.data.variants.map((v: { id: string }) =>
        v.id === variant.id ? { ...v, selling_price: 999 } : v,
      ),
    });

    const after = await request(ctx.app, ctx.adminToken, 'GET', `/api/quotations/${quote.body.data.id}`);
    expect(Number(after.body.data.items[0].rate)).toBe(400);

    const forBilling = await request(
      ctx.app, ctx.adminToken, 'GET', `/api/quotations/${quote.body.data.id}/for-billing`,
    );
    expect(forBilling.body.data.differences[0].old_rate).toBe(400);
    expect(forBilling.body.data.differences[0].new_rate).toBe(999);
  });
});

// ------------------------------------------------------- numbering series
describe('invoice numbering settings', () => {
  it('lists every series with its current counter', async () => {
    const res = await request(ctx.app, ctx.adminToken, 'GET', '/api/masters/sequences');
    expect(res.status).toBe(200);
    const sales = res.body.data.find((s: { doc_type: string }) => s.doc_type === 'SALES_INVOICE');
    expect(sales.prefix).toBe('INV-');
    expect(sales.padding).toBe(5);
  });

  it('changes the prefix, and the next bill uses it', async () => {
    const before = await request(ctx.app, ctx.adminToken, 'GET', '/api/masters/sequences');
    const sales = before.body.data.find((s: { doc_type: string }) => s.doc_type === 'SALES_INVOICE');

    const saved = await request(
      ctx.app, ctx.adminToken, 'PUT', '/api/masters/sequences/SALES_INVOICE',
      { prefix: 'SH/{YYYY}/', suffix: '', padding: 4, next_number: sales.next_number },
    );
    expect(saved.status).toBe(200);

    const variant = await variantBySku('BO-PUTTY-1');
    const sale = await request(ctx.app, ctx.adminToken, 'POST', '/api/sales', {
      customer_name: 'Walk-in Customer',
      items: [{ variant_id: variant.id, quantity: 1, sold_unit: 'KG', rate: 42 }],
      payments: [{ method: 'CASH', amount: 42 }],
    });

    const year = new Date().getFullYear();
    expect(sale.body.data.invoice_number).toBe(
      `SH/${year}/${String(sales.next_number).padStart(4, '0')}`,
    );
  });

  it('refuses to wind the counter back onto numbers already issued', async () => {
    const res = await request(
      ctx.app, ctx.adminToken, 'PUT', '/api/masters/sequences/SALES_INVOICE',
      { prefix: 'INV-', suffix: '', padding: 5, next_number: 1 },
    );
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already issued/i);
  });

  it('still refuses SINV as a prefix', async () => {
    const res = await request(
      ctx.app, ctx.adminToken, 'PUT', '/api/masters/sequences/SALES_INVOICE',
      { prefix: 'SINV-', suffix: '', padding: 5, next_number: 9999 },
    );
    expect(res.status).toBe(400);
  });

  it('keeps numbering settings away from a cashier', async () => {
    const res = await request(
      ctx.app, ctx.cashierToken, 'PUT', '/api/masters/sequences/SALES_INVOICE',
      { prefix: 'X-', suffix: '', padding: 5, next_number: 9999 },
    );
    expect(res.status).toBe(403);
  });
});
