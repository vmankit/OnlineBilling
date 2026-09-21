import type { Db } from '../db/pool.js';
import { query } from '../db/pool.js';

export type AuditAction =
  | 'LOGIN'
  | 'SALE_CREATE'
  | 'SALE_CANCEL'
  | 'SALE_EDIT'
  | 'PAYMENT_CREATE'
  | 'STOCK_ADJUST'
  | 'PURCHASE_CREATE'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE_CREATE'
  | 'EXPENSE_CANCEL'
  | 'SALES_RETURN_CREATE'
  | 'QUOTATION_CREATE'
  | 'QUOTATION_CANCEL'
  | 'QUOTATION_CONVERT'
  | 'PRICE_CHANGE'
  | 'ITEM_CREATE'
  | 'ITEM_UPDATE'
  | 'CUSTOMER_CREATE'
  | 'CUSTOMER_UPDATE'
  | 'SUPPLIER_CREATE'
  | 'SUPPLIER_UPDATE'
  | 'SETTINGS_UPDATE'
  | 'USER_CREATE'
  | 'USER_UPDATE';

export interface AuditEntry {
  userId?: string | null;
  userName?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string | null;
}

/**
 * Pass the transaction client when the log must live or die with the
 * document it describes.
 */
export async function recordAudit(entry: AuditEntry, client?: Db): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (user_id, user_name, action, entity_type, entity_id, old_value, new_value, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.userId ?? null,
      entry.userName ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.oldValue === undefined ? null : JSON.stringify(entry.oldValue),
      entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      entry.ip ?? null,
    ],
    client,
  );
}
