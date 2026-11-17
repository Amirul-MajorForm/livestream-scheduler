ALTER TABLE scheduled_streams ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'tentative';
ALTER TABLE scheduled_streams ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE scheduled_streams ADD CONSTRAINT scheduled_streams_status_chk CHECK (status IN ('tentative', 'confirmed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
