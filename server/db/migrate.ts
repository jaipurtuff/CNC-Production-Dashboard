import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

function formatPostgresTarget(rawUrl: string): { displayTarget: string; sanitizedUrl: string } {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host || 'localhost:5432';
    const db = parsed.pathname.replace(/^\//, '') || 'cnc_dashboard';
    const displayTarget = `${host}/${db}`;
    parsed.password = '****';
    return { displayTarget, sanitizedUrl: parsed.toString() };
  } catch {
    return {
      displayTarget: 'localhost:5432/cnc_dashboard',
      sanitizedUrl: rawUrl.replace(/:([^@/]+)@/, ':****@'),
    };
  }
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    console.error('================================================================');
    console.error('FATAL: DATABASE_URL environment variable is missing.');
    console.error('================================================================');
    console.error('The application requires a direct connection to a PostgreSQL database.');
    console.error('Example: DATABASE_URL=postgresql://cnc_user:<password>@localhost:5432/cnc_dashboard');
    console.error('Please configure DATABASE_URL in your .env or environment before migrating.');
    process.exit(1);
  }

  const { displayTarget } = formatPostgresTarget(databaseUrl.trim());
  console.log(`[Migration] Connecting to PostgreSQL at ${displayTarget}...`);
  const pool = new Pool({
    connectionString: databaseUrl.trim(),
    ssl: databaseUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const probe = await pool.query('SELECT current_user, current_database(), version()');
    const { current_user, current_database } = probe.rows[0];
    console.log(`[Migration] Connected to PostgreSQL at ${displayTarget} (Database: "${current_database}", User: "${current_user}").`);

    // 1. Run base schema
    const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schemaSql);
    console.log('[Migration] Base schema applied (tables and indexes created/verified).');

    // 2. Run column updates (idempotent ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
    const columnMigrations = [
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS file_base_name TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS base_filename TEXT;`,
      `UPDATE cnc_jobs SET file_base_name = base_filename WHERE file_base_name IS NULL AND base_filename IS NOT NULL;`,
      `UPDATE cnc_jobs SET base_filename = file_base_name WHERE base_filename IS NULL AND file_base_name IS NOT NULL;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS material TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS material_code TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS fbt_file_path TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS otd_file_path TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS cni_file_path TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS z01_file_path TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS opt_project_name TEXT;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS first_scanned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`,
      `ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`,
      `ALTER TABLE cnc_mother_sheets ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;`,
      `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS wo_no TEXT;`,
      `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS sheet_width_mm NUMERIC(10,2);`,
      `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS sheet_height_mm NUMERIC(10,2);`,
      `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS is_cut BOOLEAN DEFAULT FALSE;`,
      `ALTER TABLE cnc_pieces ADD COLUMN IF NOT EXISTS cut_at TIMESTAMPTZ;`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS sheet_code TEXT;`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS width_mm NUMERIC(10,2);`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS height_mm NUMERIC(10,2);`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS thickness_mm NUMERIC(10,2);`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS material TEXT;`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS cut_time TIMESTAMPTZ;`,
      `ALTER TABLE production_events ADD COLUMN IF NOT EXISTS event_date DATE;`,
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS row_sha256 TEXT;`,
    ];

    for (const statement of columnMigrations) {
      await pool.query(statement);
    }
    console.log('[Migration] Incremental column checks completed.');

    // 3. Initialize singleton states
    const defaultShare = process.env.CNC_SHARE_PATH || '\\\\192.168.11.211\\iso';
    await pool.query(`
      INSERT INTO cnc_monitor_state (id, is_online, share_path, total_jobs_tracked)
      VALUES (1, FALSE, $1, 0)
      ON CONFLICT (id) DO UPDATE SET share_path = EXCLUDED.share_path;
    `, [defaultShare]);

    await pool.query(`
      INSERT INTO order_sync_state (id, status, rows_processed)
      VALUES (1, 'IDLE', 0)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('[Migration] Singleton states verified.');

    console.log('================================================================');
    console.log(`[Migration] SUCCESS: PostgreSQL database "${current_database}" is fully migrated.`);
    console.log('================================================================');
  } catch (err: any) {
    console.error('[Migration Error] Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Execute migration if invoked via CLI
runMigrations();
