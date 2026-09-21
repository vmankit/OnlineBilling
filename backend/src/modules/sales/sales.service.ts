import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { calculateBill, derivePaymentStatus } from '../../services/pricing.service.js';
import { applyStockMovement, getDefaultWarehouseId } from '../../services/stock.service.js';
import {
  loadOverridesForItems, loadUnits, resolveStockQuantity, type UnitRow,
} from '../../services/units.service.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { money, qty } from '../../utils/number.js';
import type { AuthUser, Paginated } from '../../types/index.js';
import type { CreateSaleInput, ListSalesQuery } from './sales.schema.js';

interface VariantContext {
  variant_id: string;
  item_id: string;
  item_name: string;
  item_code: string;
  hsn_code: string | null;
  tax_rate: number;
  stock_unit: string;
  variant_name: string;
  pack_size: number;
  pack_unit: string;
  purchase_price: number;
  mrp: number;
  is_active: boolean;
  item_active: boolean;
}

async function loadVariantContext(client: PoolClient, variantIds: string[]): Promise<Map<string, VariantContext>> {
  const { rows } = await client.query<VariantContext>(
    `SELECT v.id AS variant_id, i.id AS item_id, i.name AS item_name, i.item_code,
            i.hsn_code, i.tax_rate, i.stock_unit, v.name AS variant_name,
            v.pack_size, v.pack_unit, v.purchase_price, v.mrp,
            v.is_active, i.is_active AS item_active
       FROM item_variants v
       JOIN items i ON i.id = v.item_id
      WHERE v.id = ANY($1::uuid[])`,
    [variantIds],
  );
  return new Map(rows.map((r) => [r.variant_id, r]));
}

function unitOrThrow(units: Map<string, UnitRow>, code: string): UnitRow {
  const unit = units.get(code);
  if (!unit) throw badRequest(`Unknown unit "${code}".`);
  return unit;
}

