import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { badRequest } from '../../utils/errors.js';

/**
 * Every report answers the same shape: a column spec plus rows, so the client
 * renders and exports them all with one table component.
 */
export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'money' | 'number' | 'date' | 'datetime';
  align?: 'left' | 'right';
}

const filters = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

type Filters = z.infer<typeof filters>;

/** Inclusive day window; an absent bound means "no bound". */
function dateRange(f: Filters, column: string, values: unknown[]): string {
  const clauses: string[] = [];
  if (f.from) {
    values.push(f.from);
    clauses.push(`${column} >= $${values.length}::date`);
  }
  if (f.to) {
    values.push(f.to);
    clauses.push(`${column} < ($${values.length}::date + interval '1 day')`);
  }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

function toCsv(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function send(
  reply: FastifyReply,
  f: Filters,
  name: string,
  columns: ReportColumn[],
  rows: Array<Record<string, unknown>>,
  totals?: Record<string, number>,
): unknown {
  if (f.format === 'csv') {
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name}.csv"`)
      .send(toCsv(columns, rows));
  }
  return { data: { name, columns, rows, totals: totals ?? null } };
}

const money = (key: string, label: string): ReportColumn => ({ key, label, type: 'money', align: 'right' });
const num = (key: string, label: string): ReportColumn => ({ key, label, type: 'number', align: 'right' });
const text = (key: string, label: string): ReportColumn => ({ key, label, type: 'text' });

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requirePermission('report:view'));

  // ------------------------------------------------------------ daily sales
  app.get('/daily-sales', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    const where = dateRange(f, 'invoice_date', values);

    const { rows } = await query(
      `SELECT to_char(invoice_date, 'YYYY-MM-DD') AS day,
              count(*)::int                        AS bills,
              sum(grand_total)::numeric(14,2)      AS sales,
              sum(paid_amount)::numeric(14,2)      AS collected,
              sum(due_amount)::numeric(14,2)       AS due,
              sum(item_discount + bill_discount)::numeric(14,2) AS discount
         FROM sales_invoices
        WHERE status = 'COMPLETED' ${where}
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'daily-sales', [
      { key: 'day', label: 'Date', type: 'date' },
      num('bills', 'Bills'),
      money('sales', 'Sales'),
      money('discount', 'Discount'),
      money('collected', 'Collected'),
      money('due', 'Due'),
    ], rows, sumOf(rows, ['bills', 'sales', 'discount', 'collected', 'due']));
  });

  // ---------------------------------------------------------- monthly sales
  app.get('/monthly-sales', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    const where = dateRange(f, 'invoice_date', values);

    const { rows } = await query(
      `SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
              count(*)::int                   AS bills,
              sum(grand_total)::numeric(14,2) AS sales,
              sum(paid_amount)::numeric(14,2) AS collected,
              sum(due_amount)::numeric(14,2)  AS due
         FROM sales_invoices
        WHERE status = 'COMPLETED' ${where}
        GROUP BY month
        ORDER BY month DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'monthly-sales', [
      text('month', 'Month'),
      num('bills', 'Bills'),
      money('sales', 'Sales'),
      money('collected', 'Collected'),
      money('due', 'Due'),
    ], rows, sumOf(rows, ['bills', 'sales', 'collected', 'due']));
  });

  // --------------------------------------------------------- item-wise sales
  app.get('/item-sales', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    let where = dateRange(f, 'si.invoice_date', values);
    if (f.itemId) {
      values.push(f.itemId);
      where += ` AND v.item_id = $${values.length}::uuid`;
    }
    if (f.brandId) {
      values.push(f.brandId);
      where += ` AND i.brand_id = $${values.length}::uuid`;
    }

    const { rows } = await query(
      `SELECT sii.item_name, sii.item_code,
              coalesce(sii.variant_name, '')        AS variant_name,
              sum(sii.stock_qty)::numeric(18,4)     AS qty,
              max(i.stock_unit)                     AS unit,
              sum(sii.line_total)::numeric(14,2)    AS revenue,
              sum(sii.cost_amount)::numeric(14,2)   AS cost,
              (sum(sii.line_total) - sum(sii.cost_amount))::numeric(14,2) AS profit
         FROM sales_invoice_items sii
         JOIN sales_invoices si ON si.id = sii.invoice_id
         LEFT JOIN item_variants v ON v.id = sii.variant_id
         LEFT JOIN items i ON i.id = v.item_id
        WHERE si.status = 'COMPLETED' ${where}
        GROUP BY sii.item_name, sii.item_code, coalesce(sii.variant_name, '')
        ORDER BY revenue DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'item-wise-sales', [
      text('item_name', 'Item'),
      text('variant_name', 'Pack'),
      text('item_code', 'Code'),
      num('qty', 'Qty sold'),
      text('unit', 'Unit'),
      money('revenue', 'Revenue'),
      money('cost', 'Cost'),
      money('profit', 'Profit'),
    ], rows, sumOf(rows, ['qty', 'revenue', 'cost', 'profit']));
  });

  // ----------------------------------------------------- customer-wise sales
  app.get('/customer-sales', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    let where = dateRange(f, 'si.invoice_date', values);
    if (f.customerId) {
      values.push(f.customerId);
      where += ` AND si.customer_id = $${values.length}::uuid`;
    }

    const { rows } = await query(
      `SELECT si.customer_name,
              coalesce(c.mobile, si.customer_mobile, '') AS mobile,
              count(*)::int                    AS bills,
              sum(si.grand_total)::numeric(14,2) AS sales,
              sum(si.paid_amount)::numeric(14,2) AS paid,
              sum(si.due_amount)::numeric(14,2)  AS due
         FROM sales_invoices si
         LEFT JOIN customers c ON c.id = si.customer_id
        WHERE si.status = 'COMPLETED' ${where}
        GROUP BY si.customer_name, coalesce(c.mobile, si.customer_mobile, '')
        ORDER BY sales DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'customer-wise-sales', [
      text('customer_name', 'Customer'),
      text('mobile', 'Mobile'),
      num('bills', 'Bills'),
      money('sales', 'Sales'),
      money('paid', 'Paid'),
      money('due', 'Due'),
    ], rows, sumOf(rows, ['bills', 'sales', 'paid', 'due']));
  });

  // -------------------------------------------------------- purchase report
  app.get('/purchases', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    let where = dateRange(f, 'p.invoice_date', values);
    if (f.supplierId) {
      values.push(f.supplierId);
      where += ` AND p.supplier_id = $${values.length}::uuid`;
    }

    const { rows } = await query(
      `SELECT p.purchase_number, s.name AS supplier_name,
              coalesce(p.supplier_invoice_number, '') AS supplier_invoice_number,
              to_char(p.invoice_date, 'YYYY-MM-DD')   AS day,
              p.grand_total, p.paid_amount, p.due_amount
         FROM purchase_invoices p
         JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.status <> 'CANCELLED' ${where}
        ORDER BY p.invoice_date DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'purchase-report', [
      text('purchase_number', 'Purchase no.'),
      { key: 'day', label: 'Date', type: 'date' },
      text('supplier_name', 'Supplier'),
      text('supplier_invoice_number', 'Their invoice'),
      money('grand_total', 'Total'),
      money('paid_amount', 'Paid'),
      money('due_amount', 'Payable'),
    ], rows, sumOf(rows, ['grand_total', 'paid_amount', 'due_amount']));
  });

  // ------------------------------------------- stock report & stock valuation
  app.get('/stock', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    let where = '';
    if (f.brandId) {
      values.push(f.brandId);
      where += ` AND i.brand_id = $${values.length}::uuid`;
    }
    if (f.itemId) {
      values.push(f.itemId);
      where += ` AND i.id = $${values.length}::uuid`;
    }

    const { rows } = await query(
      `SELECT i.name AS item_name, v.name AS variant_name, v.sku,
              coalesce(b.name, '') AS brand_name,
              i.stock_unit AS unit,
              coalesce(sum(s.quantity), 0)::numeric(18,4) AS stock,
              v.min_stock,
              (coalesce(sum(s.quantity),0) * v.purchase_price / nullif(v.pack_size,0))::numeric(14,2) AS cost_value,
              (coalesce(sum(s.quantity),0) * v.selling_price / nullif(v.pack_size,0))::numeric(14,2) AS retail_value
         FROM item_variants v
         JOIN items i ON i.id = v.item_id
         LEFT JOIN brands b ON b.id = i.brand_id
         LEFT JOIN stock s ON s.variant_id = v.id
        WHERE v.is_active AND i.is_active ${where}
        GROUP BY i.id, v.id, b.name
        ORDER BY i.name, v.pack_size
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'stock-valuation', [
      text('item_name', 'Item'),
      text('variant_name', 'Pack'),
      text('brand_name', 'Brand'),
      text('sku', 'SKU'),
      num('stock', 'Stock'),
      text('unit', 'Unit'),
      num('min_stock', 'Min'),
      money('cost_value', 'Value at cost'),
      money('retail_value', 'Value at retail'),
    ], rows, sumOf(rows, ['cost_value', 'retail_value']));
  });

  // ------------------------------------------------- outstanding receivables
  app.get('/receivables', async (request, reply) => {
    const f = filters.parse(request.query);

    const { rows } = await query(
      `SELECT c.name AS customer_name, coalesce(c.mobile,'') AS mobile,
              c.credit_limit, c.outstanding_balance,
              count(si.id) FILTER (WHERE si.due_amount > 0)::int AS open_bills,
              to_char(min(si.invoice_date) FILTER (WHERE si.due_amount > 0), 'YYYY-MM-DD') AS oldest_due
         FROM customers c
         LEFT JOIN sales_invoices si
           ON si.customer_id = c.id AND si.status = 'COMPLETED'
        WHERE c.outstanding_balance <> 0
        GROUP BY c.id
        ORDER BY c.outstanding_balance DESC
        LIMIT ${f.limit}`,
    );

    return send(reply, f, 'outstanding-receivables', [
      text('customer_name', 'Customer'),
      text('mobile', 'Mobile'),
      num('open_bills', 'Open bills'),
      { key: 'oldest_due', label: 'Oldest due', type: 'date' },
      money('credit_limit', 'Credit limit'),
      money('outstanding_balance', 'Outstanding'),
    ], rows, sumOf(rows, ['outstanding_balance']));
  });

  // --------------------------------------------------------- payment report
  app.get('/payments', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    let where = dateRange(f, 'p.payment_date', values);
    if (f.customerId) {
      values.push(f.customerId);
      where += ` AND p.customer_id = $${values.length}::uuid`;
    }

    const { rows } = await query(
      `SELECT p.payment_number,
              to_char(p.payment_date, 'YYYY-MM-DD') AS day,
              coalesce(c.name, 'Walk-in') AS customer_name,
              p.direction, p.amount,
              coalesce(string_agg(m.method || ' ' || m.amount::text, ', '), '') AS methods
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN payment_methods_used m ON m.payment_id = p.id
        WHERE true ${where}
        GROUP BY p.id, c.name
        ORDER BY p.payment_date DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'payment-report', [
      text('payment_number', 'Receipt no.'),
      { key: 'day', label: 'Date', type: 'date' },
      text('customer_name', 'Customer'),
      text('direction', 'In / Out'),
      text('methods', 'Methods'),
      money('amount', 'Amount'),
    ], rows, sumOf(rows, ['amount']));
  });

  // --------------------------------------------------------------- profit
  app.get('/profit', async (request, reply) => {
    const f = filters.parse(request.query);
    const values: unknown[] = [];
    const where = dateRange(f, 'si.invoice_date', values);

    const { rows } = await query(
      `SELECT to_char(si.invoice_date, 'YYYY-MM-DD') AS day,
              sum(sii.line_total)::numeric(14,2)   AS revenue,
              sum(sii.cost_amount)::numeric(14,2)  AS cost,
              (sum(sii.line_total) - sum(sii.cost_amount))::numeric(14,2) AS profit,
              CASE WHEN sum(sii.line_total) > 0
                   THEN round(100 * (sum(sii.line_total) - sum(sii.cost_amount))
                              / sum(sii.line_total), 2)
                   ELSE 0 END AS margin_pct
         FROM sales_invoice_items sii
         JOIN sales_invoices si ON si.id = sii.invoice_id
        WHERE si.status = 'COMPLETED' ${where}
        GROUP BY day
        ORDER BY day DESC
        LIMIT ${f.limit}`,
      values,
    );

    return send(reply, f, 'profit-estimate', [
      { key: 'day', label: 'Date', type: 'date' },
      money('revenue', 'Revenue'),
      money('cost', 'Cost of goods'),
      money('profit', 'Profit'),
      num('margin_pct', 'Margin %'),
    ], rows, sumOf(rows, ['revenue', 'cost', 'profit']));
  });

  app.get('/:unknown', async (request) => {
    const { unknown } = z.object({ unknown: z.string() }).parse(request.params);
    throw badRequest(`There is no "${unknown}" report.`);
  });
}

function sumOf(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const key of keys) {
    totals[key] = Math.round(rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0) * 100) / 100;
  }
  return totals;
}
