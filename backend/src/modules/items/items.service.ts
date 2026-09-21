import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { conflict, notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import type { AuthUser, Paginated } from '../../types/index.js';
import type { ItemInput, ItemSearchQuery, VariantInput } from './items.schema.js';

export interface VariantView {
  id: string;
  item_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  pack_size: number;
  pack_unit: string;
  purchase_price: number;
  selling_price: number;
  mrp: number;
  min_stock: number;
  is_default: boolean;
  is_active: boolean;
  stock: number;
}

export interface ItemView {
  id: string;
  name: string;
  item_code: string;
  description: string | null;
  hsn_code: string | null;
  tax_rate: number;
  stock_unit: string;
  is_active: boolean;
  brand_id: string | null;
  brand_name: string | null;
  category_id: string | null;
  category_name: string | null;
  item_group_id: string | null;
  item_group_name: string | null;
  created_at: string;
  variants: VariantView[];
}

const ITEM_SELECT = `
  SELECT i.id, i.name, i.item_code, i.description, i.hsn_code, i.tax_rate,
         i.stock_unit, i.is_active, i.created_at,
         i.brand_id, b.name AS brand_name,
         i.category_id, c.name AS category_name,
         i.item_group_id, g.name AS item_group_name
    FROM items i
    LEFT JOIN brands b       ON b.id = i.brand_id
    LEFT JOIN categories c   ON c.id = i.category_id
    LEFT JOIN item_groups g  ON g.id = i.item_group_id`;

/**
 * Token-AND fuzzy search: every whitespace-separated token must appear
 * somewhere in the item's searchable text (name, code, HSN, brand, category,
 * variant name/sku/barcode), in any order.
 *
 *   "asian apex"  ->  "Asian Paints Apex Ultima 20L"   ✔
 *
 * An exact barcode or item-code hit short-circuits to the top of the list so
 * a scanner gun always lands on one row.
 */
export async function searchItems(params: ItemSearchQuery): Promise<Paginated<ItemView>> {
  const { q, brandId, categoryId, groupId, activeOnly, lowStockOnly, pricedOnly, page, pageSize } = params;

  const where: string[] = [];
  const values: unknown[] = [];
  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (activeOnly) where.push('i.is_active = true');
  if (brandId) where.push(`i.brand_id = ${add(brandId)}::uuid`);
  if (categoryId) where.push(`i.category_id = ${add(categoryId)}::uuid`);
  if (groupId) where.push(`i.item_group_id = ${add(groupId)}::uuid`);

  const tokens = (q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const p = add(`%${token}%`);
    where.push(`EXISTS (
      SELECT 1 FROM item_variants v2 WHERE v2.item_id = i.id AND (
        lower(v2.name) LIKE ${p} OR lower(v2.sku) LIKE ${p} OR lower(coalesce(v2.barcode,'')) LIKE ${p}
      )
    ) OR lower(i.name) LIKE ${p}
       OR lower(i.item_code) LIKE ${p}
       OR lower(coalesce(i.hsn_code,'')) LIKE ${p}
       OR lower(coalesce(b.name,'')) LIKE ${p}
       OR lower(coalesce(c.name,'')) LIKE ${p}`);
  }

  if (pricedOnly) {
    where.push('EXISTS (SELECT 1 FROM item_variants vp WHERE vp.item_id = i.id AND vp.is_active AND vp.selling_price > 0)');
  }

  if (lowStockOnly) {
    where.push(`EXISTS (
      SELECT 1 FROM item_variants v3
        LEFT JOIN stock s3 ON s3.variant_id = v3.id
       WHERE v3.item_id = i.id AND v3.is_active
       GROUP BY v3.id, v3.min_stock
      HAVING coalesce(sum(s3.quantity),0) <= v3.min_stock
    )`);
  }

  const whereSql = where.length ? `WHERE (${where.join(') AND (')})` : '';
  const exactParam = add((q ?? '').trim().toLowerCase());
  const offset = add((page - 1) * pageSize);
  const limit = add(pageSize);

  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM items i
       LEFT JOIN brands b ON b.id = i.brand_id
       LEFT JOIN categories c ON c.id = i.category_id
       ${whereSql}`,
    values.slice(0, values.length - 3),
  );
  const total = countResult.rows[0]?.count ?? 0;

  const { rows } = await query<ItemView>(
    `${ITEM_SELECT}
     ${whereSql}
     ORDER BY
       (lower(i.item_code) = ${exactParam}
        OR EXISTS (SELECT 1 FROM item_variants v4
                    WHERE v4.item_id = i.id
                      AND (lower(coalesce(v4.barcode,'')) = ${exactParam}
                           OR lower(v4.sku) = ${exactParam}))) DESC,
       i.name ASC
     OFFSET ${offset} LIMIT ${limit}`,
    values,
  );

  await attachVariants(rows);

  return {
    data: rows,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function attachVariants(items: ItemView[]): Promise<void> {
  if (!items.length) return;
  const ids = items.map((i) => i.id);
  const { rows } = await query<VariantView>(
    `SELECT v.id, v.item_id, v.name, v.sku, v.barcode, v.pack_size, v.pack_unit,
            v.purchase_price, v.selling_price, v.mrp, v.min_stock,
            v.is_default, v.is_active,
            coalesce(sum(s.quantity), 0)::numeric(18,4) AS stock
       FROM item_variants v
       LEFT JOIN stock s ON s.variant_id = v.id
      WHERE v.item_id = ANY($1::uuid[])
      GROUP BY v.id
      ORDER BY v.is_default DESC, v.pack_size ASC`,
    [ids],
  );
  const byItem = new Map<string, VariantView[]>();
  for (const v of rows) {
    const list = byItem.get(v.item_id) ?? [];
    list.push(v);
    byItem.set(v.item_id, list);
  }
  for (const item of items) item.variants = byItem.get(item.id) ?? [];
}

export async function getItem(id: string): Promise<ItemView> {
  const { rows } = await query<ItemView>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
  const item = rows[0];
  if (!item) throw notFound('Item');
  await attachVariants([item]);
  return item;
}

/** Barcode scan: resolves straight to a single sellable variant. */
export async function findByBarcode(code: string): Promise<{ item: ItemView; variant: VariantView }> {
  const { rows } = await query<{ item_id: string; variant_id: string }>(
    `SELECT item_id, id AS variant_id FROM item_variants
      WHERE barcode = $1 OR lower(sku) = lower($1)
      LIMIT 1`,
    [code],
  );
  const hit = rows[0];
  if (!hit) throw notFound(`No item with barcode "${code}"`);
  const item = await getItem(hit.item_id);
  const variant = item.variants.find((v) => v.id === hit.variant_id)!;
  return { item, variant };
}

export async function createItem(input: ItemInput, user: AuthUser): Promise<ItemView> {
  const dup = await query('SELECT 1 FROM items WHERE lower(item_code) = lower($1)', [input.item_code]);
  if (dup.rowCount) throw conflict(`Item code "${input.item_code}" is already in use.`);

  const id = await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO items (name, item_code, description, item_group_id, brand_id,
                          category_id, hsn_code, tax_rate, stock_unit, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        input.name, input.item_code, input.description ?? null, input.item_group_id ?? null,
        input.brand_id ?? null, input.category_id ?? null, input.hsn_code ?? null,
        input.tax_rate, input.stock_unit, input.is_active,
      ],
    );
    const itemId = rows[0]!.id;
    await upsertVariants(client, itemId, input.variants);

    await recordAudit(
      {
        userId: user.id, userName: user.name, action: 'ITEM_CREATE',
        entityType: 'ITEM', entityId: itemId, newValue: input,
      },
      client,
    );
    return itemId;
  });

  return getItem(id);
}

export async function updateItem(id: string, input: ItemInput, user: AuthUser): Promise<ItemView> {
  const before = await getItem(id);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE items SET name=$2, item_code=$3, description=$4, item_group_id=$5,
              brand_id=$6, category_id=$7, hsn_code=$8, tax_rate=$9,
              stock_unit=$10, is_active=$11, updated_at=now()
        WHERE id=$1`,
      [
        id, input.name, input.item_code, input.description ?? null, input.item_group_id ?? null,
        input.brand_id ?? null, input.category_id ?? null, input.hsn_code ?? null,
        input.tax_rate, input.stock_unit, input.is_active,
      ],
    );
    await upsertVariants(client, id, input.variants);

    // Price changes are audited separately so a report can answer
    // "who raised the price of Apex 20L and when".
    for (const v of input.variants) {
      const prev = before.variants.find((p) => p.id === v.id);
      if (prev && (prev.selling_price !== v.selling_price || prev.purchase_price !== v.purchase_price)) {
        await recordAudit(
          {
            userId: user.id, userName: user.name, action: 'PRICE_CHANGE',
            entityType: 'ITEM_VARIANT', entityId: prev.id,
            oldValue: { selling_price: prev.selling_price, purchase_price: prev.purchase_price },
            newValue: { selling_price: v.selling_price, purchase_price: v.purchase_price },
          },
          client,
        );
      }
    }

    await recordAudit(
      {
        userId: user.id, userName: user.name, action: 'ITEM_UPDATE',
        entityType: 'ITEM', entityId: id, oldValue: before, newValue: input,
      },
      client,
    );
  });

  return getItem(id);
}

