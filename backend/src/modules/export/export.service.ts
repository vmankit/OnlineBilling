import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { pool } from '../../db/pool.js';

/** One sheet per kind of record. Child rows carry the bill number so a sheet reads on its own. */
const SHEETS: Array<[name: string, sql: string]> = [
  ['Sales', `SELECT invoice_number, invoice_date, customer_name, customer_mobile, customer_address, subtotal,
      item_discount, bill_discount, round_off, grand_total, paid_amount, due_amount AS baki, payment_status, status, notes, created_at
      FROM sales_invoices ORDER BY created_at`],
  ['Sale Items', `SELECT s.invoice_number, x.line_no, x.item_name, x.item_code, x.variant_name, x.quantity, x.sold_unit,
      x.rate, x.discount_amt, x.line_total, x.returned_qty FROM sales_invoice_items x
      JOIN sales_invoices s ON s.id = x.invoice_id ORDER BY s.created_at, x.line_no`],
  ['Sale Returns', `SELECT r.return_number, s.invoice_number, r.return_date, r.total_amount, r.refund_mode, r.notes
      FROM sales_returns r LEFT JOIN sales_invoices s ON s.id = r.invoice_id ORDER BY r.created_at`],
  ['Return Items', `SELECT r.return_number, x.item_name, x.quantity, x.return_unit, x.rate, x.line_total
      FROM sales_return_items x JOIN sales_returns r ON r.id = x.return_id ORDER BY r.created_at`],
  ['Estimates', `SELECT * FROM quotations ORDER BY created_at`],
  ['Estimate Items', `SELECT q.quotation_number, x.line_no, x.item_name, x.item_code, x.quantity, x.sold_unit, x.rate,
      x.discount_amt, x.line_total FROM quotation_items x JOIN quotations q ON q.id = x.quotation_id
      ORDER BY q.created_at, x.line_no`],
  ['Purchases', `SELECT p.purchase_number, p.supplier_invoice_number, sp.name AS supplier, p.invoice_date, p.subtotal,
      p.discount, p.grand_total, p.paid_amount, p.due_amount AS baki, p.status, p.created_at
      FROM purchase_invoices p JOIN suppliers sp ON sp.id = p.supplier_id ORDER BY p.created_at`],
  ['Purchase Items', `SELECT p.purchase_number, x.line_no, x.item_name, x.quantity, x.purchase_unit, x.rate, x.line_total
      FROM purchase_invoice_items x JOIN purchase_invoices p ON p.id = x.purchase_id ORDER BY p.created_at, x.line_no`],
  ['Items', `SELECT i.item_code, i.name, g.name AS category, b.name AS brand, i.hsn_code, i.stock_unit,
      v.purchase_price, v.selling_price, v.mrp, v.min_stock, coalesce(st.qty, 0) AS stock, v.barcode, i.is_active
      FROM items i JOIN item_variants v ON v.item_id = i.id AND v.is_default
      LEFT JOIN item_groups g ON g.id = i.item_group_id LEFT JOIN brands b ON b.id = i.brand_id
      LEFT JOIN (SELECT variant_id, sum(quantity) AS qty FROM stock GROUP BY variant_id) st ON st.variant_id = v.id
      ORDER BY i.name`],
  ['Stock Ledger', `SELECT t.created_at, i.name AS item, t.txn_type, t.quantity, t.entered_qty, t.entered_unit,
      t.balance_after, t.rate, t.reference_type, t.notes FROM stock_transactions t
      JOIN item_variants v ON v.id = t.variant_id JOIN items i ON i.id = v.item_id ORDER BY t.created_at`],
  ['Customers', `SELECT name, mobile, address, gstin, credit_limit, outstanding_balance AS baki, is_active, created_at
      FROM customers ORDER BY name`],
  ['Suppliers', `SELECT name, mobile, address, gstin, outstanding_balance AS baki, is_active, created_at
      FROM suppliers ORDER BY name`],
  ['Payments', `SELECT p.payment_number, p.payment_date, p.direction, p.party_type, coalesce(c.name, s.name) AS party,
      p.amount, (SELECT string_agg(m.method || coalesce(' ' || m.reference, ''), ', ') FROM payment_methods_used m WHERE m.payment_id = p.id) AS mode,
      p.notes FROM payments p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN suppliers s ON s.id = p.supplier_id
      ORDER BY p.created_at`],
  ['Expenses', `SELECT * FROM expenses ORDER BY created_at`],
];

const NUMERIC_OID = 1700;

async function sheetRows(sql: string): Promise<Record<string, unknown>[]> {
  const res = await pool.query(sql);
  const numeric = new Set(res.fields.filter((f) => f.dataTypeID === NUMERIC_OID).map((f) => f.name));
  return res.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = numeric.has(k) && v !== null ? Number(v) : v;
    }
    return out;
  });
}

/** Builds the whole workbook in memory: every bill, item, return, estimate, payment and baki. */
export async function buildWorkbook(): Promise<Buffer> {
  const wb = XLSX.utils.book_new();
  for (const [name, sql] of SHEETS) {
    const rows = await sheetRows(sql);
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { cellDates: true }) : XLSX.utils.aoa_to_sheet([['(no records yet)']]);
    if (rows.length) {
      ws['!cols'] = Object.keys(rows[0]!).map((k) => ({ wch: Math.min(40, Math.max(12, k.length + 2)) }));
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

// ------------------------------------------------- automatic Excel copy on disk
let timer: NodeJS.Timeout | undefined;

/**
 * Rewrites the Excel copy a few seconds after the last change. Written to a temp
 * file and renamed, so a half-written file is never seen. If Excel has the file
 * open (Windows locks it) the write is simply retried after the next change.
 */
export function scheduleExcelMirror(dir: string | undefined, log: (m: string) => void): void {
  if (!dir) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await mkdir(dir, { recursive: true });
      const target = path.join(dir, 'santu-hardware-data.xlsx');
      const tmp = `${target}.tmp`;
      await writeFile(tmp, await buildWorkbook());
      await rename(tmp, target);
    } catch (err) {
      log(`Excel copy not written: ${(err as Error).message}`);
    }
  }, 5000);
}