export async function createSale(input: CreateSaleInput, user: AuthUser, ip?: string): Promise<string> {
  return withTransaction(async (client) => {
    const warehouseId = input.warehouse_id ?? (await getDefaultWarehouseId(client));

    // ---- resolve masters -------------------------------------------------
    const variantIds = input.items.map((l) => l.variant_id);
    const contexts = await loadVariantContext(client, variantIds);
    const missing = variantIds.filter((id) => !contexts.has(id));
    if (missing.length) throw notFound('One of the items on this bill');

    const units = await loadUnits(client);
    const itemIds = [...new Set([...contexts.values()].map((c) => c.item_id))];
    const overrides = await loadOverridesForItems(itemIds, client);

    let customerName = input.customer_name?.trim() ?? 'Walk-in Customer';
    let customerMobile: string | null = input.customer_mobile?.trim() ?? null;
    let customerAddress: string | null = input.customer_address?.trim() ?? null;
    let customerGstin: string | null = input.customer_gstin?.trim() ?? null;

    if (input.customer_id) {
      const { rows } = await client.query<{
        name: string; mobile: string | null; address: string | null; gstin: string | null;
      }>('SELECT name, mobile, address, gstin FROM customers WHERE id = $1 FOR UPDATE', [
        input.customer_id,
      ]);
      const customer = rows[0];
      if (!customer) throw notFound('Customer');
      customerName = customer.name;
      customerMobile = customer.mobile ?? customerMobile;
      customerAddress = customer.address ?? customerAddress;
      customerGstin = customer.gstin ?? customerGstin;
    }

    // ---- arithmetic (server-side, never trusted from the client) ---------
    const prepared = input.items.map((line) => {
      const ctx = contexts.get(line.variant_id)!;
      if (!ctx.is_active || !ctx.item_active) {
        throw unprocessable(`${ctx.item_name} is inactive and cannot be billed.`);
      }

      const soldUnit = unitOrThrow(units, line.sold_unit);
      const packUnit = unitOrThrow(units, ctx.pack_unit);
      const stockUnit = unitOrThrow(units, ctx.stock_unit);

      const stockQty = resolveStockQuantity({
        quantity: line.quantity,
        soldUnit,
        packSize: Number(ctx.pack_size),
        packUnit,
        stockUnit,
        overrides,
      });

      // Cost of goods for this line, snapshotted so profit reports stay true
      // even after the item's purchase price or pack size changes.
      const costAmount = money(
        (stockQty * Number(ctx.purchase_price)) / Number(ctx.pack_size || 1),
      );

      return { line, ctx, stockQty, stockUnit, costAmount };
    });

    const totals = calculateBill(
      prepared.map(({ line, ctx }) => ({
        quantity: line.quantity,
        rate: line.rate,
        discountPct: line.discount_pct,
        discountAmt: line.discount_amt,
      })),
      { billDiscount: input.bill_discount, roundOff: input.round_off },
    );

    const paidAmount = money(input.payments.reduce((sum, p) => sum + p.amount, 0));
    if (paidAmount > totals.grandTotal + 0.01) {
      throw badRequest('Amount received is more than the bill total.');
    }
    const dueAmount = money(Math.max(0, totals.grandTotal - paidAmount));

    if (dueAmount > 0 && !input.customer_id && input.status === 'COMPLETED') {
      throw unprocessable('A credit balance needs a saved customer. Add the customer first.');
    }
    // Udhaar is only for a customer the shop can find again: name and address are both required.
    if (dueAmount > 0 && input.status === 'COMPLETED' && (!customerName.trim() || !customerAddress?.trim())) {
      throw unprocessable('Baki (udhaar) ke liye customer ka naam aur address zaroori hai. Pehle Parties me address bharein.');
    }

    // A quotation may only be billed once. Locking it here means two tills
    // cannot convert the same estimate into two invoices.
    if (input.quotation_id) {
      const { rows } = await client.query<{ status: string; quotation_number: string }>(
        'SELECT status, quotation_number FROM quotations WHERE id = $1 FOR UPDATE',
        [input.quotation_id],
      );
      const quotation = rows[0];
      if (!quotation) throw notFound('Quotation');
      if (quotation.status === 'CONVERTED') {
        throw conflict(`Quotation ${quotation.quotation_number} has already been billed.`);
      }
      if (quotation.status === 'CANCELLED') {
        throw unprocessable(`Quotation ${quotation.quotation_number} was cancelled.`);
      }
    }

    // ---- invoice header --------------------------------------------------
    const invoiceNumber = await nextDocumentNumber(client, 'SALES_INVOICE');
    const paymentStatus = derivePaymentStatus(totals.grandTotal, paidAmount);

    const invoiceRes = await client.query<{ id: string }>(
      `INSERT INTO sales_invoices
         (invoice_number, customer_id, customer_name, customer_mobile, customer_address,
          customer_gstin, warehouse_id, subtotal, item_discount, bill_discount, tax_amount,
          round_off, grand_total, paid_amount, due_amount, payment_status, status, notes,
          created_by, quotation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING id`,
      [
        invoiceNumber, input.customer_id ?? null, customerName, customerMobile, customerAddress,
        customerGstin, warehouseId, totals.subtotal, totals.itemDiscount, totals.billDiscount,
        0, totals.roundOff, totals.grandTotal, paidAmount, dueAmount,
        paymentStatus, input.status, input.notes ?? null, user.id, input.quotation_id ?? null,
      ],
    );
    const invoiceId = invoiceRes.rows[0]!.id;

    // ---- lines + stock ---------------------------------------------------
    for (const [index, { line, ctx, stockQty, stockUnit, costAmount }] of prepared.entries()) {
      const computed = totals.lines[index]!;

      await client.query(
        `INSERT INTO sales_invoice_items
           (invoice_id, variant_id, line_no, item_name, item_code, hsn_code, variant_name,
            quantity, sold_unit, stock_qty, rate, mrp, purchase_rate, discount_pct,
            discount_amt, tax_rate, tax_amount, line_total, cost_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          invoiceId, line.variant_id, index + 1, ctx.item_name, ctx.item_code, ctx.hsn_code,
          ctx.variant_name, line.quantity, line.sold_unit, stockQty, line.rate, ctx.mrp,
          ctx.purchase_price, line.discount_pct ?? 0, computed.discount ?? 0, 0,
          0, computed.lineTotal, costAmount,
        ],
      );

      // Held bills and drafts reserve nothing: stock moves only when the sale
      // is actually completed.
      if (input.status === 'COMPLETED') {
        await applyStockMovement(client, {
          variantId: line.variant_id,
          warehouseId,
          txnType: 'SALE',
          quantity: -stockQty,
          enteredQty: line.quantity,
          enteredUnit: line.sold_unit,
          rate: line.rate,
          referenceType: 'SALES_INVOICE',
          referenceId: invoiceId,
          notes: invoiceNumber,
          userId: user.id,
          itemLabel: `${ctx.item_name} (${ctx.variant_name})`,
          stockUnit: stockUnit.code,
        });
      }
    }

    // ---- payment ---------------------------------------------------------
    if (paidAmount > 0 && input.status === 'COMPLETED') {
      const paymentNumber = await nextDocumentNumber(client, 'PAYMENT');
      const paymentRes = await client.query<{ id: string }>(
        `INSERT INTO payments
           (payment_number, party_type, customer_id, direction, amount, notes, created_by)
         VALUES ($1,'CUSTOMER',$2,'IN',$3,$4,$5) RETURNING id`,
        [paymentNumber, input.customer_id ?? null, paidAmount, `Against ${invoiceNumber}`, user.id],
      );
      const paymentId = paymentRes.rows[0]!.id;

      for (const tender of input.payments) {
        if (tender.amount <= 0) continue;
        await client.query(
          `INSERT INTO payment_methods_used (payment_id, method, amount, reference)
           VALUES ($1,$2,$3,$4)`,
          [paymentId, tender.method, tender.amount, tender.reference ?? null],
        );
      }

      await client.query(
        `INSERT INTO payment_allocations (payment_id, document_type, document_id, amount)
         VALUES ($1,'SALES_INVOICE',$2,$3)`,
        [paymentId, invoiceId, paidAmount],
      );
    }

    // ---- customer ledger -------------------------------------------------
    if (input.customer_id && dueAmount > 0 && input.status === 'COMPLETED') {
      await client.query(
        `UPDATE customers SET outstanding_balance = outstanding_balance + $2, updated_at = now()
          WHERE id = $1`,
        [input.customer_id, dueAmount],
      );
    }

    if (input.quotation_id && input.status === 'COMPLETED') {
      await client.query(
        `UPDATE quotations
            SET status = 'CONVERTED', converted_invoice_id = $2, converted_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [input.quotation_id, invoiceId],
      );
      await recordAudit(
        {
          userId: user.id, userName: user.name, action: 'QUOTATION_CONVERT',
          entityType: 'QUOTATION', entityId: input.quotation_id,
          newValue: { invoiceNumber, grandTotal: totals.grandTotal }, ip,
        },
        client,
      );
    }

    await recordAudit(
      {
        userId: user.id, userName: user.name, action: 'SALE_CREATE',
        entityType: 'SALES_INVOICE', entityId: invoiceId,
        newValue: { invoiceNumber, grandTotal: totals.grandTotal, paidAmount, dueAmount, status: input.status },
        ip,
      },
      client,
    );

    return invoiceId;
  });
}

