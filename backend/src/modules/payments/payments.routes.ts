import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { derivePaymentStatus } from '../../services/pricing.service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { money } from '../../utils/number.js';
import { PAYMENT_METHODS } from '../sales/sales.schema.js';

const receivePaymentSchema = z
  .object({
    customer_id: z.string().uuid(),
    /** Optional: settle a specific invoice. Otherwise oldest dues first. */
    invoice_id: z.string().uuid().nullish(),
    payment_date: z.string().datetime().optional(),
    notes: z.string().max(500).nullish(),
    methods: z
      .array(
        z.object({
          method: z.enum(PAYMENT_METHODS),
          amount: z.coerce.number().min(0),
          reference: z.string().max(80).nullish(),
        }),
      )
      .min(1, 'Add at least one payment method.'),
  })
  .refine((v) => v.methods.reduce((s, m) => s + m.amount, 0) > 0, {
    message: 'Enter an amount greater than zero.',
    path: ['methods'],
  });

/**
 * Paying a mahajan. Purchase bills could be recorded as unpaid or part-paid,
 * but nothing could ever settle them afterwards — the supplier balance only
 * went up.
 */
const supplierPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  /** Optional: settle one purchase bill. Otherwise oldest dues first. */
  purchase_id: z.string().uuid().nullish(),
  amount: z.coerce.number().positive('Enter an amount greater than zero.'),
  method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']).default('CASH'),
  reference: z.string().max(80).nullish(),
  payment_date: z.string().datetime().optional(),
  notes: z.string().max(500).nullish(),
});

