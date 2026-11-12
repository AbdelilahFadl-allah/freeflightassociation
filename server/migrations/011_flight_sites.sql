CREATE TABLE IF NOT EXISTS migration_markers (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS flight_sites (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  municipality text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'maintenance')),
  wind_directions text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (wind_directions <@ ARRAY['N','NE','E','SE','S','SW','W','NW']::text[])
);

CREATE TABLE IF NOT EXISTS site_landings (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES flight_sites(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  removed_at timestamptz
);

DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(110110011);
  IF NOT EXISTS (SELECT 1 FROM migration_markers WHERE name = '011_flight_history_reset') THEN
    DELETE FROM tandem_flights;
    DELETE FROM flight_participants;
    DELETE FROM flight_activities;
    INSERT INTO migration_markers(name) VALUES ('011_flight_history_reset');
  END IF;
END $$;

ALTER TABLE flight_activities ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES flight_sites(id);
ALTER TABLE flight_activities ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned'
  CHECK (status IN ('planned', 'done', 'cancelled'));

CREATE TABLE IF NOT EXISTS flight_notes (
  id uuid PRIMARY KEY,
  flight_id uuid NOT NULL REFERENCES flight_activities(id),
  author_id uuid NOT NULL REFERENCES administrators(object_id),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
