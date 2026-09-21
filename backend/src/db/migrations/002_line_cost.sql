-- Cost of goods captured on the invoice line at the moment of sale.
--
-- Profit reporting cannot be derived later: purchase_price and pack_size both
-- live on item_variants and change over time, so a report built by joining
-- them would silently rewrite last month's margin. Snapshotting the cost the
-- same way we snapshot the selling rate keeps history fixed.
ALTER TABLE sales_invoice_items
  ADD COLUMN cost_amount numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN sales_invoice_items.cost_amount IS
  'stock_qty x (variant purchase_price / pack_size) at the time of sale';

-- Reports filter heavily on completed invoices within a date window.
CREATE INDEX IF NOT EXISTS sales_completed_date_idx
  ON sales_invoices (invoice_date DESC)
  WHERE status = 'COMPLETED';

CREATE INDEX IF NOT EXISTS purchase_date_idx
  ON purchase_invoices (invoice_date DESC);
