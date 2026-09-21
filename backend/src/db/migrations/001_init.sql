-- =============================================================
-- Santu Hardware :: core schema
-- All monetary values: numeric(14,2)   All quantities: numeric(18,4)
-- =============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- auth ----------
CREATE TABLE roles (
  code        text PRIMARY KEY,                 -- ADMIN | MANAGER | CASHIER
  name        text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role_code     text NOT NULL REFERENCES roles(code),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_email_idx ON users (lower(email));

-- ---------- units & conversion ----------
-- A unit belongs to a dimension. factor_to_base converts 1 <unit> into the
-- dimension's base unit.  e.g. FEET -> 0.3048 METER ; GRAM -> 0.001 KG
CREATE TABLE units (
  code           text PRIMARY KEY,              -- PCS, KG, GRAM, LITRE, ML, METER, FEET, BOX...
  name           text NOT NULL,
  dimension      text NOT NULL,                 -- COUNT | WEIGHT | VOLUME | LENGTH
  factor_to_base numeric(20,10) NOT NULL CHECK (factor_to_base > 0),
  is_base        boolean NOT NULL DEFAULT false,
  decimals       int NOT NULL DEFAULT 2
);
CREATE INDEX units_dimension_idx ON units (dimension);

-- Explicit overrides (e.g. 1 BOX of a specific item = 12 PCS). Item-scoped
-- rows win over global rows.
CREATE TABLE unit_conversions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid,
  from_unit   text NOT NULL REFERENCES units(code),
  to_unit     text NOT NULL REFERENCES units(code),
  factor      numeric(20,10) NOT NULL CHECK (factor > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, from_unit, to_unit)
);

