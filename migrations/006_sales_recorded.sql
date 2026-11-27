-- Sales imported from the sheet keep the rate version, tier and fee the sheet recorded,
-- so past months show what was actually worked out at the time.
ALTER TABLE stream_sales ADD COLUMN IF NOT EXISTS rate_label TEXT NOT NULL DEFAULT '';
ALTER TABLE stream_sales ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT '';
ALTER TABLE stream_sales ADD COLUMN IF NOT EXISTS recorded_fee NUMERIC;
ALTER TABLE stream_sales ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
ALTER TABLE stream_sales ADD COLUMN IF NOT EXISTS fee_blank BOOLEAN NOT NULL DEFAULT false;   -- the sheet had sales but no fee (e.g. creator deals)
