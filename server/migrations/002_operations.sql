CREATE TABLE IF NOT EXISTS flight_activities (
  id uuid PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  site text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flight_participants (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES flight_activities(id),
  member_id uuid REFERENCES members(id),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('pilot','passenger','coordinator','driver'))
);

CREATE TABLE IF NOT EXISTS tandem_flights (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES flight_activities(id),
  pilot_id uuid NOT NULL REFERENCES flight_participants(id),
  passenger_id uuid NOT NULL REFERENCES flight_participants(id),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  passenger_form_completed boolean NOT NULL DEFAULT false,
  receipt_reference text,
  observations text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  designation text NOT NULL,
  make_model text NOT NULL DEFAULT '',
  size_rating text NOT NULL DEFAULT '',
  acquired_on date,
  last_inspection_on date,
  reserve_repacked_on date,
  condition text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_loans (
  id uuid PRIMARY KEY,
  equipment_id uuid NOT NULL REFERENCES equipment(id),
  borrower_name text NOT NULL,
  member_id uuid REFERENCES members(id),
  loaned_on date NOT NULL,
  expected_return_on date,
  returned_on date,
  condition_out text NOT NULL,
  condition_in text,
  CHECK (expected_return_on IS NULL OR expected_return_on >= loaned_on),
  CHECK (returned_on IS NULL OR returned_on >= loaned_on),
  CHECK ((returned_on IS NULL AND condition_in IS NULL) OR (returned_on IS NOT NULL AND condition_in IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_one_open_loan
  ON equipment_loans(equipment_id) WHERE returned_on IS NULL;
