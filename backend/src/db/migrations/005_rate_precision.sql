-- A rate is "per sold unit". Selling a 95-a-kilo item by the gram makes the
-- rate 0.095, and numeric(14,2) rounded that to 0.10 on the stored line while
-- the total (worked out from the exact rate) said 47.50 — a bill whose rate
-- times quantity did not equal its own line total. Four decimals holds every
-- unit the app converts between (the smallest factor is 0.001).
--
-- Amounts stay at two decimals; only the per-unit rate widens.
ALTER TABLE sales_invoice_items  ALTER COLUMN rate TYPE numeric(14,4);
ALTER TABLE quotation_items      ALTER COLUMN rate TYPE numeric(14,4);
ALTER TABLE sales_return_items   ALTER COLUMN rate TYPE numeric(14,4);
