-- Quotations (estimates).
--
-- A quotation moves no stock and owes no money: it is a promise of a price,
-- valid until a date. Its lines snapshot the item name and rate exactly the
-- way an invoice does, so the quoted price stays quoted even after the item
-- master changes — that difference is what the conversion screen shows the
-- operator before a bill is raised.

CREATE TABLE quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text NOT NULL UNIQUE,
  customer_id      uuid REFERENCES customers(id),
  customer_name    text NOT NULL,
  customer_mobile  text,
  customer_address text,
  customer_gstin   text,
  quotation_date   timestamptz NOT NULL DEFAULT now(),
  valid_until      date,
  subtotal         numeric(14,2) NOT NULL DEFAULT 0,
  item_discount    numeric(14,2) NOT NULL DEFAULT 0,
  bill_discount    numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount       numeric(14,2) NOT NULL DEFAULT 0,
  round_off        numeric(14,2) NOT NULL DEFAULT 0,
  grand_total      numeric(14,2) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','CONVERTED','EXPIRED','CANCELLED')),
  converted_invoice_id uuid REFERENCES sales_invoices(id),
  converted_at     timestamptz,
  notes            text,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotations_number_idx   ON quotations (quotation_number);
CREATE INDEX quotations_customer_idx ON quotations (customer_id, created_at DESC);
CREATE INDEX quotations_created_idx  ON quotations (created_at DESC);
CREATE INDEX quotations_status_idx   ON quotations (status);

CREATE TABLE quotation_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  variant_id    uuid REFERENCES item_variants(id),
  line_no       int NOT NULL,
  item_name     text NOT NULL,
  item_code     text NOT NULL,
  hsn_code      text,
  variant_name  text,
  quantity      numeric(18,4) NOT NULL,
  sold_unit     text NOT NULL REFERENCES units(code),
  rate          numeric(14,2) NOT NULL,
  mrp           numeric(14,2) NOT NULL DEFAULT 0,
  discount_pct  numeric(5,2) NOT NULL DEFAULT 0,
  discount_amt  numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate      numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(14,2) NOT NULL DEFAULT 0,
  line_total    numeric(14,2) NOT NULL
);
CREATE INDEX qi_quotation_idx ON quotation_items (quotation_id);

-- A bill raised from a quotation points back at it, so the audit trail runs
-- both ways.
ALTER TABLE sales_invoices
  ADD COLUMN quotation_id uuid REFERENCES quotations(id);
CREATE INDEX sales_quotation_idx ON sales_invoices (quotation_id);

INSERT INTO invoice_sequences (doc_type, prefix, next_number, padding)
VALUES ('QUOTATION', 'QTN-', 1, 5)
ON CONFLICT (doc_type) DO NOTHING;