async function upsertVariants(client: PoolClient, itemId: string, variants: VariantInput[]): Promise<void> {
  const keepIds: string[] = [];

  for (const v of variants) {
    if (v.id) {
      await client.query(
        `UPDATE item_variants SET name=$2, sku=$3, barcode=$4, pack_size=$5, pack_unit=$6,
                purchase_price=$7, selling_price=$8, mrp=$9, min_stock=$10,
                is_default=$11, is_active=$12, updated_at=now()
          WHERE id=$1 AND item_id=$13`,
        [v.id, v.name, v.sku, v.barcode || null, v.pack_size, v.pack_unit, v.purchase_price,
         v.selling_price, v.mrp, v.min_stock, v.is_default, v.is_active, itemId],
      );
      keepIds.push(v.id);
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO item_variants (item_id, name, sku, barcode, pack_size, pack_unit,
                                    purchase_price, selling_price, mrp, min_stock, is_default, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [itemId, v.name, v.sku, v.barcode || null, v.pack_size, v.pack_unit, v.purchase_price,
         v.selling_price, v.mrp, v.min_stock, v.is_default, v.is_active],
      );
      keepIds.push(rows[0]!.id);
    }
  }

  // Variants dropped from the form are deactivated, never deleted: historical
  // invoice lines still point at them.
  await client.query(
    `UPDATE item_variants SET is_active = false, updated_at = now()
      WHERE item_id = $1 AND NOT (id = ANY($2::uuid[]))`,
    [itemId, keepIds],
  );
}

