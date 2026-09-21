import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../../services/audit.service.js';
import { applyStockMovement, getDefaultWarehouseId } from '../../services/stock.service.js';
import { convertUnits, loadOverridesForItems, loadUnits } from '../../services/units.service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { qty } from '../../utils/number.js';

const listQuery = z.object({
  q: z.string().max(120).optional(),
  lowStockOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const ledgerQuery = z.object({
  variantId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const adjustmentSchema = z.object({
  variant_id: z.string().uuid(),
  warehouse_id: z.string().uuid().nullish(),
  /** Signed quantity in `unit`. Negative writes stock off. */
  quantity: z.coerce.number().refine((v) => v !== 0, 'Enter a quantity other than zero.'),
  unit: z.string().min(1),
  reason: z.string().min(3, 'Give a reason for this adjustment.').max(300),
});

export async function stockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /** Current position, one row per sellable variant. */
  app.get('/', { preHandler: [requirePermission('stock:view')] }, async (request) => {
    const params = listQuery.parse(request.query);
    const where = ['v.is_active', 'i.is_active'];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.q?.trim()) {
      const p = add(`%${params.q.trim().toLowerCase()}%`);
      where.push(`(lower(i.name) LIKE ${p} OR lower(i.item_code) LIKE ${p}
                   OR lower(v.sku) LIKE ${p} OR lower(coalesce(v.barcode,'')) LIKE ${p})`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const having = params.lowStockOnly ? 'HAVING coalesce(sum(s.quantity),0) <= v.min_stock' : '';

    const countRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (
         SELECT v.id
           FROM item_variants v
           JOIN items i ON i.id = v.item_id
           LEFT JOIN stock s ON s.variant_id = v.id
           ${whereSql}
          GROUP BY v.id, v.min_stock
          ${having}
       ) t`,
      values,
    );
    const total = countRes.rows[0]?.count ?? 0;

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT v.id AS variant_id, i.id AS item_id, i.name AS item_name, i.item_code,
              v.name AS variant_name, v.sku, v.barcode, i.stock_unit,
              v.min_stock, v.purchase_price, v.selling_price,
              coalesce(sum(s.quantity),0)::numeric(18,4) AS stock,
              (coalesce(sum(s.quantity),0) * v.purchase_price
                 / nullif(v.pack_size,0))::numeric(14,2) AS stock_value
         FROM item_variants v
         JOIN items i ON i.id = v.item_id
         LEFT JOIN stock s ON s.variant_id = v.id
         ${whereSql}
        GROUP BY v.id, i.id
        ${having}
        ORDER BY i.name, v.pack_size
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

  /** The ledger: every movement, newest first, with the balance it produced. */
  app.get('/ledger', { preHandler: [requirePermission('stock:view')] }, async (request) => {
    const params = ledgerQuery.parse(request.query);
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (v: unknown): string => {
      values.push(v);
      return `$${values.length}`;
    };

    if (params.variantId) where.push(`t.variant_id = ${add(params.variantId)}::uuid`);
    if (params.itemId) where.push(`v.item_id = ${add(params.itemId)}::uuid`);
    if (params.from) where.push(`t.created_at >= ${add(params.from)}::timestamptz`);
    if (params.to) where.push(`t.created_at <= ${add(params.to)}::timestamptz`);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM stock_transactions t
         JOIN item_variants v ON v.id = t.variant_id ${whereSql}`,
      values,
    );
    const total = totalRes.rows[0]?.count ?? 0;

    const offset = add((params.page - 1) * params.pageSize);
    const limit = add(params.pageSize);
    const { rows } = await query(
      `SELECT t.id, t.txn_type, t.quantity, t.entered_qty, t.entered_unit, t.balance_after,
              t.rate, t.reference_type, t.reference_id, t.notes, t.created_at,
              i.name AS item_name, v.name AS variant_name, i.stock_unit,
              u.name AS user_name
         FROM stock_transactions t
         JOIN item_variants v ON v.id = t.variant_id
         JOIN items i ON i.id = v.item_id
         LEFT JOIN users u ON u.id = t.created_by
         ${whereSql}
        ORDER BY t.created_at DESC, t.id DESC
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
   * Manual correction — damage, shrinkage, a recount. Goes through the same
   * ledger as everything else and may drive a balance negative only because a
   * recount is allowed to disagree with the books.
   */
  app.post('/adjustments', { preHandler: [requirePermission('stock:adjust')] }, async (request, reply) => {
    const body = adjustmentSchema.parse(request.body);

    const result = await withTransaction(async (client) => {
      const warehouseId = body.warehouse_id ?? (await getDefaultWarehouseId(client));

      const variantRes = await client.query<{
        id: string; item_id: string; item_name: string; variant_name: string; stock_unit: string;
      }>(
        `SELECT v.id, i.id AS item_id, i.name AS item_name, v.name AS variant_name, i.stock_unit
           FROM item_variants v JOIN items i ON i.id = v.item_id WHERE v.id = $1`,
        [body.variant_id],
      );
      const variant = variantRes.rows[0];
      if (!variant) throw notFound('Item');

      const units = await loadUnits(client);
      const fromUnit = units.get(body.unit);
      const stockUnit = units.get(variant.stock_unit);
      if (!fromUnit || !stockUnit) throw badRequest('Unknown unit on this adjustment.');

      const overrides = await loadOverridesForItems([variant.item_id], client);
      const signedStockQty = qty(convertUnits(body.quantity, fromUnit, stockUnit, overrides));

      const balance = await applyStockMovement(client, {
        variantId: body.variant_id,
        warehouseId,
        txnType: 'ADJUSTMENT',
        quantity: signedStockQty,
        enteredQty: body.quantity,
        enteredUnit: body.unit,
        notes: body.reason,
        userId: request.user!.id,
        itemLabel: `${variant.item_name} (${variant.variant_name})`,
        stockUnit: stockUnit.code,
        allowNegative: true,
      });

      await recordAudit(
        {
          userId: request.user!.id, userName: request.user!.name, action: 'STOCK_ADJUST',
          entityType: 'ITEM_VARIANT', entityId: body.variant_id,
          newValue: { quantity: signedStockQty, unit: stockUnit.code, reason: body.reason, balance },
          ip: request.ip,
        },
        client,
      );

      return { balance, stockUnit: stockUnit.code, applied: signedStockQty };
    });

    return reply.code(201).send({ data: result });
  });
}
