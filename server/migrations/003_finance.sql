CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY CHECK (id IN ('cash','bank')),
  opening_cents bigint NOT NULL DEFAULT 0
);
INSERT INTO accounts(id) VALUES ('cash'),('bank') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id),
  quantity bigint NOT NULL CHECK (quantity <> 0),
  business_date date NOT NULL,
  reason text NOT NULL,
  operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS financial_operations (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('income','expense','sale','purchase','transfer','reversal')),
  business_date date NOT NULL,
  description text NOT NULL,
  counterparty text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT '',
  reverses_id uuid UNIQUE REFERENCES financial_operations(id),
  created_by uuid NOT NULL REFERENCES administrators(object_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES financial_operations(id),
  account_id text NOT NULL REFERENCES accounts(id),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0)
);

CREATE TABLE IF NOT EXISTS trade_lines (
  operation_id uuid NOT NULL REFERENCES financial_operations(id),
  product_id uuid NOT NULL REFERENCES products(id),
  quantity bigint NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents > 0),
  PRIMARY KEY(operation_id, product_id)
);
