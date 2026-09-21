import type { PoolClient } from 'pg';
import { insufficientStock, notFound } from '../utils/errors.js';
import { qty } from '../utils/number.js';

export type StockTxnType =
  | 'OPENING' | 'SALE' | 'PURCHASE' | 'SALES_RETURN' | 'PURCHASE_RETURN'
  | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'CANCELLATION';

export interface StockMovement {
  variantId: string;
  warehouseId: string;
  txnType: StockTxnType;
  /** Signed, in the item's stock unit. Negative removes stock. */
  quantity: number;
  enteredQty?: number;
  enteredUnit?: string;
  rate?: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  userId?: string | null;
  /** Item label used in the "insufficient stock" message. */
  itemLabel?: string;
  /** Stock unit label used in the same message. */
  stockUnit?: string;
  /** Set for corrections that are allowed to drive a balance negative. */
  allowNegative?: boolean;
}

/**
 * The ONLY way stock changes. Locks the balance row, applies the delta, and
 * writes the matching ledger entry — both inside the caller's transaction, so
 * a balance can never move without its ledger row and vice versa.
 */
export async function applyStockMovement(client: PoolClient, movement: StockMovement): Promise<number> {
  const {
    variantId, warehouseId, txnType, quantity, enteredQty, enteredUnit, rate,
    referenceType, referenceId, notes, userId, itemLabel, stockUnit, allowNegative,
  } = movement;

  // SELECT ... FOR UPDATE serialises concurrent bills for the same product.
  const current = await client.query<{ quantity: number }>(
    `SELECT quantity FROM stock WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE`,
    [variantId, warehouseId],
  );

  const before = current.rows[0]?.quantity ?? 0;
  const after = qty(before + quantity);

  if (after < 0 && !allowNegative) {
    throw insufficientStock(itemLabel ?? 'this item', qty(before), qty(Math.abs(quantity)), stockUnit ?? '');
  }

  if (current.rowCount) {
    await client.query(
      `UPDATE stock SET quantity = $3, updated_at = now()
        WHERE variant_id = $1 AND warehouse_id = $2`,
      [variantId, warehouseId, after],
    );
  } else {
    await client.query(
      `INSERT INTO stock (variant_id, warehouse_id, quantity) VALUES ($1,$2,$3)`,
      [variantId, warehouseId, after],
    );
  }

  await client.query(
    `INSERT INTO stock_transactions
       (variant_id, warehouse_id, txn_type, quantity, entered_qty, entered_unit,
        balance_after, rate, reference_type, reference_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      variantId, warehouseId, txnType, quantity, enteredQty ?? null, enteredUnit ?? null,
      after, rate ?? null, referenceType ?? null, referenceId ?? null, notes ?? null, userId ?? null,
    ],
  );

  return after;
}

export async function getDefaultWarehouseId(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE is_active ORDER BY is_default DESC, created_at LIMIT 1`,
  );
  if (!rows[0]) throw notFound('Warehouse');
  return rows[0].id;
}
