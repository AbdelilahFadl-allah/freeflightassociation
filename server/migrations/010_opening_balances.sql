ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_set boolean NOT NULL DEFAULT false;
UPDATE accounts SET opening_set=true WHERE id IN (SELECT account_id FROM ledger_entries);