export interface StockSummary {
  items: number;
  total_qty: number;
  stock_value: number;
  sale_value: number;
  low_count: number;
  critical_count: number;
}

/**
 * Shop-wide stock totals.
 *
 * These have to come from the database, not from the rows a screen happens to
 * be showing: the list is paged, so adding up what is on screen reports the
 * value of fifty items as the value of the shop.
 *
 * purchase_price and selling_price are the price of one PACK while stock is
 * counted in the item's stock unit, so each is divided by pack_size — a 20 L
 * tin at 9,200 is 460 a litre, and multiplying the two directly overstated
 * the shop's stock roughly fourteen-fold.
 *
 * The counts are per ITEM, not per variant, because that is what the Items
 * list shows and what Home's Low Stock card links to. Counting variants made
 * Home say 360 and the list it opened say 357.
 */
export async function getStockSummary(): Promise<StockSummary> {
  const { rows } = await query<StockSummary>(
    `WITH v AS (
       SELECT v.id, v.item_id, v.min_stock,
              nullif(v.pack_size, 0) AS pack_size,
              v.purchase_price, v.selling_price,
              coalesce(sum(s.quantity), 0) AS qty
         FROM item_variants v
         JOIN items i ON i.id = v.item_id AND i.is_active
         LEFT JOIN stock s ON s.variant_id = v.id
        WHERE v.is_active
        GROUP BY v.id
     ),
     per_item AS (
       SELECT item_id,
              sum(qty)                                   AS qty,
              bool_or(qty <= min_stock)                  AS is_low,
              bool_or(qty <= 1)                          AS is_critical
         FROM v
        GROUP BY item_id
     )
     SELECT (SELECT count(*)::int FROM per_item)                          AS items,
            coalesce((SELECT sum(qty) FROM per_item), 0)::float           AS total_qty,
            coalesce(sum(qty * purchase_price / pack_size), 0)::float     AS stock_value,
            coalesce(sum(qty * selling_price / pack_size), 0)::float      AS sale_value,
            (SELECT count(*)::int FROM per_item WHERE is_low)             AS low_count,
            (SELECT count(*)::int FROM per_item WHERE is_critical)        AS critical_count
       FROM v`,
  );
  return rows[0]!;
}

/** Counter shortcut: change one variant's selling price without re-sending the whole item. */
export async function updateVariantPrice(
  variantId: string, sellingPrice: number | undefined, user: AuthUser, unit?: string,
): Promise<VariantView> {
  return withTransaction(async (client) => {
    const cur = await client.query<{ selling_price: number; purchase_price: number }>(
      'SELECT selling_price::float8 AS selling_price, purchase_price::float8 AS purchase_price FROM item_variants WHERE id=$1 FOR UPDATE',
      [variantId],
    );
    if (!cur.rows[0]) throw notFound('Item variant not found.');
    if (unit) {
      const u = await client.query('SELECT 1 FROM units WHERE code=$1', [unit]);
      if (!u.rowCount) throw notFound('Unit');
      // The item is counted in this unit from now on; the stock number itself is kept as it is.
      await client.query('UPDATE item_variants SET pack_unit=$2, pack_size=1, updated_at=now() WHERE id=$1', [variantId, unit]);
      await client.query(
        'UPDATE items SET stock_unit=$2, updated_at=now() WHERE id=(SELECT item_id FROM item_variants WHERE id=$1)',
        [variantId, unit],
      );
    }
    if (sellingPrice === undefined) return { id: variantId } as unknown as VariantView;
    await client.query('UPDATE item_variants SET selling_price=$2 WHERE id=$1', [variantId, sellingPrice]);
    await recordAudit(
      {
        userId: user.id, userName: user.name, action: 'PRICE_CHANGE',
        entityType: 'ITEM_VARIANT', entityId: variantId,
        oldValue: { selling_price: cur.rows[0].selling_price, purchase_price: cur.rows[0].purchase_price },
        newValue: { selling_price: sellingPrice, purchase_price: cur.rows[0].purchase_price },
      },
      client,
    );
    return { id: variantId, selling_price: sellingPrice } as unknown as VariantView;
  });
}
