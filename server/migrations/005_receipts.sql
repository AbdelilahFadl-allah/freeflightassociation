CREATE TABLE IF NOT EXISTS receipts (
  number bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES financial_operations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
