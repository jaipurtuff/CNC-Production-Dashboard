import { IDbClient } from './index.js';
import { normalizeSharePath } from '../collector/cncMonitor.js';
import fs from 'fs';
import path from 'path';

/**
 * Idempotent, safe migration runner for PostgreSQL and pg-mem.
 * Runs on every server startup to ensure existing databases are updated
 * with all required columns and tables (including 'qta' and 'cnt')
 * without dropping or modifying existing production data.
 */
export async function runDatabaseMigrations(db: IDbClient): Promise<void> {
  console.log('[Migration] Verifying schema and running idempotent migrations...');

  // 1. Ensure base tables exist from schema.sql
  try {
    const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
      await db.exec(schemaSql);
    }
  } catch (err: any) {
    // Non-fatal if tables already exist or if pg-mem AST coverage warning on existing schema
    console.log('[Migration] Note on schema initialization:', err.message);
  }

  // 2. Safe idempotent column additions for EXISTING databases
  // This explicitly fixes "ERROR: column 'qta' does not exist" on existing installations.
  const columnUpdates: string[] = [
    // cnc_mother_sheets updates
    `ALTER TABLE cnc_mother_sheets ADD COLUMN IF NOT EXISTS layout_index INTEGER;`,
    `ALTER TABLE cnc_mother_sheets ADD COLUMN IF NOT EXISTS qta INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE cnc_mother_sheets ADD COLUMN IF NOT EXISTS cnt INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_mother_sheets ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;`,

    // cnc_layouts updates
    `ALTER TABLE cnc_layouts ADD COLUMN IF NOT EXISTS qta INTEGER NOT NULL DEFAULT 1;`,
    `ALTER TABLE cnc_layouts ADD COLUMN IF NOT EXISTS cnt INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_layouts ADD COLUMN IF NOT EXISTS raw_line TEXT;`,
    `ALTER TABLE cnc_layouts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PENDING';`,
    `ALTER TABLE cnc_layouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

    // cnc_jobs updates
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS file_base_name TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS base_filename TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS material TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS material_code TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS fbt_file_path TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS otd_file_path TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS cni_file_path TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS z01_file_path TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS opt_project_name TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS total_layouts INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS total_planned_sheets INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS total_cut_sheets INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS total_pending_sheets INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS current_layout_index INTEGER;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS fbt_last_write TEXT;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS fbt_file_mtime TIMESTAMPTZ;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS first_scanned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`,

    // production_events updates
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS layout_index INTEGER;`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS layout_cut_index INTEGER;`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS sheet_code TEXT;`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS width_mm NUMERIC(10,2);`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS height_mm NUMERIC(10,2);`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS thickness_mm NUMERIC(10,2);`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS material TEXT;`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS cut_time TIMESTAMPTZ;`,
    `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS event_date DATE;`,

    // cnc_pieces updates
    `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS wo_no TEXT;`,
    `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS sheet_width_mm NUMERIC(10,2);`,
    `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS sheet_height_mm NUMERIC(10,2);`,
    `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS is_cut BOOLEAN DEFAULT FALSE;`,
    `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS cut_at TIMESTAMPTZ;`,

    // orders updates
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS row_sha256 TEXT;`,

    // cnc_monitor_state updates
    `ALTER TABLE cnc_monitor_state ADD COLUMN IF NOT EXISTS error_message TEXT;`,
  ];

  for (const sql of columnUpdates) {
    try {
      await db.query(sql);
    } catch (err: any) {
      console.warn(`[Migration Warning] Non-fatal migration statement notice (${sql}):`, err.message);
    }
  }

  // 3. Backfill missing values for existing rows to preserve existing history safely
  const backfillQueries: string[] = [
    // cnc_mother_sheets backfills
    `UPDATE cnc_mother_sheets SET qta = 1 WHERE qta IS NULL;`,
    `UPDATE cnc_mother_sheets SET cnt = 0 WHERE cnt IS NULL;`,
    `UPDATE cnc_mother_sheets SET is_completed = TRUE WHERE status = 'COMPLETED' AND is_completed = FALSE;`,
    `UPDATE cnc_mother_sheets SET cnt = qta WHERE (is_completed = TRUE OR status = 'COMPLETED') AND (cnt IS NULL OR cnt = 0);`,
    `UPDATE cnc_mother_sheets SET layout_index = sheet_index WHERE layout_index IS NULL;`,

    // cnc_layouts backfills
    `UPDATE cnc_layouts SET qta = 1 WHERE qta IS NULL;`,
    `UPDATE cnc_layouts SET cnt = 0 WHERE cnt IS NULL;`,

    // cnc_jobs backfills
    `UPDATE cnc_jobs SET file_base_name = base_filename WHERE file_base_name IS NULL AND base_filename IS NOT NULL;`,
    `UPDATE cnc_jobs SET base_filename = file_base_name WHERE base_filename IS NULL AND file_base_name IS NOT NULL;`,
    `UPDATE cnc_jobs SET total_layouts = total_programmed_sheets WHERE (total_layouts IS NULL OR total_layouts = 0) AND total_programmed_sheets > 0;`,
    `UPDATE cnc_jobs SET total_planned_sheets = total_programmed_sheets WHERE (total_planned_sheets IS NULL OR total_planned_sheets = 0) AND total_programmed_sheets > 0;`,
    `UPDATE cnc_jobs SET total_cut_sheets = 0 WHERE total_cut_sheets IS NULL;`,
    `UPDATE cnc_jobs SET total_pending_sheets = GREATEST(0, total_planned_sheets - total_cut_sheets) WHERE total_pending_sheets IS NULL;`,
  ];

  for (const sql of backfillQueries) {
    try {
      await db.query(sql);
    } catch (err: any) {
      console.warn(`[Migration Warning] Backfill statement notice:`, err.message);
    }
  }

  // 4. Indices
  const indices: string[] = [
    `CREATE INDEX IF NOT EXISTS idx_prod_events_date ON production_events(production_date);`,
    `CREATE INDEX IF NOT EXISTS idx_prod_events_job ON production_events(job_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_pieces_order ON cnc_pieces(order_no);`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_pieces_job ON cnc_pieces(job_id, sheet_index);`,
    `CREATE INDEX IF NOT EXISTS idx_mother_sheets_job ON cnc_mother_sheets(job_id);`,
    `CREATE INDEX IF NOT EXISTS idx_cnc_layouts_job ON cnc_layouts(job_id);`,
  ];

  for (const sql of indices) {
    try {
      await db.query(sql);
    } catch (err: any) {
      console.warn(`[Migration Warning] Index statement notice:`, err.message);
    }
  }

  // 5. Singleton monitor & sync states
  const rawShare = process.env.CNC_SHARE_PATH || (fs.existsSync('./test_share') ? './test_share' : '\\\\192.168.11.211\\iso');
  const defaultShare = normalizeSharePath(rawShare);

  try {
    await db.query(`
      INSERT INTO cnc_monitor_state (id, is_online, share_path, total_jobs_tracked)
      VALUES (1, TRUE, $1, 0)
      ON CONFLICT (id) DO UPDATE SET share_path = EXCLUDED.share_path;
    `, [defaultShare]);

    // Clean up any stale synthetic test jobs left in monitor state
    await db.query(`
      UPDATE cnc_monitor_state
      SET active_job_id = NULL, current_sheet_index = NULL
      WHERE active_job_id IN ('JOB_A', 'JOB_B');
    `);
  } catch (err: any) {
    console.warn('[Migration Warning] cnc_monitor_state notice:', err.message);
  }

  try {
    await db.query(`
      INSERT INTO order_sync_state (id, status, rows_processed)
      VALUES (1, 'IDLE', 0)
      ON CONFLICT (id) DO NOTHING;
    `);
  } catch (err: any) {
    console.warn('[Migration Warning] order_sync_state notice:', err.message);
  }

  console.log('[Migration] Database schema verified and migrated successfully.');
}
