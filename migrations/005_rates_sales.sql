-- Payment rates per brand (one row per tier) and sales entered for each stream.

CREATE TABLE IF NOT EXISTS rate_cards (
  id SERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',                -- version name, e.g. 2026_Rates_V1
  account TEXT NOT NULL DEFAULT 'Brand',         -- Brand or Creator account (for reference)
  period TEXT NOT NULL DEFAULT 'All' CHECK (period IN ('BAU', 'Mega', 'All')),
  stream_type TEXT NOT NULL DEFAULT 'any' CHECK (stream_type IN ('single', 'dual', 'any')),
  method TEXT NOT NULL DEFAULT 'base_comms' CHECK (method IN ('base_comms', 'split')),
  tier TEXT NOT NULL DEFAULT '',
  gmv_min NUMERIC,                               -- GMV per hour bounds for this tier
  gmv_max NUMERIC,
  base_per_hour NUMERIC NOT NULL DEFAULT 0,      -- talent base, $ per stream hour
  total_comms NUMERIC NOT NULL DEFAULT 0,        -- fraction of total GMV
  tiktok_comms NUMERIC NOT NULL DEFAULT 0,       -- split method only
  shopee_comms NUMERIC NOT NULL DEFAULT 0,       -- split method only
  agency_comms NUMERIC NOT NULL DEFAULT 0.2,     -- agency share taken off the talent's gross
  valid_from DATE,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_cards_brand_idx ON rate_cards (lower(brand));

-- Sales are keyed by the stream itself (not a schedule version's row id), so they survive
-- re-running and re-publishing the schedule.
CREATE TABLE IF NOT EXISTS stream_sales (
  id SERIAL PRIMARY KEY,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_min INT NOT NULL,
  end_min INT NOT NULL,
  host_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  tiktok_gmv NUMERIC,
  shopee_gmv NUMERIC,
  pay_status TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (month_id, date, start_min, brand, platform, host_name)
);
