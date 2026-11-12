ALTER TABLE financial_operations ADD COLUMN IF NOT EXISTS replaces_id uuid UNIQUE REFERENCES financial_operations(id);