export async function cancelSale(id: string, reason: string, user: AuthUser, ip?: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string; invoice_number: string; status: string; warehouse_id: string;
      customer_id: string | null; due_amount: number;
    }>('SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE', [id]);

    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice');
    if (invoice.status === 'CANCELLED') throw conflict('This invoice is already cancelled.');

    // Quantities already handed back by a credit note are subtracted: that
    // stock is on the shelf again, and putting the whole line back a second
    // time invented goods the shop never had.
    const lines = await client.query<{
      variant_id: string | null; stock_qty: number; item_name: string; returned_qty: number;
    }>(
      `SELECT ii.variant_id, ii.stock_qty, ii.item_name,
              coalesce(sum(ri.stock_qty), 0) AS returned_qty
         FROM sales_invoice_items ii
         LEFT JOIN sales_return_items ri ON ri.invoice_item_id = ii.id
        WHERE ii.invoice_id = $1
        GROUP BY ii.id`,
      [id],
    );

    if (invoice.status === 'COMPLETED') {
      for (const line of lines.rows) {
        if (!line.variant_id) continue;
        const putBack = qty(Number(line.stock_qty) - Number(line.returned_qty));
        if (putBack <= 0) continue;
        await applyStockMovement(client, {
          variantId: line.variant_id,
          warehouseId: invoice.warehouse_id,
          txnType: 'CANCELLATION',
          quantity: putBack,
          referenceType: 'SALES_INVOICE',
          referenceId: id,
          notes: `Cancelled ${invoice.invoice_number}: ${reason}`,
          userId: user.id,
        });
      }

      if (invoice.customer_id && Number(invoice.due_amount) > 0) {
        await client.query(
          `UPDATE customers SET outstanding_balance = outstanding_balance - $2, updated_at = now()
            WHERE id = $1`,
          [invoice.customer_id, invoice.due_amount],
        );
      }
    }

    // The row is never deleted — a cancelled invoice stays on file for audit.
    await client.query(
      `UPDATE sales_invoices
          SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancel_reason=$3, updated_at=now()
        WHERE id=$1`,
      [id, user.id, reason],
    );

    await recordAudit(
      {
        userId: user.id, userName: user.name, action: 'SALE_CANCEL',
        entityType: 'SALES_INVOICE', entityId: id,
        oldValue: { status: invoice.status }, newValue: { status: 'CANCELLED', reason }, ip,
      },
      client,
    );
  });
}

