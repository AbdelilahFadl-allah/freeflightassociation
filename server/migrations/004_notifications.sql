CREATE TABLE IF NOT EXISTS whatsapp_consent (
  member_id uuid PRIMARY KEY REFERENCES members(id),
  opted_in boolean NOT NULL,
  evidence text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES administrators(object_id)
);

CREATE TABLE IF NOT EXISTS notification_batches (
  id uuid PRIMARY KEY,
  template_id text NOT NULL,
  created_by uuid NOT NULL REFERENCES administrators(object_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES notification_batches(id),
  member_id uuid NOT NULL REFERENCES members(id),
  phone text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','sending','submitted','delivered','read','failed','unknown','excluded')),
  reason text,
  provider_message_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, member_id)
);
