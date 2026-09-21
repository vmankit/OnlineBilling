import type { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';
import { authenticate } from '../../middleware/auth.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', async () => {
    // Day boundary is the server's local midnight — the shop and the server
    // are both in IST once TZ is set on Render.
    const [today, receivables, inventory, lowStock, recentSales, recentPayments, week] =
      await Promise.all([
        query<{ bills: number; sales: number; collected: number }>(
          `SELECT count(*)::int AS bills,
                  coalesce(sum(grand_total),0)::numeric(14,2) AS sales,
                  coalesce(sum(paid_amount),0)::numeric(14,2) AS collected
             FROM sales_invoices
            WHERE status = 'COMPLETED' AND invoice_date >= date_trunc('day', now())`,
        ),
        query<{ outstanding: number; customers: number }>(
          `SELECT coalesce(sum(outstanding_balance),0)::numeric(14,2) AS outstanding,
                  count(*) FILTER (WHERE outstanding_balance > 0)::int AS customers
             FROM customers`,
        ),
        query<{ value: number; units: number }>(
          `SELECT coalesce(sum(s.quantity * v.purchase_price / nullif(v.pack_size,0)),0)::numeric(14,2) AS value,
                  coalesce(sum(s.quantity),0)::numeric(18,4) AS units
             FROM stock s JOIN item_variants v ON v.id = s.variant_id
            WHERE v.is_active`,
        ),
        query(
          `SELECT v.id, i.name AS item_name, v.name AS variant_name, i.stock_unit,
                  coalesce(sum(s.quantity),0)::numeric(18,4) AS stock, v.min_stock
             FROM item_variants v
             JOIN items i ON i.id = v.item_id
             LEFT JOIN stock s ON s.variant_id = v.id
            WHERE v.is_active AND i.is_active
            GROUP BY v.id, i.name, v.name, i.stock_unit, v.min_stock
           HAVING coalesce(sum(s.quantity),0) <= v.min_stock
            ORDER BY (coalesce(sum(s.quantity),0) - v.min_stock) ASC
            LIMIT 8`,
        ),
        query(
          `SELECT id, invoice_number, customer_name, grand_total, due_amount,
                  payment_status, invoice_date
             FROM sales_invoices
            WHERE status = 'COMPLETED'
            ORDER BY created_at DESC LIMIT 6`,
        ),
        query(
          `SELECT p.id, p.payment_number, p.amount, p.payment_date, c.name AS customer_name
             FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
            WHERE p.direction = 'IN'
            ORDER BY p.created_at DESC LIMIT 6`,
        ),
        query<{ day: string; total: number }>(
          `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                  coalesce(sum(si.grand_total),0)::numeric(14,2) AS total
             FROM generate_series(date_trunc('day', now()) - interval '6 days',
                                  date_trunc('day', now()), interval '1 day') AS d(day)
             LEFT JOIN sales_invoices si
               ON si.status = 'COMPLETED'
              AND si.invoice_date >= d.day
              AND si.invoice_date < d.day + interval '1 day'
            GROUP BY d.day ORDER BY d.day`,
        ),
      ]);

    return {
      data: {
        today: today.rows[0],
        receivables: receivables.rows[0],
        inventory: inventory.rows[0],
        lowStock: lowStock.rows,
        recentSales: recentSales.rows,
        recentPayments: recentPayments.rows,
        salesTrend: week.rows,
      },
    };
  });
}