-- ---------- masters ----------
CREATE TABLE warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  code       text NOT NULL UNIQUE,
  address    text,
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE brands (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE item_groups (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  mobile              text,
  email               text,
  address             text,
  gstin               text,
  credit_limit        numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_mobile_idx ON customers (mobile);
CREATE INDEX customers_name_idx   ON customers (lower(name));

CREATE TABLE suppliers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  mobile              text,
  email               text,
  address             text,
  gstin               text,
  outstanding_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suppliers_mobile_idx ON suppliers (mobile);

-- ---------- items ----------
CREATE TABLE items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  item_code     text NOT NULL UNIQUE,
  description   text,
  item_group_id uuid REFERENCES item_groups(id),
  brand_id      uuid REFERENCES brands(id),
  category_id   uuid REFERENCES categories(id),
  hsn_code      text,
  tax_rate      numeric(5,2) NOT NULL DEFAULT 0,
  -- Unit stock is *maintained* in. All ledger quantities use this unit.
  stock_unit    text NOT NULL REFERENCES units(code),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_code_idx   ON items (lower(item_code));
CREATE INDEX items_name_idx   ON items (lower(name));
CREATE INDEX items_hsn_idx    ON items (hsn_code);
CREATE INDEX items_brand_idx  ON items (brand_id);
CREATE INDEX items_cat_idx    ON items (category_id);
CREATE INDEX items_active_idx ON items (is_active);

-- A sellable packaging variant: "Apex Ultima 20L", "Wall Putty 5KG".
-- pack_size + pack_unit describe how much stock_unit one variant consumes.
CREATE TABLE item_variants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name           text NOT NULL,                 -- "20 L"
  sku            text NOT NULL UNIQUE,
  barcode        text UNIQUE,
  pack_size      numeric(18,4) NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  pack_unit      text NOT NULL REFERENCES units(code),
  purchase_price numeric(14,2) NOT NULL DEFAULT 0,
  selling_price  numeric(14,2) NOT NULL DEFAULT 0,
  mrp            numeric(14,2) NOT NULL DEFAULT 0,
  min_stock      numeric(18,4) NOT NULL DEFAULT 0,
  is_default     boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variants_item_idx    ON item_variants (item_id);
CREATE INDEX variants_barcode_idx ON item_variants (barcode);
CREATE INDEX variants_sku_idx     ON item_variants (lower(sku));

-- ---------- stock ----------
-- quantity is ALWAYS expressed in items.stock_unit
CREATE TABLE stock (
  variant_id   uuid NOT NULL REFERENCES item_variants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  quantity     numeric(18,4) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, warehouse_id)
);

CREATE TABLE stock_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES item_variants(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  txn_type      text NOT NULL CHECK (txn_type IN
                  ('OPENING','SALE','PURCHASE','SALES_RETURN','PURCHASE_RETURN',
                   'ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','CANCELLATION')),
  quantity      numeric(18,4) NOT NULL,          -- signed, in stock_unit
  entered_qty   numeric(18,4),                   -- as typed by the user
  entered_unit  text REFERENCES units(code),
  balance_after numeric(18,4) NOT NULL,
  rate          numeric(14,2),
  reference_type text,                           -- SALES_INVOICE | PURCHASE_INVOICE ...
  reference_id   uuid,
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_txn_variant_idx ON stock_transactions (variant_id, created_at DESC);
CREATE INDEX stock_txn_ref_idx     ON stock_transactions (reference_type, reference_id);
CREATE INDEX stock_txn_created_idx ON stock_transactions (created_at DESC);

-- ---------- numbering ----------
CREATE TABLE invoice_sequences (
  doc_type    text PRIMARY KEY,                  -- SALES_INVOICE | PURCHASE | RETURN | PAYMENT
  prefix      text NOT NULL,                     -- 'INV-'
  next_number bigint NOT NULL DEFAULT 1,
  padding     int NOT NULL DEFAULT 5,
  suffix      text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- sales ----------
CREATE TABLE sales_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  text NOT NULL UNIQUE,
  customer_id     uuid REFERENCES customers(id),
  customer_name   text NOT NULL,                 -- snapshot
  customer_mobile text,
  customer_address text,
  customer_gstin  text,
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  invoice_date    timestamptz NOT NULL DEFAULT now(),
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  item_discount   numeric(14,2) NOT NULL DEFAULT 0,
  bill_discount   numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,
  round_off       numeric(14,2) NOT NULL DEFAULT 0,
  grand_total     numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(14,2) NOT NULL DEFAULT 0,
  due_amount      numeric(14,2) NOT NULL DEFAULT 0,
  payment_status  text NOT NULL DEFAULT 'UNPAID'
                  CHECK (payment_status IN ('PAID','PARTIAL','UNPAID')),
  status          text NOT NULL DEFAULT 'COMPLETED'
                  CHECK (status IN ('DRAFT','HELD','COMPLETED','CANCELLED')),
  notes           text,
  cancelled_at    timestamptz,
  cancelled_by    uuid REFERENCES users(id),
  cancel_reason   text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_number_idx   ON sales_invoices (invoice_number);
CREATE INDEX sales_customer_idx ON sales_invoices (customer_id, created_at DESC);
CREATE INDEX sales_created_idx  ON sales_invoices (created_at DESC);
CREATE INDEX sales_status_idx   ON sales_invoices (status, payment_status);

CREATE TABLE sales_invoice_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  variant_id    uuid REFERENCES item_variants(id),
  line_no       int NOT NULL,
  -- immutable snapshots: historical invoices never change
  item_name     text NOT NULL,
  item_code     text NOT NULL,
  hsn_code      text,
  variant_name  text,
  quantity      numeric(18,4) NOT NULL,          -- as sold, in sold_unit
  sold_unit     text NOT NULL REFERENCES units(code),
  stock_qty     numeric(18,4) NOT NULL,          -- converted, in stock_unit
  rate          numeric(14,2) NOT NULL,          -- per sold_unit
  mrp           numeric(14,2) NOT NULL DEFAULT 0,
  purchase_rate numeric(14,2) NOT NULL DEFAULT 0,-- for profit reports
  discount_pct  numeric(5,2) NOT NULL DEFAULT 0,
  discount_amt  numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate      numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(14,2) NOT NULL DEFAULT 0,
  line_total    numeric(14,2) NOT NULL,
  returned_qty  numeric(18,4) NOT NULL DEFAULT 0
);
CREATE INDEX sii_invoice_idx ON sales_invoice_items (invoice_id);
CREATE INDEX sii_variant_idx ON sales_invoice_items (variant_id);

-- ---------- payments ----------
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  party_type     text NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER')),
  customer_id    uuid REFERENCES customers(id),
  supplier_id    uuid REFERENCES suppliers(id),
  direction      text NOT NULL CHECK (direction IN ('IN','OUT')),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date   timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_customer_idx ON payments (customer_id, created_at DESC);
CREATE INDEX payments_created_idx  ON payments (created_at DESC);

-- one row per tender: enables split payments
CREATE TABLE payment_methods_used (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  method     text NOT NULL CHECK (method IN ('CASH','UPI','CARD','BANK','CREDIT')),
  amount     numeric(14,2) NOT NULL CHECK (amount >= 0),
  reference  text
);
CREATE INDEX pmu_payment_idx ON payment_methods_used (payment_id);

-- money applied to a specific document
CREATE TABLE payment_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  document_type   text NOT NULL,                 -- SALES_INVOICE | PURCHASE_INVOICE
  document_id     uuid NOT NULL,
  amount          numeric(14,2) NOT NULL
);
CREATE INDEX pa_document_idx ON payment_allocations (document_type, document_id);

-- ---------- purchases ----------
CREATE TABLE purchase_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number text NOT NULL UNIQUE,
  supplier_invoice_number text,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  invoice_date    timestamptz NOT NULL DEFAULT now(),
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  discount        numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,
  grand_total     numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(14,2) NOT NULL DEFAULT 0,
  due_amount      numeric(14,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'COMPLETED'
                  CHECK (status IN ('DRAFT','COMPLETED','CANCELLED')),
  notes           text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pi_supplier_idx ON purchase_invoices (supplier_id, created_at DESC);

CREATE TABLE purchase_invoice_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id   uuid NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES item_variants(id),
  line_no       int NOT NULL,
  item_name     text NOT NULL,
  quantity      numeric(18,4) NOT NULL,
  purchase_unit text NOT NULL REFERENCES units(code),
  stock_qty     numeric(18,4) NOT NULL,
  rate          numeric(14,2) NOT NULL,
  discount_amt  numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate      numeric(5,2) NOT NULL DEFAULT 0,
  line_total    numeric(14,2) NOT NULL
);
CREATE INDEX pii_purchase_idx ON purchase_invoice_items (purchase_id);

-- ---------- returns ----------
CREATE TABLE sales_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number  text NOT NULL UNIQUE,
  invoice_id     uuid NOT NULL REFERENCES sales_invoices(id),
  customer_id    uuid REFERENCES customers(id),
  warehouse_id   uuid NOT NULL REFERENCES warehouses(id),
  return_date    timestamptz NOT NULL DEFAULT now(),
  total_amount   numeric(14,2) NOT NULL DEFAULT 0,
  refund_mode    text NOT NULL DEFAULT 'CREDIT_NOTE'
                 CHECK (refund_mode IN ('CASH','UPI','BANK','CREDIT_NOTE')),
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_return_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id       uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  invoice_item_id uuid NOT NULL REFERENCES sales_invoice_items(id),
  variant_id      uuid REFERENCES item_variants(id),
  item_name       text NOT NULL,
  quantity        numeric(18,4) NOT NULL CHECK (quantity > 0),
  return_unit     text NOT NULL REFERENCES units(code),
  stock_qty       numeric(18,4) NOT NULL,
  rate            numeric(14,2) NOT NULL,
  line_total      numeric(14,2) NOT NULL
);

-- ---------- settings & audit ----------
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  user_name   text,
  action      text NOT NULL,                     -- SALE_CREATE, PRICE_CHANGE ...
  entity_type text NOT NULL,
  entity_id   uuid,
  old_value   jsonb,
  new_value   jsonb,
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx  ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_created_idx ON audit_logs (created_at DESC);