const listSchema = z.object({
  customerId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('payment:view')] }, async (request) => {
    const params = listSchema.parse(request.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.customerId) where.push(`p.customer_id = ${add(params.customerId)}::uuid`);
    if (params.from) where.push(`p.payment_date >= ${add(params.from)}::timestamptz`);
    if (params.to) where.push(`p.payment_date <= ${add(params.to)}::timestamptz`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM payments p ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT p.id, p.payment_number, p.amount, p.payment_date, p.direction, p.notes,
              c.name AS customer_name, c.id AS customer_id,
              coalesce(json_agg(json_build_object('method', m.method, 'amount', m.amount))
                       FILTER (WHERE m.id IS NOT NULL), '[]') AS methods
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN payment_methods_used m ON m.payment_id = p.id
         ${whereSql}
        GROUP BY p.id, c.name, c.id
        ORDER BY p.created_at DESC
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

  /**
   * Receive money against a customer's dues. Allocation is FIFO across unpaid
   * invoices unless one is named, and the customer's outstanding balance moves
   * in the same transaction as the receipt.
   */
  app.post('/supplier', { preHandler: [requirePermission('purchase:create')] }, async (request, reply) => {
    const body = supplierPaymentSchema.parse(request.body);
    const amount = money(body.amount);

    const paymentId = await withTransaction(async (client) => {
      const { rows: sup } = await client.query<{ id: string; name: string; outstanding_balance: number }>(
        'SELECT id, name, outstanding_balance FROM suppliers WHERE id = $1 FOR UPDATE',
        [body.supplier_id],
      );
      const supplier = sup[0];
      if (!supplier) throw notFound('Supplier');

      // Paying more than is owed would leave the mahajan holding the shop's
      // money with nothing on the books to say so.
      if (amount > Number(supplier.outstanding_balance) + 0.01) {
        throw badRequest(
          `${supplier.name} ko sirf ${supplier.outstanding_balance} dena hai. Utna ya kam likhiye.`,
        );
      }

      const paymentNumber = await nextDocumentNumber(client, 'PAYMENT');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO payments
           (payment_number, party_type, supplier_id, direction, amount, payment_date, notes, created_by)
         VALUES ($1,'SUPPLIER',$2,'OUT',$3,coalesce($4::timestamptz, now()),$5,$6)
         RETURNING id`,
        [paymentNumber, body.supplier_id, amount, body.payment_date ?? null, body.notes ?? null, request.user!.id],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO payment_methods_used (payment_id, method, amount, reference)
         VALUES ($1,$2,$3,$4)`,
        [id, body.method, amount, body.reference ?? null],
      );

      const bills = await client.query<{ id: string; due_amount: number; paid_amount: number }>(
        `SELECT id, due_amount, paid_amount
           FROM purchase_invoices
          WHERE supplier_id = $1 AND status = 'COMPLETED' AND due_amount > 0
            AND ($2::uuid IS NULL OR id = $2::uuid)
          ORDER BY invoice_date ASC
          FOR UPDATE`,
        [body.supplier_id, body.purchase_id ?? null],
      );

      let remaining = amount;
      for (const bill of bills.rows) {
        if (remaining <= 0.004) break;
        const applied = money(Math.min(remaining, Number(bill.due_amount)));
        await client.query(
          `UPDATE purchase_invoices
              SET paid_amount = paid_amount + $2, due_amount = due_amount - $2
            WHERE id = $1`,
          [bill.id, applied],
        );
        await client.query(
          `INSERT INTO payment_allocations (payment_id, document_type, document_id, amount)
           VALUES ($1,'PURCHASE_INVOICE',$2,$3)`,
          [id, bill.id, applied],
        );
        remaining = money(remaining - applied);
      }

      await client.query(
        `UPDATE suppliers SET outstanding_balance = outstanding_balance - $2, updated_at = now()
          WHERE id = $1`,
        [body.supplier_id, amount],
      );

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'SUPPLIER_PAYMENT',
          entityType: 'PAYMENT', entityId: id,
          newValue: { supplier: supplier.name, amount, method: body.method },
          ip: request.ip,
        },
        client,
      );
      return id;
    });

    const { rows } = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    return reply.code(201).send({ data: rows[0] });
  });

  app.post('/', { preHandler: [requirePermission('payment:create')] }, async (request, reply) => {
    const body = receivePaymentSchema.parse(request.body);
    const amount = money(body.methods.reduce((sum, m) => sum + m.amount, 0));

    const paymentId = await withTransaction(async (client) => {
      const customerRes = await client.query<{ id: string; name: string; outstanding_balance: number }>(
        'SELECT id, name, outstanding_balance FROM customers WHERE id = $1 FOR UPDATE',
        [body.customer_id],
      );
      const customer = customerRes.rows[0];
      if (!customer) throw notFound('Customer');

      if (amount > Number(customer.outstanding_balance) + 0.01) {
        throw badRequest(
          `This customer owes ${customer.outstanding_balance}. Enter ${customer.outstanding_balance} or less.`,
        );
      }

      const paymentNumber = await nextDocumentNumber(client, 'PAYMENT');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO payments
           (payment_number, party_type, customer_id, direction, amount, payment_date, notes, created_by)
         VALUES ($1,'CUSTOMER',$2,'IN',$3,coalesce($4::timestamptz, now()),$5,$6)
         RETURNING id`,
        [paymentNumber, body.customer_id, amount, body.payment_date ?? null, body.notes ?? null, request.user!.id],
      );
      const id = rows[0]!.id;

      for (const m of body.methods) {
        if (m.amount <= 0) continue;
        await client.query(
          `INSERT INTO payment_methods_used (payment_id, method, amount, reference)
           VALUES ($1,$2,$3,$4)`,
          [id, m.method, m.amount, m.reference ?? null],
        );
      }

      // Allocate: named invoice first, then oldest dues.
      const invoices = await client.query<{ id: string; due_amount: number; grand_total: number; paid_amount: number }>(
        `SELECT id, due_amount, grand_total, paid_amount
           FROM sales_invoices
          WHERE customer_id = $1 AND status = 'COMPLETED' AND due_amount > 0
            AND ($2::uuid IS NULL OR id = $2::uuid)
          ORDER BY invoice_date ASC
          FOR UPDATE`,
        [body.customer_id, body.invoice_id ?? null],
      );

      let remaining = amount;
      for (const invoice of invoices.rows) {
        if (remaining <= 0.004) break;
        const applied = money(Math.min(remaining, Number(invoice.due_amount)));
        const newPaid = money(Number(invoice.paid_amount) + applied);
        const newDue = money(Number(invoice.due_amount) - applied);

        await client.query(
          `UPDATE sales_invoices
              SET paid_amount = $2, due_amount = $3, payment_status = $4, updated_at = now()
            WHERE id = $1`,
          [invoice.id, newPaid, newDue, derivePaymentStatus(Number(invoice.grand_total), newPaid)],
        );
        await client.query(
          `INSERT INTO payment_allocations (payment_id, document_type, document_id, amount)
           VALUES ($1,'SALES_INVOICE',$2,$3)`,
          [id, invoice.id, applied],
        );
        remaining = money(remaining - applied);
      }

      // Anything left over sits as an on-account credit against the customer.
      await client.query(
        `UPDATE customers SET outstanding_balance = outstanding_balance - $2, updated_at = now()
          WHERE id = $1`,
        [body.customer_id, amount],
      );

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'PAYMENT_CREATE',
          entityType: 'PAYMENT', entityId: id,
          newValue: { paymentNumber, amount, customer: customer.name, methods: body.methods },
          ip: request.ip,
        },
        client,
      );

      return id;
    });

    const { rows } = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    return reply.code(201).send({ data: rows[0] });
  });
}
