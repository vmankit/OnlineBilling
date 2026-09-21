import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { conflict, notFound } from '../../utils/errors.js';

const customerInput = z.object({
  name: z.string().min(2, 'Customer name is required.').max(160),
  mobile: z
    .string()
    .regex(/^[0-9+\-\s]{6,20}$/, 'Enter a valid mobile number.')
    .nullish()
    .or(z.literal('')),
  email: z.string().email('Enter a valid email address.').nullish().or(z.literal('')),
  address: z.string().max(500).nullish(),
  gstin: z
    .string()
    .regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters.')
    .nullish()
    .or(z.literal('')),
  credit_limit: z.coerce.number().min(0).default(0),
  notes: z.string().max(1000).nullish(),
  is_active: z.boolean().default(true),
});

const listQuery = z.object({
  q: z.string().max(120).optional(),
  withDuesOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParam = z.object({ id: z.string().uuid('Invalid customer id.') });

const blank = (v: string | null | undefined) => (v && v.trim() !== '' ? v.trim() : null);

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', { preHandler: [requirePermission('customer:view')] }, async (request) => {
    const { q, withDuesOnly, page, pageSize } = listQuery.parse(request.query);
    const where: string[] = ['is_active = true'];
    const values: unknown[] = [];

    if (q?.trim()) {
      values.push(`%${q.trim().toLowerCase()}%`);
      where.push(`(lower(name) LIKE $${values.length} OR coalesce(mobile,'') LIKE $${values.length}
                   OR lower(coalesce(gstin,'')) LIKE $${values.length})`);
    }
    if (withDuesOnly) where.push('outstanding_balance > 0');

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const totalRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM customers ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    values.push((page - 1) * pageSize, pageSize);
    const { rows } = await query(
      `SELECT id, name, mobile, email, address, gstin, credit_limit,
              outstanding_balance, is_active, created_at
         FROM customers ${whereSql}
        ORDER BY name ASC
        OFFSET $${values.length - 1} LIMIT $${values.length}`,
      values,
    );

    return { data: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  app.get('/:id', { preHandler: [requirePermission('customer:view')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Customer');

    const stats = await query<{ invoice_count: number; total_purchases: number }>(
      `SELECT count(*)::int AS invoice_count,
              coalesce(sum(grand_total),0)::numeric(14,2) AS total_purchases
         FROM sales_invoices
        WHERE customer_id = $1 AND status <> 'CANCELLED'`,
      [id],
    );
    const invoices = await query(
      `SELECT id, invoice_number, invoice_date, grand_total, paid_amount, due_amount,
              payment_status, status
         FROM sales_invoices WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    const payments = await query(
      `SELECT p.id, p.payment_number, p.amount, p.payment_date, p.notes,
              coalesce(json_agg(json_build_object('method', m.method, 'amount', m.amount))
                       FILTER (WHERE m.id IS NOT NULL), '[]') AS methods
         FROM payments p
         LEFT JOIN payment_methods_used m ON m.payment_id = p.id
        WHERE p.customer_id = $1
        GROUP BY p.id
        ORDER BY p.created_at DESC LIMIT 50`,
      [id],
    );

    return {
      data: {
        ...rows[0],
        stats: stats.rows[0],
        invoices: invoices.rows,
        payments: payments.rows,
      },
    };
  });

  app.post('/', { preHandler: [requirePermission('customer:create')] }, async (request, reply) => {
    const body = customerInput.parse(request.body);
    const mobile = blank(body.mobile);

    if (mobile) {
      const dup = await query('SELECT 1 FROM customers WHERE mobile = $1 AND is_active', [mobile]);
      if (dup.rowCount) throw conflict(`A customer with mobile ${mobile} already exists.`);
    }

    const { rows } = await query(
      `INSERT INTO customers (name, mobile, email, address, gstin, credit_limit, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        body.name.trim(), mobile, blank(body.email), blank(body.address),
        blank(body.gstin)?.toUpperCase() ?? null, body.credit_limit, blank(body.notes), body.is_active,
      ],
    );

    await recordAudit({
      userId: request.user!.id, userName: request.user!.name, action: 'CUSTOMER_CREATE',
      entityType: 'CUSTOMER', entityId: (rows[0] as { id: string }).id, newValue: body, ip: request.ip,
    });

    return reply.code(201).send({ data: rows[0] });
  });

  app.put('/:id', { preHandler: [requirePermission('customer:update')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = customerInput.parse(request.body);

    const existing = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!existing.rows[0]) throw notFound('Customer');

    const { rows } = await query(
      `UPDATE customers SET name=$2, mobile=$3, email=$4, address=$5, gstin=$6,
              credit_limit=$7, notes=$8, is_active=$9, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [
        id, body.name.trim(), blank(body.mobile), blank(body.email), blank(body.address),
        blank(body.gstin)?.toUpperCase() ?? null, body.credit_limit, blank(body.notes), body.is_active,
      ],
    );

    await recordAudit({
      userId: request.user!.id, userName: request.user!.name, action: 'CUSTOMER_UPDATE',
      entityType: 'CUSTOMER', entityId: id, oldValue: existing.rows[0], newValue: rows[0], ip: request.ip,
    });

    return { data: rows[0] };
  });
}
