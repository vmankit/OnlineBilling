import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { applyStockMovement, getDefaultWarehouseId } from '../../services/stock.service.js';

export const importRowSchema = z.object({
  item_code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().optional().default(''),
  brand: z.string().trim().optional().default(''),
  stock_unit: z.string().trim().optional().default(''),
  purchase_price: z.coerce.number().min(0).default(0),
  selling_price: z.coerce.number().min(0).default(0),
  mrp: z.coerce.number().min(0).default(0),
  min_stock: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().default(0).transform((n) => Math.max(0, n)),
  barcode: z.string().trim().optional().default(''),
  hsn_code: z.string().trim().optional().default(''),
});
export const importBodySchema = z.object({ rows: z.array(importRowSchema).min(1).max(5000) });
export type ImportRow = z.infer<typeof importRowSchema>;

const UNIT_MAP: Record<string, string> = {
  nos: 'PCS', no: 'PCS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', kg: 'KG', foot: 'FEET', feet: 'FEET',
  ft: 'FEET', litre: 'LITRE', ltr: 'LITRE', l: 'LITRE', bag: 'BAG', pair: 'PAIR', gram: 'GRAM',
  gm: 'GRAM', packet: 'PACK', pack: 'PACK', box: 'BOX', set: 'SET', meter: 'METER', mtr: 'METER',
};

export interface ImportSummary { created: number; updated: number; opening_stock: number; failed: string[] }

/** Creates new items, refreshes prices of existing ones, and books opening stock once. */
export async function importItems(rows: ImportRow[], userId?: string): Promise<ImportSummary> {
  const out: ImportSummary = { created: 0, updated: 0, opening_stock: 0, failed: [] };
  await withTransaction(async (c) => {
    await c.query(
      `INSERT INTO units (code,name,dimension,factor_to_base,is_base,decimals)
       VALUES ('PAIR','Pair','COUNT',1,false,0) ON CONFLICT (code) DO NOTHING`,
    );
    const known = new Set((await c.query<{ code: string }>('SELECT code FROM units')).rows.map((r) => r.code));
    const wh = await getDefaultWarehouseId(c);
    const cache = new Map<string, string>();
    const lookup = async (table: 'brands' | 'item_groups', name: string): Promise<string | null> => {
      if (!name) return null;
      const key = `${table}:${name.toLowerCase()}`;
      if (cache.has(key)) return cache.get(key)!;
      const found = await c.query<{ id: string }>(`SELECT id FROM ${table} WHERE lower(name)=lower($1)`, [name]);
      const id = found.rows[0]?.id
        ?? (await c.query<{ id: string }>(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [name])).rows[0]!.id;
      cache.set(key, id);
      return id;
    };

    for (const r of rows) {
      const raw = r.stock_unit.toLowerCase();
      const unit = known.has(r.stock_unit.toUpperCase()) ? r.stock_unit.toUpperCase() : UNIT_MAP[raw] ?? 'PCS';
      const groupId = await lookup('item_groups', r.category);
      const brandId = await lookup('brands', r.brand);
      const existing = await c.query<{ id: string }>('SELECT id FROM items WHERE lower(item_code)=lower($1)', [r.item_code]);
      let variantId: string;
      if (existing.rows[0]) {
        const itemId = existing.rows[0].id;
        await c.query(
          `UPDATE items SET item_group_id=COALESCE($2,item_group_id), brand_id=COALESCE($3,brand_id) WHERE id=$1`,
          [itemId, groupId, brandId],
        );
        const v = await c.query<{ id: string }>(
          `UPDATE item_variants SET purchase_price=$2, selling_price=$3, mrp=$4
           WHERE item_id=$1 AND is_default RETURNING id`,
          [itemId, r.purchase_price, r.selling_price, r.mrp],
        );
        if (!v.rows[0]) { out.failed.push(r.item_code); continue; }
        variantId = v.rows[0].id;
        out.updated++;
      } else {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO items (name,item_code,item_group_id,brand_id,stock_unit,hsn_code)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [r.name, r.item_code, groupId, brandId, unit, r.hsn_code || null],
        );
        const v = await c.query<{ id: string }>(
          `INSERT INTO item_variants (item_id,name,sku,barcode,pack_size,pack_unit,purchase_price,selling_price,mrp,min_stock,is_default)
           VALUES ($1,'Standard',$2,$3,1,$4,$5,$6,$7,$8,true) RETURNING id`,
          [ins.rows[0]!.id, r.item_code, r.barcode || null, unit, r.purchase_price, r.selling_price, r.mrp, r.min_stock || 5],
        );
        variantId = v.rows[0]!.id;
        out.created++;
      }
      if (r.stock > 0) {
        const has = await c.query('SELECT 1 FROM stock_transactions WHERE variant_id=$1 LIMIT 1', [variantId]);
        if (!has.rowCount) {
          await applyStockMovement(c, {
            variantId, warehouseId: wh, txnType: 'OPENING', quantity: r.stock, enteredQty: r.stock,
            enteredUnit: unit, notes: 'Opening stock (import)', userId,
          });
          out.opening_stock++;
        }
      }
    }
  });
  return out;
}
