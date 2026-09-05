-- ============================================================
-- PostgreSQL Production Schema for CNC Monitoring System
-- Standard PostgreSQL 14+ Server Engine (DATABASE_URL)
-- ============================================================

CREATE TABLE IF NOT EXISTS cnc_jobs (
  job_id TEXT PRIMARY KEY,                       -- Normalized base filename (e.g. 18-08-2026-A-06MM_CLEAR------)
  base_filename TEXT NOT NULL,
  file_base_name TEXT,                          -- Compatibility alias column
  total_programmed_sheets INTEGER NOT NULL DEFAULT 0,
  total_layouts INTEGER NOT NULL DEFAULT 0,
  total_planned_sheets INTEGER NOT NULL DEFAULT 0,
  total_cut_sheets INTEGER NOT NULL DEFAULT 0,
  total_pending_sheets INTEGER NOT NULL DEFAULT 0,
  current_layout_index INTEGER,
  sheet_width_mm NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sheet_height_mm NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sheet_thickness_mm NUMERIC(10, 2) NOT NULL DEFAULT 0,
  material_code TEXT,
  material TEXT,
  customer_name TEXT,
  order_no TEXT,
  planned_waste_pct NUMERIC(5, 2),
  filename_date TEXT,
  otd_date TEXT,
  fbt_last_write TEXT,
  fbt_file_path TEXT,
  otd_file_path TEXT,
  cni_file_path TEXT,
  z01_file_path TEXT,
  opt_project_name TEXT,
  first_scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'ACTIVE'          -- ACTIVE, PAUSED, COMPLETED
);

CREATE TABLE IF NOT EXISTS cnc_job_files (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  file_type TEXT NOT NULL,                      -- FBT, OTD, CNI, Z01
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  file_mtime TIMESTAMPTZ,
  content_sha256 TEXT,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_stable BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(job_id, file_type)
);

CREATE TABLE IF NOT EXISTS cnc_mother_sheets (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  sheet_index INTEGER NOT NULL,                 -- 1-based sheet index / layout index
  layout_index INTEGER,
  sheet_code TEXT,
  width_mm NUMERIC(10, 2) NOT NULL,
  height_mm NUMERIC(10, 2) NOT NULL,
  thickness_mm NUMERIC(10, 2) NOT NULL,
  area_sqm NUMERIC(10, 4) NOT NULL,
  programmed_pieces INTEGER NOT NULL DEFAULT 0,
  qta INTEGER NOT NULL DEFAULT 1,
  cnt INTEGER NOT NULL DEFAULT 0,
  fbt_record_raw TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',       -- PENDING, IN_PROGRESS, COMPLETED
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  UNIQUE(job_id, sheet_index)
);

-- CONFIRMED FBT LAYOUTS (1 row per layout, e.g. 1..44)
CREATE TABLE IF NOT EXISTS cnc_layouts (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  layout_index INTEGER NOT NULL,                 -- 1-based layout index (1..44)
  layout_code TEXT NOT NULL,                     -- Cod (e.g. 04-09-2026-B-05MM_CLEAR-----21)
  dim_x NUMERIC(10, 2) NOT NULL,                 -- DimX raw sheet length mm
  dim_y NUMERIC(10, 2) NOT NULL,                 -- DimY raw sheet width mm
  thickness_mm NUMERIC(10, 2) NOT NULL,          -- Spes glass thickness mm
  area_sqm NUMERIC(10, 4) NOT NULL,              -- (dim_x/1000)*(dim_y/1000)
  qta INTEGER NOT NULL DEFAULT 1,                -- Qta = Total raw sheets required for this layout
  cnt INTEGER NOT NULL DEFAULT 0,                -- Cnt = Actual raw sheets cut for this layout
  raw_line TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',        -- PENDING, IN_PROGRESS, COMPLETED
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, layout_index)
);

CREATE TABLE IF NOT EXISTS cnc_pieces (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  sheet_index INTEGER NOT NULL,
  piece_id TEXT,
  order_no TEXT,
  wo_no TEXT,
  pos_no TEXT,
  customer_name TEXT,
  width_mm NUMERIC(10, 2),
  height_mm NUMERIC(10, 2),
  area_sqm NUMERIC(10, 4),
  rack_no TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',       -- PENDING, CUT
  completed_at TIMESTAMPTZ
);

-- IMMUTABLE PRODUCTION EVENTS (Append-only)
CREATE TABLE IF NOT EXISTS production_events (
  event_id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  sheet_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,                     -- SHEET_COMPLETED
  event_timestamp TIMESTAMPTZ NOT NULL,         -- Detection timestamp or confirmed cut timestamp
  production_date DATE NOT NULL,                -- YYYY-MM-DD grouping date
  pieces_count INTEGER NOT NULL DEFAULT 0,
  area_sqm NUMERIC(10, 4) NOT NULL DEFAULT 0,
  layout_index INTEGER,
  layout_cut_index INTEGER,
  fbt_raw_line TEXT,
  fbt_last_write TEXT,
  file_mtime TIMESTAMPTZ,
  confidence TEXT NOT NULL DEFAULT 'INFERRED',  -- CONFIRMED or INFERRED
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- IDEMPOTENCY: Exact same sheet completion event cannot be recorded twice for the same job
  UNIQUE(job_id, sheet_index, event_type)
);

CREATE TABLE IF NOT EXISTS cutting_sessions (
  session_id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cnc_jobs(job_id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  sheets_cut INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'         -- ACTIVE, PAUSED, ENDED
);

-- Google Sheet Order Master (Read-Only replica)
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_id TEXT,
  order_no TEXT,
  work_order_no TEXT UNIQUE NOT NULL,           -- Exact WO string (e.g. 26-27-T02216)
  customer_name TEXT,
  total_required_pcs INTEGER NOT NULL DEFAULT 0,
  total_cut_pcs INTEGER NOT NULL DEFAULT 0,
  total_pending_pcs INTEGER NOT NULL DEFAULT 0,
  overall_progress_pct NUMERIC(5, 2) DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS order_sync_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_sync_time TIMESTAMPTZ,
  sheet_fingerprint TEXT,
  rows_processed INTEGER NOT NULL DEFAULT 0,
  new_rows INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  unchanged_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'IDLE'           -- IDLE, SYNCING, ERROR
);

CREATE TABLE IF NOT EXISTS system_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,                     -- CNC_ONLINE, CNC_OFFLINE, SCAN_COMPLETE, JOB_RESUMED, ERROR, GOOGLE_SYNC
  job_id TEXT,
  message TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cnc_monitor_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  share_path TEXT NOT NULL,
  last_reachable_at TIMESTAMPTZ,
  last_scan_at TIMESTAMPTZ,
  active_job_id TEXT,
  current_sheet_index INTEGER,
  total_jobs_tracked INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_prod_events_date ON production_events(production_date);
CREATE INDEX IF NOT EXISTS idx_prod_events_job ON production_events(job_id);
CREATE INDEX IF NOT EXISTS idx_cnc_pieces_order ON cnc_pieces(order_no);
CREATE INDEX IF NOT EXISTS idx_cnc_pieces_job ON cnc_pieces(job_id, sheet_index);
CREATE INDEX IF NOT EXISTS idx_mother_sheets_job ON cnc_mother_sheets(job_id);
CREATE INDEX IF NOT EXISTS idx_cnc_layouts_job ON cnc_layouts(job_id);
