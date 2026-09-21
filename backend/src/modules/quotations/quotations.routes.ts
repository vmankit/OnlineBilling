import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { calculateBill } from '../../services/pricing.service.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';

const quotationLine = z.object({
  variant_id: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  sold_unit: z.string().min(1),
  rate: z.coerce.number().min(0),
  discount_pct: z.coerce.number().min(0).max(100).default(0),
  discount_amt: z.coerce.number().min(0).default(0),
});

const createQuotation = z
  .object({
    customer_id: z.string().uuid().nullish(),
    customer_name: z.string().max(160).nullish(),
    customer_mobile: z.string().max(30).nullish(),
    customer_address: z.string().max(500).nullish(),
    customer_gstin: z.string().max(20).nullish(),
    valid_until: z.string().optional(),
    bill_discount: z.coerce.number().min(0).default(0),
    round_off: z.coerce.number().default(0),
    notes: z.string().max(1000).nullish(),
    items: z.array(quotationLine).min(1, 'Add at least one item to the quotation.'),
  })
  .refine((v) => !!v.customer_id || !!v.customer_name?.trim(), {
    message: 'Choose a customer or enter a name for this quotation.',
    path: ['customer_id'],
  });

const listQuery = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(['OPEN', 'CONVERTED', 'EXPIRED', 'CANCELLED']).optional(),
  customerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParam = z.object({ id: z.string().uuid('Invalid quotation id.') });

