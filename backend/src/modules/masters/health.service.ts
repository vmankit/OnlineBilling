import { query } from '../../db/pool.js';

/**
 * Data health checks.
 *
 * Every check here runs a real query and reports what it found. A check that
 * cannot fail is not a check — the point of this screen is to surface the
 * cases where the books disagree with themselves, so the shop can decide what
 * to do before those numbers reach a customer.
 */

export interface HealthIssue {
  category: string;
  severity: 'Error' | 'Warning';
  record: string;
  description: string;
  fix: string;
}

export interface HealthReport {
  checks: number;
  passed: number;
  errors: number;
  warnings: number;
  health: 'Good' | 'Needs attention' | 'Problems found';
  issues: HealthIssue[];
}

interface Check {
  category: string;
  severity: 'Error' | 'Warning';
  sql: string;
  /** Builds the row's description; `record` is the row's own label. */
  describe: (row: Record<string, unknown>) => string;
  fix: string;
}

const CHECKS: Check[] = [
  {
    category: 'Stock',
    severity: 'Error',
    sql: `SELECT i.name || ' [' || v.name || ']' AS record,
                 s.quantity::float AS balance,
                 coalesce(t.total, 0)::float AS ledger
            FROM stock s
            JOIN item_variants v ON v.id = s.variant_id
            JOIN items i ON i.id = v.item_id
            LEFT JOIN (SELECT variant_id, sum(quantity) AS total
                         FROM stock_transactions GROUP BY variant_id) t
              ON t.variant_id = s.variant_id
           WHERE s.quantity <> coalesce(t.total, 0)`,
    describe: (r) => `Stock says ${r.balance}, but its entries add up to ${r.ledger}.`,
    fix: 'Stock ko theek karein (Items → Stock Adjust) taaki dono barabar ho jaayein.',
  },
  {
    category: 'Stock',
    severity: 'Error',
    sql: `SELECT i.name || ' [' || v.name || ']' AS record, s.quantity::float AS balance
            FROM stock s
            JOIN item_variants v ON v.id = s.variant_id
            JOIN items i ON i.id = v.item_id
           WHERE s.quantity < 0`,
    describe: (r) => `Stock is negative (${r.balance}) — more was sold than the books hold.`,
    fix: 'Purchase entry chhoot gayi hogi — wo daal kar stock theek karein.',
  },
  {
    category: 'Party',
    severity: 'Warning',
    sql: `SELECT c.name AS record, c.outstanding_balance::float AS balance
            FROM customers c
           WHERE c.outstanding_balance <> 0
             AND NOT EXISTS (SELECT 1 FROM sales_invoices si WHERE si.customer_id = c.id)`,
    describe: (r) => `Baki ₹${r.balance} likha hai par is party ka ek bhi bill nahi hai.`,
    fix: 'Purana udhaar hai to rehne dein; warna party ka balance theek karein.',
  },
  {
    category: 'Party',
    severity: 'Warning',
    // A credit-note return leaves money with the shop, which shows as a
    // negative balance, so it is subtracted before comparing — otherwise
    // every party who ever returned something was reported as wrong.
    sql: `SELECT c.name AS record,
                 c.outstanding_balance::float AS stored,
                 (coalesce(d.due, 0) - coalesce(r.credit, 0))::float AS expected
            FROM customers c
            LEFT JOIN (SELECT customer_id, sum(due_amount) AS due
                         FROM sales_invoices
                        WHERE status = 'COMPLETED'
                        GROUP BY customer_id) d ON d.customer_id = c.id
            LEFT JOIN (SELECT customer_id, sum(total_amount) AS credit
                         FROM sales_returns
                        WHERE refund_mode = 'CREDIT_NOTE'
                        GROUP BY customer_id) r ON r.customer_id = c.id
           WHERE EXISTS (SELECT 1 FROM sales_invoices si WHERE si.customer_id = c.id)
             AND abs(c.outstanding_balance - (coalesce(d.due, 0) - coalesce(r.credit, 0))) > 0.01`,
    describe: (r) =>
      `Party par ₹${r.stored} likha hai, par bill aur credit note se ₹${r.expected} banta hai.`,
    fix: 'Koi payment bill se jodi nahi gayi ho sakti — khata milaayein.',
  },
  {
    category: 'Party',
    severity: 'Error',
    // What a mahajan is owed must equal what is still unpaid on their bills;
    // Payment Out settles both together, so any gap means one side was missed.
    sql: `SELECT s.name AS record,
                 s.outstanding_balance::float AS stored,
                 coalesce(d.due, 0)::float AS from_bills
            FROM suppliers s
            LEFT JOIN (SELECT supplier_id, sum(due_amount) AS due
                         FROM purchase_invoices WHERE status = 'COMPLETED'
                        GROUP BY supplier_id) d ON d.supplier_id = s.id
           WHERE abs(s.outstanding_balance - coalesce(d.due, 0)) > 0.01`,
    describe: (r) =>
      `Mahajan ko ₹${r.stored} dena likha hai, par unke bill me ₹${r.from_bills} baki hai.`,
    fix: 'Koi Payment Out bill se jodi nahi gayi — mahajan ka khata milaayein.',
  },
  {
    category: 'Item',
    severity: 'Warning',
    sql: `SELECT i.name || ' [' || v.name || ']' AS record
            FROM item_variants v
            JOIN items i ON i.id = v.item_id AND i.is_active
           WHERE v.is_active AND v.selling_price = 0
           ORDER BY i.name
           LIMIT 200`,
    describe: () => 'Selling price nahi bhari hai — POS par rate 0 aayega.',
    fix: 'Items screen par is item ka rate daalein.',
  },
  {
    category: 'Bill',
    severity: 'Error',
    // A credit note lowers what the bill is still worth, so the bill's own
    // total is compared after returns — without that every returned bill
    // looked broken.
    sql: `SELECT si.invoice_number AS record,
                 si.grand_total::float AS grand_total,
                 coalesce(r.returned, 0)::float AS returned,
                 (si.paid_amount + si.due_amount)::float AS parts
            FROM sales_invoices si
            LEFT JOIN (SELECT invoice_id, sum(total_amount) AS returned
                         FROM sales_returns GROUP BY invoice_id) r
              ON r.invoice_id = si.id
           WHERE si.status <> 'CANCELLED'
             AND si.grand_total - coalesce(r.returned, 0) > si.paid_amount + si.due_amount + 0.01`,
    describe: (r) =>
      `Bill ₹${r.grand_total} ka hai, ₹${r.returned} wapas hua, par paid + baki sirf ₹${r.parts} hai.`,
    fix: 'Is bill ki payment entries dekhein.',
  },
];

export async function runHealthCheck(): Promise<HealthReport> {
  const issues: HealthIssue[] = [];
  let passed = 0;

  for (const check of CHECKS) {
    const { rows } = await query<Record<string, unknown>>(check.sql);
    if (rows.length === 0) {
      passed++;
      continue;
    }
    for (const row of rows) {
      issues.push({
        category: check.category,
        severity: check.severity,
        record: String(row.record ?? ''),
        description: check.describe(row),
        fix: check.fix,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'Error').length;
  const warnings = issues.length - errors;

  return {
    checks: CHECKS.length,
    passed,
    errors,
    warnings,
    health: errors > 0 ? 'Problems found' : warnings > 0 ? 'Needs attention' : 'Good',
    issues,
  };
}
