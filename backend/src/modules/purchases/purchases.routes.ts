import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { applyStockMovement, getDefaultWarehouseId } from '../../services/stock.service.js';
import {
  loadOverridesForItems, loadUnits, resolveStockQuantity,
} from '../../services/units.service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { money } from '../../utils/number.js';

const purchaseLine = z.object({
  variant_id: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  purchase_unit: z.string().min(1),
  rate: z.coerce.number().min(0),
  discount_amt: z.coerce.number().min(0).default(0),
  /** Optional: also refresh the item master's cost/selling price. */
  update_purchase_price: z.boolean().default(false),
  new_selling_price: z.coerce.number().min(0).nullish(),
});

const createPurchase = z.object({
  supplier_id: z.string().uuid(),
  supplier_invoice_number: z.string().max(60).nullish(),
  warehouse_id: z.string().uuid().nullish(),
  invoice_date: z.string().datetime().optional(),
  paid_amount: z.coerce.number().min(0).default(0),
  notes: z.string().max(1000).nullish(),
  items: z.array(purchaseLine).min(1, 'Add at least one item to the purchase.'),
});

const dateOrDateTime = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), {
    message: 'Use a date (yyyy-mm-dd) or an ISO timestamp.',
  });

const listQuery = z.object({
  q: z.string().max(120).optional(),
  supplierId: z.string().uuid().optional(),
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function purchaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('purchase:view')] }, async (request) => {
    const params = listQuery.parse(request.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.q?.trim()) {
      const p = add(`%${params.q.trim().toLowerCase()}%`);
      where.push(`(lower(p.purchase_number) LIKE ${p}
                   OR lower(coalesce(p.supplier_invoice_number,'')) LIKE ${p}
                   OR lower(s.name) LIKE ${p})`);
    }
    if (params.supplierId) where.push(`p.supplier_id = ${add(params.supplierId)}::uuid`);
    // The screen filtered by date in the browser, over only the 25 rows it
    // had loaded, so a month's totals came from whichever page was open.
    if (params.from) where.push(`p.invoice_date >= ${add(params.from)}::timestamptz`);
    if (params.to) {
      where.push(
        /^\d{4}-\d{2}-\d{2}$/.test(params.to)
          ? `p.invoice_date < ${add(params.to)}::timestamptz + interval '1 day'`
          : `p.invoice_date <= ${add(params.to)}::timestamptz`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await query<{ count: number; total: number; paid: number; unpaid: number }>(
      `SELECT count(*)::int AS count,
              coalesce(sum(p.grand_total) FILTER (WHERE p.status <> 'CANCELLED'), 0)::float AS total,
              coalesce(sum(p.paid_amount) FILTER (WHERE p.status <> 'CANCELLED'), 0)::float AS paid,
              coalesce(sum(p.due_amount)  FILTER (WHERE p.status <> 'CANCELLED'), 0)::float AS unpaid
         FROM purchase_invoices p
         JOIN suppliers s ON s.id = p.supplier_id ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    // "Total Payable" is what the shop owes right now, whatever the date
    // filter — it is the supplier balance, not the period's unpaid bills.
    const payable = await query<{ amount: number; parties: number }>(
      `SELECT coalesce(sum(outstanding_balance), 0)::float AS amount,
              count(*) FILTER (WHERE outstanding_balance > 0)::int AS parties
         FROM suppliers WHERE outstanding_balance > 0`,
    );

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT p.id, p.purchase_number, p.supplier_invoice_number, p.invoice_date,
              p.grand_total, p.paid_amount, p.due_amount, p.status, s.name AS supplier_name
         FROM purchase_invoices p
         JOIN suppliers s ON s.id = p.supplier_id
         ${whereSql}
        ORDER BY p.invoice_date DESC, p.created_at DESC
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
        total: totalRes.rows[0]!.total,
        paid: totalRes.rows[0]!.paid,
        unpaid: totalRes.rows[0]!.unpaid,
        payable: payable.rows[0]!.amount,
        payableParties: payable.rows[0]!.parties,
      },
    };
  });

  app.get('/:id', { preHandler: [requirePermission('purchase:view')] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { rows } = await query(
      `SELECT p.*, s.name AS supplier_name, s.gstin AS supplier_gstin, s.mobile AS supplier_mobile
         FROM purchase_invoices p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound('Purchase');

    const items = await query(
      'SELECT * FROM purchase_invoice_items WHERE purchase_id = $1 ORDER BY line_no',
      [id],
    );
    return { data: { ...rows[0], items: items.rows } };
  });

  /**
   * Records a purchase and raises stock in one transaction. Optionally
   * refreshes the item master's cost and selling price — which is audited as a
   * price change and never touches invoices already issued.
   */
  app.post('/', { preHandler: [requirePermission('purchase:create')] }, async (request, reply) => {
    const body = createPurchase.parse(request.body);

    const purchaseId = await withTransaction(async (client) => {
      const warehouseId = body.warehouse_id ?? (await getDefaultWarehouseId(client));

      const supplierRes = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM suppliers WHERE id = $1 FOR UPDATE',
        [body.supplier_id],
      );
      if (!supplierRes.rows[0]) throw notFound('Supplier');

      const variantRes = await client.query<{
        id: string; item_id: string; item_name: string; variant_name: string;
        pack_size: number; pack_unit: string; stock_unit: string; tax_rate: number;
        purchase_price: number; selling_price: number;
      }>(
        `SELECT v.id, i.id AS item_id, i.name AS item_name, v.name AS variant_name,
                v.pack_size, v.pack_unit, i.stock_unit, i.tax_rate,
                v.purchase_price, v.selling_price
           FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE v.id = ANY($1::uuid[])`,
        [body.items.map((l) => l.variant_id)],
      );
      const variants = new Map(variantRes.rows.map((r) => [r.id, r]));
      if (variants.size !== new Set(body.items.map((l) => l.variant_id)).size) {
        throw notFound('One of the purchased items');
      }

      const units = await loadUnits(client);
      const overrides = await loadOverridesForItems(
        [...new Set(variantRes.rows.map((r) => r.item_id))],
        client,
      );

      const lines = body.items.map((line) => {
        const v = variants.get(line.variant_id)!;
        const purchaseUnit = units.get(line.purchase_unit);
        const packUnit = units.get(v.pack_unit);
        const stockUnit = units.get(v.stock_unit);
        if (!purchaseUnit || !packUnit || !stockUnit) throw badRequest('Unknown unit on a purchase line.');

        const stockQty = resolveStockQuantity({
          quantity: line.quantity,
          soldUnit: purchaseUnit,
          packSize: Number(v.pack_size),
          packUnit,
          stockUnit,
          overrides,
        });
        const lineTotal = money(line.quantity * line.rate - line.discount_amt);
        return { line, v, stockQty, lineTotal };
      });

      const subtotal = money(lines.reduce((sum, l) => sum + l.line.quantity * l.line.rate, 0));
      const discount = money(lines.reduce((sum, l) => sum + l.line.discount_amt, 0));
      const grandTotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
      const paid = money(Math.min(body.paid_amount, grandTotal));
      const due = money(grandTotal - paid);

      const purchaseNumber = await nextDocumentNumber(client, 'PURCHASE_INVOICE');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO purchase_invoices
           (purchase_number, supplier_invoice_number, supplier_id, warehouse_id, invoice_date,
            subtotal, discount, tax_amount, grand_total, paid_amount, due_amount, notes, created_by)
         VALUES ($1,$2,$3,$4,coalesce($5::timestamptz, now()),$6,$7,0,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          purchaseNumber, body.supplier_invoice_number ?? null, body.supplier_id, warehouseId,
          body.invoice_date ?? null, subtotal, discount, grandTotal, paid, due,
          body.notes ?? null, request.user!.id,
        ],
      );
      const id = rows[0]!.id;

      for (const [index, { line, v, stockQty, lineTotal }] of lines.entries()) {
        await client.query(
          `INSERT INTO purchase_invoice_items
             (purchase_id, variant_id, line_no, item_name, quantity, purchase_unit,
              stock_qty, rate, discount_amt, tax_rate, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id, line.variant_id, index + 1, `${v.item_name} · ${v.variant_name}`,
            line.quantity, line.purchase_unit, stockQty, line.rate,
            line.discount_amt, v.tax_rate, lineTotal,
          ],
        );

        await applyStockMovement(client, {
          variantId: line.variant_id,
          warehouseId,
          txnType: 'PURCHASE',
          quantity: stockQty,
          enteredQty: line.quantity,
          enteredUnit: line.purchase_unit,
          rate: line.rate,
          referenceType: 'PURCHASE_INVOICE',
          referenceId: id,
          notes: purchaseNumber,
          userId: request.user!.id,
        });

        const newPurchasePrice = line.update_purchase_price ? money(line.rate) : null;
        const newSellingPrice =
          line.new_selling_price != null ? money(line.new_selling_price) : null;

        if (newPurchasePrice !== null || newSellingPrice !== null) {
          await client.query(
            `UPDATE item_variants
                SET purchase_price = coalesce($2, purchase_price),
                    selling_price  = coalesce($3, selling_price),
                    updated_at = now()
              WHERE id = $1`,
            [line.variant_id, newPurchasePrice, newSellingPrice],
          );
          await recordAudit(
            {
              userId: request.user!.id, userName: request.user!.name, action: 'PRICE_CHANGE',
              entityType: 'ITEM_VARIANT', entityId: line.variant_id,
              oldValue: { purchase_price: v.purchase_price, selling_price: v.selling_price },
              newValue: {
                purchase_price: newPurchasePrice ?? v.purchase_price,
                selling_price: newSellingPrice ?? v.selling_price,
                source: purchaseNumber,
              },
              ip: request.ip,
            },
            client,
          );
        }
      }

      if (due > 0) {
        await client.query(
          `UPDATE suppliers SET outstanding_balance = outstanding_balance + $2, updated_at = now()
            WHERE id = $1`,
          [body.supplier_id, due],
        );
      }

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'PURCHASE_CREATE',
          entityType: 'PURCHASE_INVOICE', entityId: id,
          newValue: { purchaseNumber, grandTotal, paid, due, lines: body.items.length },
          ip: request.ip,
        },
        client,
      );

      return id;
    });

    const { rows } = await query('SELECT * FROM purchase_invoices WHERE id = $1', [purchaseId]);
    return reply.code(201).send({ data: rows[0] });
  });
}