export async function quotationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('sale:view')] }, async (request) => {
    const params = listQuery.parse(request.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.q?.trim()) {
      const p = add(`%${params.q.trim().toLowerCase()}%`);
      where.push(`(lower(quotation_number) LIKE ${p} OR lower(customer_name) LIKE ${p}
                   OR coalesce(customer_mobile,'') LIKE ${p})`);
    }
    if (params.status) where.push(`status = ${add(params.status)}`);
    if (params.customerId) where.push(`customer_id = ${add(params.customerId)}::uuid`);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM quotations ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT id, quotation_number, customer_id, customer_name, customer_mobile, customer_address,
              quotation_date, valid_until, grand_total, status,
              converted_invoice_id, created_at,
              (valid_until IS NOT NULL AND valid_until < current_date
                 AND status = 'OPEN') AS is_expired
         FROM quotations ${whereSql}
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
    };
  });

  app.get('/:id', { preHandler: [requirePermission('sale:view')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query(
      `SELECT q.*, si.invoice_number AS converted_invoice_number
         FROM quotations q
         LEFT JOIN sales_invoices si ON si.id = q.converted_invoice_id
        WHERE q.id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound('Quotation');

    const items = await query(
      'SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY line_no',
      [id],
    );
    const business = await query<{ value: unknown }>(
      `SELECT value FROM settings WHERE key = 'business'`,
    );

    return {
      data: { ...rows[0], items: items.rows, business: business.rows[0]?.value ?? null },
    };
  });

  /**
   * Creates a quotation. Deliberately moves no stock and creates no payment —
   * a quotation is a price held open, not a sale. Totals are computed with the
   * same engine the bill uses so the two documents can never disagree.
   */
  app.post('/', { preHandler: [requirePermission('sale:create')] }, async (request, reply) => {
    const body = createQuotation.parse(request.body);

    const id = await withTransaction(async (client) => {
      const variantRes = await client.query<{
        id: string; item_name: string; item_code: string; hsn_code: string | null;
        variant_name: string; tax_rate: number; mrp: number; is_active: boolean; item_active: boolean;
      }>(
        `SELECT v.id, i.name AS item_name, i.item_code, i.hsn_code, v.name AS variant_name,
                i.tax_rate, v.mrp, v.is_active, i.is_active AS item_active
           FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE v.id = ANY($1::uuid[])`,
        [body.items.map((l) => l.variant_id)],
      );
      const variants = new Map(variantRes.rows.map((r) => [r.id, r]));
      if (variants.size !== new Set(body.items.map((l) => l.variant_id)).size) {
        throw notFound('One of the quoted items');
      }

      let customerName = body.customer_name?.trim() ?? 'Walk-in Customer';
      let mobile: string | null = body.customer_mobile?.trim() ?? null;
      let address: string | null = body.customer_address?.trim() ?? null;
      let gstin: string | null = body.customer_gstin?.trim() ?? null;

      if (body.customer_id) {
        const { rows } = await client.query<{
          name: string; mobile: string | null; address: string | null; gstin: string | null;
        }>('SELECT name, mobile, address, gstin FROM customers WHERE id = $1', [body.customer_id]);
        const customer = rows[0];
        if (!customer) throw notFound('Customer');
        customerName = customer.name;
        mobile = customer.mobile ?? mobile;
        address = customer.address ?? address;
        gstin = customer.gstin ?? gstin;
      }

      const totals = calculateBill(
        body.items.map((line) => ({
          quantity: line.quantity,
          rate: line.rate,
          discountPct: line.discount_pct,
          discountAmt: line.discount_amt,
        })),
        { billDiscount: body.bill_discount, roundOff: body.round_off },
      );

      const quotationNumber = await nextDocumentNumber(client, 'QUOTATION');
      const headerRes = await client.query<{ id: string }>(
        `INSERT INTO quotations
           (quotation_number, customer_id, customer_name, customer_mobile, customer_address,
            customer_gstin, valid_until, subtotal, item_discount, bill_discount, tax_amount,
            round_off, grand_total, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          quotationNumber, body.customer_id ?? null, customerName, mobile, address, gstin,
          body.valid_until ?? null, totals.subtotal, totals.itemDiscount, totals.billDiscount,
          0, totals.roundOff, totals.grandTotal, body.notes ?? null, request.user!.id,
        ],
      );
      const quotationId = headerRes.rows[0]!.id;

      for (const [index, line] of body.items.entries()) {
        const v = variants.get(line.variant_id)!;
        const computed = totals.lines[index]!;
        await client.query(
          `INSERT INTO quotation_items
             (quotation_id, variant_id, line_no, item_name, item_code, hsn_code, variant_name,
              quantity, sold_unit, rate, mrp, discount_pct, discount_amt, tax_rate,
              tax_amount, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            quotationId, line.variant_id, index + 1, v.item_name, v.item_code, v.hsn_code,
            v.variant_name, line.quantity, line.sold_unit, line.rate, v.mrp,
            line.discount_pct, computed.discount, 0, 0, computed.lineTotal,
          ],
        );
      }

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'QUOTATION_CREATE',
          entityType: 'QUOTATION', entityId: quotationId,
          newValue: { quotationNumber, grandTotal: totals.grandTotal, lines: body.items.length },
          ip: request.ip,
        },
        client,
      );

      return quotationId;
    });

    const { rows } = await query('SELECT * FROM quotations WHERE id = $1', [id]);
    return reply.code(201).send({ data: rows[0] });
  });

  app.post('/:id/cancel', { preHandler: [requirePermission('sale:create')] }, async (request) => {
    const { id } = idParam.parse(request.params);

    const { rows } = await query<{ status: string }>(
      'SELECT status FROM quotations WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw notFound('Quotation');
    if (rows[0].status === 'CONVERTED') {
      throw conflict('This quotation has already been billed and cannot be cancelled.');
    }

    await query(
      `UPDATE quotations SET status = 'CANCELLED', updated_at = now() WHERE id = $1`,
      [id],
    );
    await recordAudit({
      userId: request.user!.id, userName: request.user!.name, action: 'QUOTATION_CANCEL',
      entityType: 'QUOTATION', entityId: id, ip: request.ip,
    });

    return { data: { id, status: 'CANCELLED' } };
  });

  /**
   * The lines of a quotation, each compared against the item master's price
   * today. The POS uses `differences` to decide whether to make the operator
   * choose between the quoted price and the current one.
   */
  app.get('/:id/for-billing', { preHandler: [requirePermission('sale:create')] }, async (request) => {
    const { id } = idParam.parse(request.params);

    const headerRes = await query<{
      id: string; quotation_number: string; status: string; valid_until: string | null;
      customer_id: string | null; customer_name: string; bill_discount: number; notes: string | null;
    }>('SELECT * FROM quotations WHERE id = $1', [id]);
    const quotation = headerRes.rows[0];
    if (!quotation) throw notFound('Quotation');
    if (quotation.status === 'CONVERTED') {
      throw conflict('This quotation has already been converted into a bill.');
    }
    if (quotation.status === 'CANCELLED') {
      throw unprocessable('This quotation was cancelled.');
    }

    const { rows } = await query(
      `SELECT qi.id, qi.variant_id, qi.item_name, qi.item_code, qi.variant_name,
              qi.quantity, qi.sold_unit, qi.rate AS quoted_rate, qi.discount_pct, qi.discount_amt,
              v.selling_price AS current_rate, v.pack_unit, v.pack_size, v.mrp,
              i.stock_unit, i.tax_rate, v.is_active AND i.is_active AS sellable,
              coalesce(sum(s.quantity), 0)::numeric(18,4) AS stock
         FROM quotation_items qi
         LEFT JOIN item_variants v ON v.id = qi.variant_id
         LEFT JOIN items i ON i.id = v.item_id
         LEFT JOIN stock s ON s.variant_id = v.id
        WHERE qi.quotation_id = $1
        GROUP BY qi.id, v.id, i.id
        ORDER BY qi.line_no`,
      [id],
    );

    const differences = rows
      .filter((r) => r.current_rate !== null && Math.abs(Number(r.current_rate) - Number(r.quoted_rate)) >= 0.005)
      .map((r) => ({
        variant_id: r.variant_id as string,
        item_name: `${r.item_name}${r.variant_name ? ` · ${r.variant_name}` : ''}`,
        old_rate: Number(r.quoted_rate),
        new_rate: Number(r.current_rate),
        difference: Math.round((Number(r.current_rate) - Number(r.quoted_rate)) * 100) / 100,
      }));

    return { data: { quotation, items: rows, differences } };
  });
}
