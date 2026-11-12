CREATE TABLE IF NOT EXISTS admin_whatsapp_contacts (
  administrator_id uuid PRIMARY KEY REFERENCES administrators(object_id),
  phone text NOT NULL,
  opted_in boolean NOT NULL DEFAULT false,
  evidence text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES administrators(object_id)
);

CREATE TABLE IF NOT EXISTS notification_event_settings (
  event text PRIMARY KEY CHECK (event IN ('flight_planned', 'goods_trade', 'gear_added', 'gear_removed', 'financial_operation')),
  enabled boolean NOT NULL DEFAULT false,
  template_id text NOT NULL DEFAULT ''
);
INSERT INTO notification_event_settings(event) VALUES
  ('flight_planned'), ('goods_trade'), ('gear_added'), ('gear_removed'), ('financial_operation')
ON CONFLICT (event) DO NOTHING;

ALTER TABLE notification_batches ADD COLUMN IF NOT EXISTS event text;
ALTER TABLE notification_batches ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE notification_recipients ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE notification_recipients ADD COLUMN IF NOT EXISTS administrator_id uuid REFERENCES administrators(object_id);
CREATE UNIQUE INDEX IF NOT EXISTS notification_recipient_admin_once
  ON notification_recipients(batch_id, administrator_id) WHERE administrator_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_recipient_one_identity' AND conrelid = 'notification_recipients'::regclass) THEN
    ALTER TABLE notification_recipients ADD CONSTRAINT notification_recipient_one_identity
      CHECK ((member_id IS NOT NULL) <> (administrator_id IS NOT NULL));
  END IF;
END $$;