export async function getSale(id: string): Promise<unknown> {
  const { rows } = await query('SELECT * FROM sales_invoices WHERE id = $1', [id]);
  const invoice = rows[0];
  if (!invoice) throw notFound('Invoice');

  const items = await query(
    'SELECT * FROM sales_invoice_items WHERE invoice_id = $1 ORDER BY line_no',
    [id],
  );
  const payments = await query(
    `SELECT p.id, p.payment_number, p.amount, p.payment_date,
            coalesce(json_agg(json_build_object('method', m.method, 'amount', m.amount,
                                                'reference', m.reference))
                     FILTER (WHERE m.id IS NOT NULL), '[]') AS methods
       FROM payment_allocations a
       JOIN payments p ON p.id = a.payment_id
       LEFT JOIN payment_methods_used m ON m.payment_id = p.id
      WHERE a.document_type = 'SALES_INVOICE' AND a.document_id = $1
      GROUP BY p.id
      ORDER BY p.created_at`,
    [id],
  );
  const business = await query<{ value: unknown }>(
    `SELECT value FROM settings WHERE key = 'business'`,
  );

  return {
    ...invoice,
    items: items.rows,
    payments: payments.rows,
    business: business.rows[0]?.value ?? null,
  };
}

export interface SalesTotals {
  /** Excludes cancelled bills — they stay listed but are not money taken. */
  sales: number;
  received: number;
  balance: number;
  /** Credit notes raised against these bills. */
  returns: number;
}

