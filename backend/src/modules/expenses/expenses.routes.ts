import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { nextDocumentNumber } from '../../services/numbering.service.js';
import { conflict, notFound } from '../../utils/errors.js';
import { money } from '../../utils/number.js';

/** The categories a small hardware shop actually spends on. */
export const EXPENSE_CATEGORIES = [
  'Tea / Nashta', 'Transport', 'Loading / Unloading', 'Labour', 'Salary',
  'Electricity', 'Rent', 'Internet / Phone', 'Repair', 'Other',
] as const;

const dateOrDateTime = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), {
    message: 'Use a date (yyyy-mm-dd) or an ISO timestamp.',
  });

const createExpense = z.object({
  expense_date: dateOrDateTime.optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive('Enter an amount greater than zero.'),
  method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']).default('CASH'),
  paid_to: z.string().max(120).nullish(),
  notes: z.string().max(500).nullish(),
});

const listQuery = z.object({
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParam = z.object({ id: z.string().uuid('Invalid expense id.') });

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/categories', async () => ({ data: EXPENSE_CATEGORIES }));

  app.get('/', { preHandler: [requirePermission('expense:view')] }, async (request) => {
    const params = listQuery.parse(request.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.from) where.push(`expense_date >= ${add(params.from)}::timestamptz`);
    if (params.to) {
      where.push(
        /^\d{4}-\d{2}-\d{2}$/.test(params.to)
          ? `expense_date < ${add(params.to)}::timestamptz + interval '1 day'`
          : `expense_date <= ${add(params.to)}::timestamptz`,
      );
    }
    if (params.category) where.push(`category = ${add(params.category)}`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Totals cover the whole filter, not the page; cancelled entries stay
    // listed but are not money spent.
    const totals = await query<{ count: number; total: number }>(
      `SELECT count(*)::int AS count,
              coalesce(sum(amount) FILTER (WHERE status = 'ACTIVE'), 0)::float AS total
         FROM expenses ${whereSql}`,
      values,
    );
    const byCategory = await query<{ category: string; total: number }>(
      `SELECT category, sum(amount)::float AS total
         FROM expenses ${whereSql ? `${whereSql} AND` : 'WHERE'} status = 'ACTIVE'
        GROUP BY category ORDER BY total DESC`,
      values,
    );

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT id, expense_number, expense_date, category, amount, method, paid_to,
              notes, status, cancel_reason, created_at
         FROM expenses ${whereSql}
        ORDER BY expense_date DESC, created_at DESC
        OFFSET ${offset} LIMIT ${limit}`,
      values,
    );

    const total = totals.rows[0]!.count;
    return {
      data: rows,
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      summary: { total: totals.rows[0]!.total, byCategory: byCategory.rows },
    };
  });

  app.post('/', { preHandler: [requirePermission('expense:create')] }, async (request, reply) => {
    const body = createExpense.parse(request.body);
    const id = await withTransaction(async (client) => {
      const number = await nextDocumentNumber(client, 'EXPENSE');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO expenses
           (expense_number, expense_date, category, amount, method, paid_to, notes, created_by)
         VALUES ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          number, body.expense_date ?? null, body.category, money(body.amount), body.method,
          body.paid_to?.trim() || null, body.notes?.trim() || null, request.user!.id,
        ],
      );
      const newId = rows[0]!.id;
      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'EXPENSE_CREATE',
          entityType: 'EXPENSE', entityId: newId, newValue: body, ip: request.ip,
        },
        client,
      );
      return newId;
    });
    const { rows } = await query('SELECT * FROM expenses WHERE id = $1', [id]);
    return reply.code(201).send({ data: rows[0] });
  });

  // A mistaken entry is cancelled, never deleted, so the day's cash still
  // reconciles against what was written down at the time.
  app.post('/:id/cancel', { preHandler: [requirePermission('expense:create')] }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { reason } = z
      .object({ reason: z.string().min(3, 'Give a reason for cancelling.').max(300) })
      .parse(request.body);

    await withTransaction(async (client) => {
      const { rows } = await client.query<{ status: string }>(
        'SELECT status FROM expenses WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) throw notFound('Expense');
      if (rows[0].status === 'CANCELLED') throw conflict('This expense is already cancelled.');
      await client.query(
        `UPDATE expenses SET status = 'CANCELLED', cancel_reason = $2 WHERE id = $1`,
        [id, reason],
      );
      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'EXPENSE_CANCEL',
          entityType: 'EXPENSE', entityId: id, newValue: { reason }, ip: request.ip,
        },
        client,
      );
    });
    const { rows } = await query('SELECT * FROM expenses WHERE id = $1', [id]);
    return { data: rows[0] };
  });
}
