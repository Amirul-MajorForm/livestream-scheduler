CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'unavailable', 'last resort')),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hosts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gender TEXT NOT NULL DEFAULT '',
  max_streams_month INT,
  max_brand_pct NUMERIC(5,4),
  platforms TEXT NOT NULL DEFAULT 'TikTok, Shopee',
  allowed_rooms TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS host_brand_prefs (
  host_id INT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('preferred', 'regular', 'excluded')),
  PRIMARY KEY (host_id, brand_id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'host')),
  host_id INT UNIQUE REFERENCES hosts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS months (
  id SERIAL PRIMARY KEY,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 0 AND 11),
  bau_weekday_pct NUMERIC(5,4) NOT NULL DEFAULT 0.2,
  bau_weekend_pct NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  mega_weekday_pct NUMERIC(5,4) NOT NULL DEFAULT 0.2,
  mega_weekend_pct NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  availability_open BOOLEAN NOT NULL DEFAULT TRUE,
  published_run_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS sale_days (
  id SERIAL PRIMARY KEY,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day INT NOT NULL CHECK (day BETWEEN 1 AND 31),
  UNIQUE (month_id, day)
);

CREATE TABLE IF NOT EXISTS commitments (
  id SERIAL PRIMARY KEY,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('bau', 'mega')),
  sale TEXT NOT NULL DEFAULT '-',
  platform TEXT NOT NULL,
  qty INT NOT NULL CHECK (qty >= 0),
  priority INT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preplanned_streams (
  id SERIAL PRIMARY KEY,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_min INT NOT NULL,
  end_min INT NOT NULL,
  host_id INT REFERENCES hosts(id) ON DELETE SET NULL,
  brand_id INT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT '',
  sale TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS availability (
  host_id INT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  slot SMALLINT NOT NULL CHECK (slot BETWEEN 0 AND 6),
  PRIMARY KEY (host_id, date, slot)
);

CREATE TABLE IF NOT EXISTS availability_submissions (
  host_id INT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, month_id)
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id SERIAL PRIMARY KEY,
  month_id INT NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL DEFAULT '',
  stats JSONB NOT NULL DEFAULT '{}',
  sections JSONB NOT NULL DEFAULT '[]',
  warnings JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS scheduled_streams (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES schedule_runs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_min INT NOT NULL,
  end_min INT NOT NULL,
  host_id INT REFERENCES hosts(id) ON DELETE SET NULL,
  host_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL,
  period TEXT NOT NULL,
  sale TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  fixed BOOLEAN NOT NULL DEFAULT FALSE,
  auto_assigned_host BOOLEAN NOT NULL DEFAULT FALSE,
  edited BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS scheduled_streams_run_idx ON scheduled_streams(run_id);
CREATE INDEX IF NOT EXISTS scheduled_streams_host_idx ON scheduled_streams(host_id);

DO $$ BEGIN
  ALTER TABLE months ADD CONSTRAINT months_published_run_fk FOREIGN KEY (published_run_id) REFERENCES schedule_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