export async function listSales(
  params: ListSalesQuery,
): Promise<Paginated<unknown> & { summary: SalesTotals }> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (v: unknown): string => {
    values.push(v);
    return `$${values.length}`;
  };

  if (params.q?.trim()) {
    const p = add(`%${params.q.trim().toLowerCase()}%`);
    where.push(`(lower(invoice_number) LIKE ${p} OR lower(customer_name) LIKE ${p}
                 OR coalesce(customer_mobile,'') LIKE ${p})`);
  }
  if (params.customerId) where.push(`customer_id = ${add(params.customerId)}::uuid`);
  if (params.status) where.push(`status = ${add(params.status)}`);
  if (params.paymentStatus) where.push(`payment_status = ${add(params.paymentStatus)}`);
  if (params.from) where.push(`invoice_date >= ${add(params.from)}::timestamptz`);
  // A plain date means the whole of that day — bills raised at 11am on the
  // "to" date would otherwise fall outside a range that names it.
  if (params.to) {
    where.push(
      /^\d{4}-\d{2}-\d{2}$/.test(params.to)
        ? `invoice_date < ${add(params.to)}::timestamptz + interval '1 day'`
        : `invoice_date <= ${add(params.to)}::timestamptz`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Counts AND money for the whole filter, not just the page being shown.
  // The screen used to add up the 25 rows on screen and call that the
  // month's sales, which under-reported a busy month by most of its value.
  // A cancelled bill stays in the list for audit but is not money taken.
  const totalRes = await query<{
    count: number; sales: number; received: number; balance: number;
  }>(
    `SELECT count(*)::int AS count,
            coalesce(sum(grand_total) FILTER (WHERE status <> 'CANCELLED'), 0)::float  AS sales,
            coalesce(sum(paid_amount) FILTER (WHERE status <> 'CANCELLED'), 0)::float  AS received,
            coalesce(sum(due_amount)  FILTER (WHERE status <> 'CANCELLED'), 0)::float  AS balance
       FROM sales_invoices ${whereSql}`,
    values,
  );
  const totals = totalRes.rows[0]!;
  const total = totals.count;

  // Goods handed back against these bills. Shown beside the totals so that
  // Received + Balance falling short of Total Sales has a visible reason —
  // a credit note settles part of a bill without being a payment or a due.
  const returnsRes = await query<{ returns: number }>(
    `SELECT coalesce(sum(sr.total_amount), 0)::float AS returns
       FROM sales_returns sr
      WHERE sr.invoice_id IN (SELECT id FROM sales_invoices ${whereSql}
                               ${where.length ? 'AND' : 'WHERE'} status <> 'CANCELLED')`,
    values,
  );

  const offset = add((params.page - 1) * params.pageSize);
  const limit = add(params.pageSize);
  const { rows } = await query(
    `SELECT id, invoice_number, customer_id, customer_name, customer_mobile, customer_address,
            invoice_date, grand_total, paid_amount, due_amount, payment_status, status, created_at
       FROM sales_invoices ${whereSql}
      ORDER BY created_at DESC
      OFFSET ${offset} LIMIT ${limit}`,
    values,
  );

  return {
    data: rows,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    summary: {
      sales: totals.sales,
      received: totals.received,
      balance: totals.balance,
      returns: returnsRes.rows[0]?.returns ?? 0,
    },
  };
}

/**
 * Price check used by the POS before a held bill or quotation is converted:
 * reports every line whose current master price differs from the stored one.
 */
export async function comparePrices(
  lines: Array<{ variant_id: string; rate: number }>,
): Promise<Array<{ variant_id: string; item_name: string; old_rate: number; new_rate: number; difference: number }>> {
  if (!lines.length) return [];
  const { rows } = await query<{ id: string; name: string; selling_price: number }>(
    `SELECT v.id, i.name || ' · ' || v.name AS name, v.selling_price
       FROM item_variants v JOIN items i ON i.id = v.item_id
      WHERE v.id = ANY($1::uuid[])`,
    [lines.map((l) => l.variant_id)],
  );
  const current = new Map(rows.map((r) => [r.id, r]));

  return lines
    .map((line) => {
      const master = current.get(line.variant_id);
      if (!master) return null;
      const newRate = Number(master.selling_price);
      if (Math.abs(newRate - line.rate) < 0.005) return null;
      return {
        variant_id: line.variant_id,
        item_name: master.name,
        old_rate: money(line.rate),
        new_rate: money(newRate),
        difference: money(newRate - line.rate),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
