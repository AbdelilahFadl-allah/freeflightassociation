CREATE TABLE IF NOT EXISTS administrator_site_permissions (
  administrator_id uuid PRIMARY KEY REFERENCES administrators(object_id),
  site_team boolean NOT NULL DEFAULT false,
  security_manager boolean NOT NULL DEFAULT false
);

ALTER TABLE flight_sites ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE flight_sites ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE flight_sites ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE flight_sites ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES administrators(object_id);
ALTER TABLE flight_sites ADD COLUMN IF NOT EXISTS signature jsonb;
ALTER TABLE site_landings ADD COLUMN IF NOT EXISTS landing_type text NOT NULL DEFAULT 'primary';
ALTER TABLE site_landings ADD COLUMN IF NOT EXISTS polygon jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='site_landing_type_valid' AND conrelid='site_landings'::regclass) THEN
    ALTER TABLE site_landings ADD CONSTRAINT site_landing_type_valid CHECK (landing_type IN ('primary','emergency'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='site_validation_consistent' AND conrelid='flight_sites'::regclass) THEN
    ALTER TABLE flight_sites ADD CONSTRAINT site_validation_consistent CHECK (
      (validated_at IS NULL AND validated_by IS NULL AND signature IS NULL) OR
      (validated_at IS NOT NULL AND validated_by IS NOT NULL AND signature IS NOT NULL)
    );
  END IF;
END $$;
