import type { Db } from '../db/pool.js';
import { query } from '../db/pool.js';
import { badRequest } from '../utils/errors.js';
import { qty } from '../utils/number.js';

export interface UnitRow {
  code: string;
  name: string;
  dimension: string;
  factor_to_base: number;
  is_base: boolean;
  decimals: number;
}

export interface ConversionOverride {
  item_id: string | null;
  from_unit: string;
  to_unit: string;
  factor: number;
}

/**
 * Convert `amount` from one unit to another.
 *
 * Two mechanisms, in priority order:
 *  1. An explicit override row (item-scoped beats global) — used for
 *     "1 BOX of this item = 12 PCS" style relationships that have no
 *     universal physical factor.
 *  2. Dimensional conversion through the dimension's base unit:
 *       amount_in_base = amount * from.factor_to_base
 *       result         = amount_in_base / to.factor_to_base
 *
 *   Selling 1 FEET of an item stocked in METER:
 *       1 * 0.3048 / 1 = 0.3048 METER deducted.  Never a flat "1".
 */
export function convertUnits(
  amount: number,
  from: UnitRow,
  to: UnitRow,
  overrides: ConversionOverride[] = [],
): number {
  if (from.code === to.code) return qty(amount);

  const direct = pickOverride(overrides, from.code, to.code);
  if (direct) return qty(amount * direct.factor);

  const inverse = pickOverride(overrides, to.code, from.code);
  if (inverse) return qty(amount / inverse.factor);

  if (from.dimension !== to.dimension) {
    throw badRequest(
      `Cannot convert ${from.code} to ${to.code}: they measure different things ` +
        `(${from.dimension} vs ${to.dimension}). Define a unit conversion for this item.`,
    );
  }

  return qty((amount * from.factor_to_base) / to.factor_to_base);
}

/** Item-scoped overrides win over global (item_id IS NULL) ones. */
function pickOverride(
  overrides: ConversionOverride[],
  from: string,
  to: string,
): ConversionOverride | undefined {
  const matches = overrides.filter((o) => o.from_unit === from && o.to_unit === to);
  return matches.find((o) => o.item_id !== null) ?? matches[0];
}

export async function loadUnits(client?: Db): Promise<Map<string, UnitRow>> {
  const { rows } = await query<UnitRow>('SELECT * FROM units', [], client);
  return new Map(rows.map((r) => [r.code, r]));
}

export async function loadOverridesForItems(
  itemIds: string[],
  client?: Db,
): Promise<ConversionOverride[]> {
  const { rows } = await query<ConversionOverride>(
    `SELECT item_id, from_unit, to_unit, factor
       FROM unit_conversions
      WHERE item_id IS NULL OR item_id = ANY($1::uuid[])`,
    [itemIds],
    client,
  );
  return rows;
}

/**
 * Quantity a sale/purchase line consumes from stock, expressed in the item's
 * stock unit. A variant carries a pack: selling 2 x "20 L" of an item stocked
 * in LITRE consumes 40 LITRE.
 */
export function resolveStockQuantity(args: {
  quantity: number;
  soldUnit: UnitRow;
  packSize: number;
  packUnit: UnitRow;
  stockUnit: UnitRow;
  overrides?: ConversionOverride[];
}): number {
  const { quantity, soldUnit, packSize, packUnit, stockUnit, overrides = [] } = args;

  // Sold by the pack itself (e.g. unit = PCS/BOX matching the variant pack):
  // one pack consumes `packSize` of pack_unit, converted into the stock unit.
  if (soldUnit.code === packUnit.code && packUnit.code !== stockUnit.code) {
    return qty(convertUnits(quantity * packSize, packUnit, stockUnit, overrides));
  }
  if (soldUnit.dimension === 'COUNT' && stockUnit.dimension !== 'COUNT') {
    return qty(convertUnits(quantity * packSize, packUnit, stockUnit, overrides));
  }
  return qty(convertUnits(quantity, soldUnit, stockUnit, overrides));
}
