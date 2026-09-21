-- Daily shop expenses: tea, transport, labour, salary, rent, electricity.
--
-- The sidebar has said "Purchase & Expense" all along, but nothing behind it
-- could record an expense. Rows are never deleted: a wrong entry is
-- cancelled with a reason and stays on file, the same rule bills follow.
CREATE TABLE expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number text NOT NULL UNIQUE,
  expense_date   timestamptz NOT NULL DEFAULT now(),
  category       text NOT NULL,
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  method         text NOT NULL DEFAULT 'CASH'
                 CHECK (method IN ('CASH','UPI','CARD','BANK')),
  paid_to        text,
  notes          text,
  status         text NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE','CANCELLED')),
  cancel_reason  text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_date_idx ON expenses (expense_date DESC);

INSERT INTO invoice_sequences (doc_type, prefix, next_number, padding)
VALUES ('EXPENSE', 'EXP-', 1, 5)
ON CONFLICT (doc_type) DO NOTHING;

-- Purchase lists are filtered by date now, so the column gets an index.
CREATE INDEX IF NOT EXISTS pi_date_idx ON purchase_invoices (invoice_date DESC);
