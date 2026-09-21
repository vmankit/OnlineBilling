import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { conflict, notFound } from '../../utils/errors.js';
import { runHealthCheck } from './health.service.js';

const nameInput = z.object({ name: z.string().min(1).max(120) });

/** Brands / categories / item groups all behave identically. */
function simpleMaster(app: FastifyInstance, path: string, table: string): void {
  app.get(path, async () => {
    const { rows } = await query(`SELECT id, name FROM ${table} ORDER BY name ASC`);
    return { data: rows };
  });

  app.post(path, { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const { name } = nameInput.parse(request.body);
    const dup = await query(`SELECT 1 FROM ${table} WHERE lower(name) = lower($1)`, [name]);
    if (dup.rowCount) throw conflict(`"${name}" already exists.`);
    const { rows } = await query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name`, [
      name.trim(),
    ]);
    return reply.code(201).send({ data: rows[0] });
  });
}

export async function masterRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  simpleMaster(app, '/brands', 'brands');
  simpleMaster(app, '/categories', 'categories');
  simpleMaster(app, '/item-groups', 'item_groups');

  app.get('/units', async () => {
    const { rows } = await query(
      `SELECT code, name, dimension, factor_to_base, is_base, decimals
         FROM units ORDER BY dimension, factor_to_base`,
    );
    return { data: rows };
  });

  app.get('/warehouses', async () => {
    const { rows } = await query(
      `SELECT id, name, code, address, is_default, is_active
         FROM warehouses WHERE is_active ORDER BY is_default DESC, name`,
    );
    return { data: rows };
  });

  // Utilities → Verify My Data. Read-only: it reports, it never repairs.
  app.get('/health-check', async () => ({ data: await runHealthCheck() }));

  app.get('/settings', async () => {
    const { rows } = await query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
    return { data: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });

  app.put('/settings/:key', { preHandler: [requireRole('ADMIN')] }, async (request) => {
    const { key } = z.object({ key: z.string().min(1).max(60) }).parse(request.params);
    const { value } = z.object({ value: z.unknown() }).parse(request.body);
    const { rows } = await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING key, value`,
      [key, JSON.stringify(value)],
    );
    return { data: rows[0] };
  });

  // ------------------------------------------------------ numbering series
  //
  // The brief asked for configurable invoice numbering. The series lives in
  // `invoice_sequences`; `numbering.service.ts` expands {YYYY} / {YY} / {MM}
  // in the prefix and suffix when a document is actually created.

  app.get('/sequences', { preHandler: [requireRole('ADMIN', 'MANAGER')] }, async () => {
    const { rows } = await query(
      `SELECT doc_type, prefix, next_number, padding, suffix, updated_at
         FROM invoice_sequences ORDER BY doc_type`,
    );
    return { data: rows };
  });

  app.put('/sequences/:docType', { preHandler: [requireRole('ADMIN')] }, async (request) => {
    const { docType } = z
      .object({
        docType: z.enum(['SALES_INVOICE', 'PURCHASE_INVOICE', 'SALES_RETURN', 'PAYMENT', 'QUOTATION', 'EXPENSE']),
      })
      .parse(request.params);

    const body = z
      .object({
        // "SINV" is explicitly not wanted, and a prefix with characters that
        // need escaping in a URL or a filename makes sharing a bill painful.
        prefix: z
          .string()
          .max(20)
          .regex(/^[A-Za-z0-9{}\/_-]*$/, 'Prefix may use letters, digits, - _ / and {YYYY} tokens.')
          .refine((v) => !/^sinv/i.test(v), 'SINV is not used as an invoice prefix.'),
        suffix: z
          .string()
          .max(20)
          .regex(/^[A-Za-z0-9{}\/_-]*$/, 'Suffix may use letters, digits, - _ / and {YYYY} tokens.')
          .default(''),
        padding: z.coerce.number().int().min(1).max(12),
        next_number: z.coerce.number().int().min(1),
      })
      .parse(request.body);

    const current = await query<{ next_number: number }>(
      'SELECT next_number FROM invoice_sequences WHERE doc_type = $1',
      [docType],
    );
    if (!current.rows[0]) throw notFound('Numbering series');

    // Winding the counter back would re-issue numbers that are already on
    // customers' bills, and the unique index would then reject those sales at
    // the till. Refuse it here, where the message can explain why.
    if (body.next_number < Number(current.rows[0].next_number)) {
      throw conflict(
        `The next number cannot go below ${current.rows[0].next_number} — those numbers are already issued.`,
      );
    }

    const { rows } = await query(
      `UPDATE invoice_sequences
          SET prefix = $2, suffix = $3, padding = $4, next_number = $5, updated_at = now()
        WHERE doc_type = $1
        RETURNING doc_type, prefix, next_number, padding, suffix`,
      [docType, body.prefix, body.suffix, body.padding, body.next_number],
    );

    await recordAudit({
      userId: request.user!.id,
      userName: request.user!.name,
      action: 'SETTINGS_UPDATE',
      entityType: 'INVOICE_SEQUENCE',
      oldValue: current.rows[0],
      newValue: rows[0],
      ip: request.ip,
    });

    return { data: rows[0] };
  });
}
