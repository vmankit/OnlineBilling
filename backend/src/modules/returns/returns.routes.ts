import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { statusFromDue } from '../../services/pricing.service.js';
import { applyStockMovement } from '../../services/stock.service.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { money, qty } from '../../utils/number.js';

const createReturn = z.object({
  invoice_id: z.string().uuid(),
  return_date: z.string().datetime().optional(),
  refund_mode: z.enum(['CASH', 'UPI', 'BANK', 'CREDIT_NOTE']).default('CREDIT_NOTE'),
  notes: z.string().max(500).nullish(),
  items: z
    .array(
      z.object({
        invoice_item_id: z.string().uuid(),
        quantity: z.coerce.number().positive('Return quantity must be greater than zero.'),
      }),
    )
    .min(1, 'Choose at least one item to return.'),
});

export async function returnRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('sale:view')] }, async (request) => {
    const { page, pageSize } = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      })
      .parse(request.query);

    const totalRes = await query<{ count: number }>('SELECT count(*)::int AS count FROM sales_returns');
    const total = totalRes.rows[0]?.count ?? 0;

    const { rows } = await query(
      `SELECT r.id, r.return_number, r.return_date, r.total_amount, r.refund_mode,
              i.invoice_number, coalesce(c.name, i.customer_name) AS customer_name
         FROM sales_returns r
         JOIN sales_invoices i ON i.id = r.invoice_id
         LEFT JOIN customers c ON c.id = r.customer_id
        ORDER BY r.created_at DESC
        OFFSET $1 LIMIT $2`,
      [(page - 1) * pageSize, pageSize],
    );

    return { data: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  /** The returnable lines of an invoice: sold quantity minus what came back. */
  app.get('/eligible/:invoiceId', { preHandler: [requirePermission('sale:view')] }, async (request) => {
    const { invoiceId } = z.object({ invoiceId: z.string().uuid() }).parse(request.params);

    const invoiceRes = await query<{ id: string; invoice_number: string; status: string; customer_name: string }>(
      'SELECT id, invoice_number, status, customer_name FROM sales_invoices WHERE id = $1',
      [invoiceId],
    );
    const invoice = invoiceRes.rows[0];
    if (!invoice) throw notFound('Invoice');

    const { rows } = await query(
      `SELECT id AS invoice_item_id, item_name, variant_name, quantity, sold_unit, rate,
              returned_qty, (quantity - returned_qty)::numeric(18,4) AS returnable
         FROM sales_invoice_items
        WHERE invoice_id = $1
        ORDER BY line_no`,
      [invoiceId],
    );

    return { data: { invoice, items: rows } };
  });

  /**
   * Books a return: validates against what was actually sold, puts the stock
   * back through the ledger, and settles the money either by reducing the
   * customer's dues or by refunding.
   */
  app.post('/', { preHandler: [requirePermission('sale:create')] }, async (request, reply) => {
    const body = createReturn.parse(request.body);

    const returnId = await withTransaction(async (client) => {
      const invoiceRes = await client.query<{
        id: string; invoice_number: string; status: string; warehouse_id: string;
        customer_id: string | null; grand_total: number; paid_amount: number; due_amount: number;
      }>('SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE', [body.invoice_id]);

      const invoice = invoiceRes.rows[0];
      if (!invoice) throw notFound('Invoice');
      if (invoice.status === 'CANCELLED') {
        throw conflict('This invoice is cancelled — its stock has already been returned.');
      }
      if (invoice.status !== 'COMPLETED') {
        throw unprocessable('Only a completed invoice can be returned against.');
      }

      const lineRes = await client.query<{
        id: string; variant_id: string | null; item_name: string; variant_name: string | null;
        quantity: number; sold_unit: string; stock_qty: number; rate: number;
        discount_amt: number; returned_qty: number;
      }>(
        `SELECT id, variant_id, item_name, variant_name, quantity, sold_unit, stock_qty,
                rate, discount_amt, returned_qty
           FROM sales_invoice_items WHERE invoice_id = $1 FOR UPDATE`,
        [body.invoice_id],
      );
      const lines = new Map(lineRes.rows.map((r) => [r.id, r]));

      const returnNumber = await nextDocumentNumber(client, 'SALES_RETURN');
      const headerRes = await client.query<{ id: string }>(
        `INSERT INTO sales_returns
           (return_number, invoice_id, customer_id, warehouse_id, return_date,
            total_amount, refund_mode, notes, created_by)
         VALUES ($1,$2,$3,$4,coalesce($5::timestamptz, now()),0,$6,$7,$8)
         RETURNING id`,
        [
          returnNumber, body.invoice_id, invoice.customer_id, invoice.warehouse_id,
          body.return_date ?? null, body.refund_mode, body.notes ?? null, request.user!.id,
        ],
      );
      const id = headerRes.rows[0]!.id;

      let totalAmount = 0;

      for (const item of body.items) {
        const line = lines.get(item.invoice_item_id);
        if (!line) throw notFound('One of the returned lines');

        const returnable = qty(Number(line.quantity) - Number(line.returned_qty));
        if (item.quantity > returnable + 0.0001) {
          throw unprocessable(
            `${line.item_name}: only ${returnable} ${line.sold_unit} can still be returned ` +
              `(sold ${line.quantity}, already returned ${line.returned_qty}).`,
          );
        }

        // Stock goes back in the same proportion it left, so a part return of
        // a converted line (feet sold from metre stock) stays exact.
        const stockQty = qty((Number(line.stock_qty) * item.quantity) / Number(line.quantity));
        // The refund uses the rate actually charged, net of that line's discount.
        const netRate = money(
          (Number(line.quantity) * Number(line.rate) - Number(line.discount_amt)) / Number(line.quantity),
        );
        const lineTotal = money(netRate * item.quantity);
        totalAmount = money(totalAmount + lineTotal);

        await client.query(
          `INSERT INTO sales_return_items
             (return_id, invoice_item_id, variant_id, item_name, quantity, return_unit,
              stock_qty, rate, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id, line.id, line.variant_id, line.item_name, item.quantity, line.sold_unit,
            stockQty, netRate, lineTotal,
          ],
        );

        await client.query(
          'UPDATE sales_invoice_items SET returned_qty = returned_qty + $2 WHERE id = $1',
          [line.id, item.quantity],
        );

        if (line.variant_id) {
          await applyStockMovement(client, {
            variantId: line.variant_id,
            warehouseId: invoice.warehouse_id,
            txnType: 'SALES_RETURN',
            quantity: stockQty,
            enteredQty: item.quantity,
            enteredUnit: line.sold_unit,
            rate: netRate,
            referenceType: 'SALES_RETURN',
            referenceId: id,
            notes: `${returnNumber} against ${invoice.invoice_number}`,
            userId: request.user!.id,
          });
        }
      }

      await client.query('UPDATE sales_returns SET total_amount = $2 WHERE id = $1', [id, totalAmount]);

      // Money: knock the return off any outstanding balance first; whatever
      // remains is a refund or a credit note.
      const dueBefore = Number(invoice.due_amount);
      const appliedToDue = money(Math.min(totalAmount, dueBefore));
      const refunded = money(totalAmount - appliedToDue);

      if (appliedToDue > 0) {
        const newDue = money(dueBefore - appliedToDue);
        await client.query(
          `UPDATE sales_invoices
              SET due_amount = $2, payment_status = $3, updated_at = now()
            WHERE id = $1`,
          [invoice.id, newDue, statusFromDue(newDue, Number(invoice.paid_amount))],
        );
        if (invoice.customer_id) {
          await client.query(
            `UPDATE customers SET outstanding_balance = outstanding_balance - $2, updated_at = now()
              WHERE id = $1`,
            [invoice.customer_id, appliedToDue],
          );
        }
      }

      if (refunded > 0 && body.refund_mode === 'CREDIT_NOTE' && invoice.customer_id) {
        // A credit note is a negative balance the customer can spend later.
        await client.query(
          `UPDATE customers SET outstanding_balance = outstanding_balance - $2, updated_at = now()
            WHERE id = $1`,
          [invoice.customer_id, refunded],
        );
      }

      if (refunded > 0 && body.refund_mode !== 'CREDIT_NOTE') {
        const paymentNumber = await nextDocumentNumber(client, 'PAYMENT');
        const payRes = await client.query<{ id: string }>(
          `INSERT INTO payments
             (payment_number, party_type, customer_id, direction, amount, notes, created_by)
           VALUES ($1,'CUSTOMER',$2,'OUT',$3,$4,$5) RETURNING id`,
          [paymentNumber, invoice.customer_id, refunded, `Refund for ${returnNumber}`, request.user!.id],
        );
        await client.query(
          `INSERT INTO payment_methods_used (payment_id, method, amount) VALUES ($1,$2,$3)`,
          [payRes.rows[0]!.id, body.refund_mode === 'BANK' ? 'BANK' : body.refund_mode, refunded],
        );
      }

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'SALES_RETURN_CREATE',
          entityType: 'SALES_RETURN', entityId: id,
          newValue: {
            returnNumber, invoice: invoice.invoice_number, totalAmount,
            appliedToDue, refunded, mode: body.refund_mode,
          },
          ip: request.ip,
        },
        client,
      );

      return id;
    });

    const { rows } = await query('SELECT * FROM sales_returns WHERE id = $1', [returnId]);
    return reply.code(201).send({ data: rows[0] });
  });
}
