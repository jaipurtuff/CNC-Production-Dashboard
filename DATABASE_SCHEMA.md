# PostgreSQL Database Schema & Architecture

The system uses standard PostgreSQL DDL executed directly against PostgreSQL via `DATABASE_URL` (with embedded fallback for local sandbox preview).

---

## Tables

### 1. `cnc_jobs`
Master registry for distinct CNC cutting programs.
- `job_id` (VARCHAR(128) PRIMARY KEY): Base filename without extension.
- `base_filename` (VARCHAR(256)): Clean name.
- `total_programmed_sheets` (INTEGER): Total mother sheets in program.
- `sheet_width_mm` (DECIMAL(10,2)): Mother sheet DimX.
- `sheet_height_mm` (DECIMAL(10,2)): Mother sheet DimY.
- `sheet_thickness_mm` (DECIMAL(10,2)): Thickness in mm.
- `material_code` (VARCHAR(64)): Glass type (e.g. F6).
- `customer_name` (VARCHAR(256)): Mapped customer.
- `order_no` (VARCHAR(128)): Work order number.
- `planned_waste_pct` (DECIMAL(5,2)): Nesting waste percentage.
- `filename_date` (VARCHAR(32)): Literal date in filename.
- `otd_date` (VARCHAR(64)): Raw timestamp from OTD header.
- `fbt_last_write` (VARCHAR(64)): FBT [LAST_WRITE] header.
- `status` (VARCHAR(32)): `ACTIVE`, `PAUSED`, or `COMPLETED`.

### 2. `mother_sheets`
Individual mother sheets programmed inside each job.
- `id` (SERIAL PRIMARY KEY)
- `job_id` (VARCHAR(128) REFERENCES `cnc_jobs`)
- `sheet_index` (INTEGER): 1-indexed sheet number.
- `sheet_code` (VARCHAR(128)): Unique per sheet.
- `width_mm`, `height_mm`, `thickness_mm`
- `area_sqm` (DECIMAL(10,4)): `(width_mm / 1000.0) * (height_mm / 1000.0)`
- `status` (VARCHAR(32)): `PENDING` or `COMPLETED`.
- `completed_at` (TIMESTAMPTZ)
- **Constraint**: `UNIQUE(job_id, sheet_index)`

### 3. `pieces`
Individual glass cut pieces on sheets.
- `id` (SERIAL PRIMARY KEY)
- `job_id` (VARCHAR(128) REFERENCES `cnc_jobs`)
- `mother_sheet_id` (INTEGER REFERENCES `mother_sheets`)
- `sheet_index` (INTEGER)
- `piece_id` (VARCHAR(64))
- `order_no` (VARCHAR(128))
- `customer_name` (VARCHAR(256))
- `width_mm`, `height_mm`, `area_sqm`
- `status` (VARCHAR(32)): `PENDING` or `CUT`.
- `completed_at` (TIMESTAMPTZ)

### 4. `production_events` (IMMUTABLE LOG)
Append-only log of sheet cut events.
- `event_id` (SERIAL PRIMARY KEY)
- `job_id` (VARCHAR(128) REFERENCES `cnc_jobs`)
- `sheet_index` (INTEGER)
- `event_type` (VARCHAR(32)): `SHEET_COMPLETED`
- `event_timestamp` (TIMESTAMPTZ): Physical detection time.
- `production_date` (DATE): Calendar date for daily reporting.
- `pieces_count` (INTEGER)
- `area_sqm` (DECIMAL(10,4))
- `fbt_last_write` (VARCHAR(64))
- `confidence` (VARCHAR(32)): `CONFIRMED` or `INFERRED`.
- **CRITICAL IDEMPOTENCY CONSTRAINT**:
  ```sql
  UNIQUE(job_id, sheet_index, event_type)
  ```
  Guarantees that repeated scans or job re-runs NEVER insert duplicate events.

### 5. `orders` (Production Work Orders Table)
Live production orders synchronized with Google Sheets Order Master.
- `id` (SERIAL PRIMARY KEY)
- `customer_id` (TEXT)
- `order_no` (TEXT): Ref/order code with preserved formatting
- `work_order_no` (TEXT UNIQUE NOT NULL): Canonical work order number (exact string, e.g. 26-27-T02216)
- `customer_name` (TEXT)
- `total_required_pcs` (INTEGER DEFAULT 0): Ordered pieces
- `total_cut_pcs` (INTEGER DEFAULT 0): Cut pieces count
- `total_pending_pcs` (INTEGER DEFAULT 0): Pending pieces count
- `overall_progress_pct` (NUMERIC(5,2) DEFAULT 0): Progress percentage
- `status` (TEXT DEFAULT 'PENDING')
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)
- `row_sha256` (TEXT): SHA-256 row fingerprint for idempotent change detection

### 6. `cnc_monitor_state` & `order_sync_state`
Singletons tracking active job pointer, scan timestamps, and Google Sheet sync progress.
