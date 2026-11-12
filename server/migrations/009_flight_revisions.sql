ALTER TABLE flight_activities ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE flight_participants ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE tandem_flights ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
