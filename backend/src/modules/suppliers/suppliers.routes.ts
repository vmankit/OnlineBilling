import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { conflict, notFound } from '../../utils/errors.js';

const supplierInput = z.object({
  name: z.string().min(2, 'Supplier name is required.').max(160),
  mobile: z.string().max(20).nullish().or(z.literal('')),
  email: z.string().email('Enter a valid email address.').nullish().or(z.literal('')),
  address: z.string().max(500).nullish(),
  gstin: z
    .string()
    .regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters.')
    .nullish()
    .or(z.literal('')),
  is_active: z.boolean().default(true),
});

const listQuery = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParam = z.object({ id: z.string().uuid('Invalid supplier id.') });
const blank = (v: string | null | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { q, page, pageSize } = listQuery.parse(request.query);
    const where = ['is_active = true'];
    const values: unknown[] = [];

    if (q?.trim()) {
      values.push(`%${q.trim().toLowerCase()}%`);
      where.push(`(lower(name) LIKE $${values.length} OR coalesce(mobile,'') LIKE $${values.length}
                   OR lower(coalesce(gstin,'')) LIKE $${values.length})`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const totalRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM suppliers ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    values.push((page - 1) * pageSize, pageSize);
    const { rows } = await query(
      `SELECT id, name, mobile, email, address, gstin, outstanding_balance, is_active, created_at
         FROM suppliers ${whereSql}
        ORDER BY name ASC
        OFFSET $${values.length - 1} LIMIT $${values.length}`,
      values,
    );

    return { data: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  });

  app.get('/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const { rows } = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Supplier');

    const purchases = await query(
      `SELECT id, purchase_number, supplier_invoice_number, invoice_date,
              grand_total, paid_amount, due_amount, status
         FROM purchase_invoices WHERE supplier_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    const stats = await query<{ purchase_count: number; total_purchases: number }>(
      `SELECT count(*)::int AS purchase_count,
              coalesce(sum(grand_total),0)::numeric(14,2) AS total_purchases
         FROM purchase_invoices WHERE supplier_id = $1 AND status <> 'CANCELLED'`,
      [id],
    );

    return { data: { ...rows[0], purchases: purchases.rows, stats: stats.rows[0] } };
  });

  app.post('/', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const body = supplierInput.parse(request.body);
    const mobile = blank(body.mobile);

    if (mobile) {
      const dup = await query('SELECT 1 FROM suppliers WHERE mobile = $1 AND is_active', [mobile]);
      if (dup.rowCount) throw conflict(`A supplier with mobile ${mobile} already exists.`);
    }

    const { rows } = await query(
      `INSERT INTO suppliers (name, mobile, email, address, gstin, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        body.name.trim(), mobile, blank(body.email), blank(body.address),
        blank(body.gstin)?.toUpperCase() ?? null, body.is_active,
      ],
    );

    await recordAudit({
      userId: request.user!.id, userName: request.user!.name, action: 'SUPPLIER_CREATE',
      entityType: 'SUPPLIER', entityId: (rows[0] as { id: string }).id, newValue: body, ip: request.ip,
    });

    return reply.code(201).send({ data: rows[0] });
  });

  app.put('/:id', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = supplierInput.parse(request.body);

    const existing = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (!existing.rows[0]) throw notFound('Supplier');

    const { rows } = await query(
      `UPDATE suppliers SET name=$2, mobile=$3, email=$4, address=$5, gstin=$6,
              is_active=$7, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [
        id, body.name.trim(), blank(body.mobile), blank(body.email), blank(body.address),
        blank(body.gstin)?.toUpperCase() ?? null, body.is_active,
      ],
    );

    await recordAudit({
      userId: request.user!.id, userName: request.user!.name, action: 'SUPPLIER_UPDATE',
      entityType: 'SUPPLIER', entityId: id, oldValue: existing.rows[0], newValue: rows[0], ip: request.ip,
    });

    return { data: rows[0] };
  });
}
