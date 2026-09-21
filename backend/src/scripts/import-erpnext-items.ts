/**
 * One-off import of the item list exported from the old ERPNext setup.
 *
 *   npx tsx src/scripts/import-erpnext-items.ts [file.json]
 *
 * Safe to re-run: an item_code that already exists is skipped, so nothing is
 * duplicated and no stock is added twice. Stock enters only through the ledger
 * as an OPENING entry. The old HSN column is ignored (no tax on bills).
 */
import { readFileSync } from 'node:fs';
import { closePool, withTransaction } from '../db/pool.js';
import { applyStockMovement, getDefaultWarehouseId } from '../services/stock.service.js';

interface OldItem {
  'Item Name': string; 'Item Code': string; 'Item Group': string | null; Brand: string | null;
  'Sale Price': number | null; 'Purchase Price': number | null; UOM: string | null;
  Stock: number | null; Barcode: string | null; Description: string | null;
}

const UNIT_MAP: Record<string, string> = {
  nos: 'PCS', pcs: 'PCS', kg: 'KG', foot: 'FEET', litre: 'LITRE', bag: 'BAG',
  pair: 'PAIR', gram: 'GRAM', packet: 'PACK',
};

async function main(): Promise<void> {
  const file = process.argv[2] ?? 'data/erpnext-items.json';
  const items = JSON.parse(readFileSync(file, 'utf-8')) as OldItem[];
  let created = 0, skipped = 0, withStock = 0;

  await withTransaction(async (c) => {
    await c.query(
      `INSERT INTO units (code,name,dimension,factor_to_base,is_base,decimals)
       VALUES ('PAIR','Pair','COUNT',1,false,0) ON CONFLICT (code) DO NOTHING`,
    );
    const wh = await getDefaultWarehouseId(c);
    const cache = new Map<string, string>();
    const lookup = async (table: 'brands' | 'item_groups', name: string): Promise<string> => {
      const key = `${table}:${name.toLowerCase()}`;
      if (cache.has(key)) return cache.get(key)!;
      const r = await c.query<{ id: string }>(
        `INSERT INTO ${table} (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
      cache.set(key, r.rows[0]!.id);
      return r.rows[0]!.id;
    };

    for (const it of items) {
      const code = String(it['Item Code']).trim();
      const exists = await c.query('SELECT 1 FROM items WHERE lower(item_code)=lower($1)', [code]);
      if (exists.rowCount) { skipped++; continue; }

      const unit = UNIT_MAP[String(it.UOM ?? 'Nos').toLowerCase()] ?? 'PCS';
      const groupId = it['Item Group'] ? await lookup('item_groups', it['Item Group'].trim()) : null;
      const brandId = it.Brand ? await lookup('brands', it.Brand.trim()) : null;

      const ins = await c.query<{ id: string }>(
        `INSERT INTO items (name,item_code,description,item_group_id,brand_id,stock_unit)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [it['Item Name'].trim(), code, it.Description?.trim() || null, groupId, brandId, unit]);
      const barcode = it.Barcode ? String(it.Barcode).trim() : null;
      const v = await c.query<{ id: string }>(
        `INSERT INTO item_variants (item_id,name,sku,barcode,pack_size,pack_unit,purchase_price,selling_price,is_default)
         VALUES ($1,'Standard',$2,$3,1,$4,$5,$6,true) RETURNING id`,
        [ins.rows[0]!.id, code, barcode, unit, it['Purchase Price'] ?? 0, it['Sale Price'] ?? 0]);
      created++;

      const opening = Number(it.Stock ?? 0);
      if (opening > 0) {
        await applyStockMovement(c, {
          variantId: v.rows[0]!.id, warehouseId: wh, txnType: 'OPENING', quantity: opening,
          enteredQty: opening, enteredUnit: unit, notes: 'Opening stock imported from old ERPNext',
        });
        withStock++;
      }
    }
  });
  console.log(`Created ${created}, skipped ${skipped} existing, opening stock for ${withStock}.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(closePool);
