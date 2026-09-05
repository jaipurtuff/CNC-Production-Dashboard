import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { newDb } from 'pg-mem';
import { normalizeSharePath } from '../collector/cncMonitor.js';
import { runDatabaseMigrations } from './migrations.js';

dotenv.config();

const { Pool } = pg;

export interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number | null;
}

export interface IDbClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close?(): Promise<void>;
  isPostgresServer: boolean;
}

export class PostgresPoolClient implements IDbClient {
  private pool: pg.Pool;
  public isPostgresServer = true;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class MemoryPoolClient implements IDbClient {
  private pool: any;
  public isPostgresServer = false;

  constructor() {
    const mem = newDb();
    mem.public.registerFunction({
      name: 'version',
      implementation: () => 'PostgreSQL 14.0 (pg-mem in-memory fallback engine)',
    });
    mem.public.registerFunction({
      name: 'current_user',
      implementation: () => 'cnc_user',
    });
    mem.public.registerFunction({
      name: 'current_database',
      implementation: () => 'cnc_dashboard',
    });

    const { Pool: MemPool } = mem.adapters.createPg();
    this.pool = new MemPool();
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let dbInstance: IDbClient | null = null;

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

export async function getDb(): Promise<IDbClient> {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.trim().length > 0) {
    const { displayTarget, sanitizedUrl } = formatPostgresTarget(databaseUrl.trim());
    console.log(`[DB] Attempting connection to PostgreSQL at ${displayTarget}...`);
    try {
      const pgClient = new PostgresPoolClient(databaseUrl.trim());
      // Fast probe to verify connection and credentials
      const probe = await pgClient.query('SELECT current_user, current_database(), version()');
      const { current_user, current_database } = probe.rows[0];
      console.log(`[DB] Connected to PostgreSQL at ${displayTarget} (Database: ${current_database}, User: ${current_user})`);
      await initSchema(pgClient);
      dbInstance = pgClient;
      return dbInstance;
    } catch (err: any) {
      console.warn(`[DB] External PostgreSQL unreachable at ${displayTarget} (${err.message}).`);
      console.warn(`[DB] Falling back to high-performance in-memory PostgreSQL engine (pg-mem).`);
    }
  } else {
    console.log(`[DB] No DATABASE_URL specified. Initializing in-memory PostgreSQL engine (pg-mem)...`);
  }

  const memClient = new MemoryPoolClient();
  await initSchema(memClient);
  await seedSampleProductionData(memClient);
  dbInstance = memClient;
  return dbInstance;
}

export async function createTestDb(): Promise<IDbClient> {
  const memClient = new MemoryPoolClient();
  await initSchema(memClient);
  return memClient;
}

async function initSchema(db: IDbClient) {
  // Run idempotent migrations ensuring tables, columns (including qta and cnt), and backfills are applied
  await runDatabaseMigrations(db);
}

async function seedSampleProductionData(db: IDbClient) {
  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // 1. Seed CNC Monitor State
  await db.query(`
    UPDATE cnc_monitor_state
    SET is_online = TRUE,
        last_reachable_at = CURRENT_TIMESTAMP,
        last_scan_at = CURRENT_TIMESTAMP,
        active_job_id = '18-08-2026-A-06MM_CLEAR------',
        current_sheet_index = 6,
        total_jobs_tracked = 4
    WHERE id = 1;
  `);

  // 2. Seed Jobs
  const jobs = [
    {
      job_id: '18-08-2026-A-06MM_CLEAR------',
      base_filename: '18-08-2026-A-06MM_CLEAR------',
      total_programmed_sheets: 10,
      sheet_width_mm: 3660,
      sheet_height_mm: 2770,
      sheet_thickness_mm: 6,
      material_code: 'F6',
      material: '6MM CLEAR FLOAT',
      customer_name: 'Lingel Windows & Doors',
      order_no: '26-27-T01995',
      planned_waste_pct: 12.40,
      filename_date: '18-08-2026',
      otd_date: 'Tue Sep 01 16:27:07 2026',
      fbt_last_write: '01-09-2026 16:27:07',
      status: 'ACTIVE',
    },
    {
      job_id: '25-08-2026-X-06MM_DSN-50--',
      base_filename: '25-08-2026-X-06MM_DSN-50--',
      total_programmed_sheets: 4,
      sheet_width_mm: 3660,
      sheet_height_mm: 2400,
      sheet_thickness_mm: 6,
      material_code: 'F6_DSN',
      material: '6MM DESIGN 50',
      customer_name: 'Fenesta Building Systems',
      order_no: '26-27-T02284',
      planned_waste_pct: 9.80,
      filename_date: '25-08-2026',
      otd_date: 'Tue Sep 01 14:15:00 2026',
      fbt_last_write: '01-09-2026 14:15:00',
      status: 'COMPLETED',
    },
    {
      job_id: '28-08-2026-B-08MM_EXTRA-CLR-',
      base_filename: '28-08-2026-B-08MM_EXTRA-CLR-',
      total_programmed_sheets: 6,
      sheet_width_mm: 3660,
      sheet_height_mm: 2440,
      sheet_thickness_mm: 8,
      material_code: 'F8_EXCLR',
      material: '8MM EXTRA CLEAR',
      customer_name: 'Aluplex Facades Ltd',
      order_no: '26-27-T02480',
      planned_waste_pct: 14.10,
      filename_date: '28-08-2026',
      otd_date: 'Wed Sep 02 09:40:00 2026',
      fbt_last_write: '02-09-2026 09:40:00',
      status: 'ACTIVE',
    },
    {
      job_id: '30-08-2026-C-10MM_TOUGHENED-',
      base_filename: '30-08-2026-C-10MM_TOUGHENED-',
      total_programmed_sheets: 8,
      sheet_width_mm: 3660,
      sheet_height_mm: 2770,
      sheet_thickness_mm: 10,
      material_code: 'F10_TGH',
      material: '10MM TOUGHENED CLEAR',
      customer_name: 'Saint-Gobain Glass',
      order_no: '26-27-T02511',
      planned_waste_pct: 8.50,
      filename_date: '30-08-2026',
      otd_date: 'Wed Sep 02 15:10:00 2026',
      fbt_last_write: '02-09-2026 15:10:00',
      status: 'ACTIVE',
    },
  ];

  for (const j of jobs) {
    await db.query(`
      INSERT INTO cnc_jobs (
        job_id, base_filename, total_programmed_sheets, sheet_width_mm, sheet_height_mm,
        sheet_thickness_mm, material_code, material, customer_name, order_no,
        planned_waste_pct, filename_date, otd_date, fbt_last_write, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (job_id) DO NOTHING;
    `, [
      j.job_id, j.base_filename, j.total_programmed_sheets, j.sheet_width_mm, j.sheet_height_mm,
      j.sheet_thickness_mm, j.material_code, j.material, j.customer_name, j.order_no,
      j.planned_waste_pct, j.filename_date, j.otd_date, j.fbt_last_write, j.status,
    ]);

    // Mother sheets
    for (let idx = 1; idx <= j.total_programmed_sheets; idx++) {
      const area = (j.sheet_width_mm / 1000) * (j.sheet_height_mm / 1000);
      const isCompleted = j.job_id === '25-08-2026-X-06MM_DSN-50--' || (j.job_id === '18-08-2026-A-06MM_CLEAR------' && idx <= 5) || (j.job_id === '28-08-2026-B-08MM_EXTRA-CLR-' && idx <= 3);
      await db.query(`
        INSERT INTO cnc_mother_sheets (
          job_id, sheet_index, sheet_code, width_mm, height_mm, thickness_mm,
          area_sqm, programmed_pieces, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (job_id, sheet_index) DO NOTHING;
      `, [
        j.job_id, idx, `${j.job_id}${idx}`, j.sheet_width_mm, j.sheet_height_mm, j.sheet_thickness_mm,
        area, 6, isCompleted ? 'COMPLETED' : 'PENDING',
      ]);
    }
  }

  // 3. Seed Production Events for Today & Yesterday
  const prodEvents = [
    // Today's events: Job 1 sheets 1..5
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 1, date: todayStr, pieces: 6, area: 10.1382, time: `${todayStr}T09:15:00.000Z` },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 2, date: todayStr, pieces: 6, area: 10.1382, time: `${todayStr}T09:48:00.000Z` },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 3, date: todayStr, pieces: 6, area: 10.1382, time: `${todayStr}T10:22:00.000Z` },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 4, date: todayStr, pieces: 6, area: 10.1382, time: `${todayStr}T11:05:00.000Z` },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 5, date: todayStr, pieces: 6, area: 10.1382, time: `${todayStr}T11:50:00.000Z` },
    // Today's events: Job 3 sheets 1..3
    { job_id: '28-08-2026-B-08MM_EXTRA-CLR-', sheet_index: 1, date: todayStr, pieces: 4, area: 8.9304, time: `${todayStr}T13:30:00.000Z` },
    { job_id: '28-08-2026-B-08MM_EXTRA-CLR-', sheet_index: 2, date: todayStr, pieces: 4, area: 8.9304, time: `${todayStr}T14:15:00.000Z` },
    { job_id: '28-08-2026-B-08MM_EXTRA-CLR-', sheet_index: 3, date: todayStr, pieces: 4, area: 8.9304, time: `${todayStr}T15:02:00.000Z` },
    // Yesterday's events: Job 2 sheets 1..4 (completed)
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 1, date: yesterdayStr, pieces: 8, area: 8.7840, time: `${yesterdayStr}T10:00:00.000Z` },
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 2, date: yesterdayStr, pieces: 8, area: 8.7840, time: `${yesterdayStr}T10:45:00.000Z` },
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 3, date: yesterdayStr, pieces: 8, area: 8.7840, time: `${yesterdayStr}T11:30:00.000Z` },
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 4, date: yesterdayStr, pieces: 8, area: 8.7840, time: `${yesterdayStr}T12:15:00.000Z` },
  ];

  for (const pe of prodEvents) {
    await db.query(`
      INSERT INTO production_events (
        job_id, sheet_index, event_type, event_timestamp, production_date,
        pieces_count, area_sqm, confidence
      ) VALUES ($1, $2, 'SHEET_COMPLETED', $3, $4, $5, $6, 'CONFIRMED')
      ON CONFLICT (job_id, sheet_index, event_type) DO NOTHING;
    `, [pe.job_id, pe.sheet_index, pe.time, pe.date, pe.pieces, pe.area]);
  }

  // 4. Seed CNC Pieces (for traceability and order link)
  const pieces = [
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 1, order_no: '26-27-T01995', pos_no: '101', customer_name: 'Lingel Windows & Doors', width: 1280, height: 640, area: 0.8192, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 1, order_no: '26-27-T01995', pos_no: '102', customer_name: 'Lingel Windows & Doors', width: 1450, height: 720, area: 1.0440, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 2, order_no: '26-27-T01995', pos_no: '103', customer_name: 'Lingel Windows & Doors', width: 950, height: 600, area: 0.5700, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 3, order_no: '26-27-T01995', pos_no: '104', customer_name: 'Lingel Windows & Doors', width: 1100, height: 550, area: 0.6050, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 4, order_no: '26-27-T01995', pos_no: '105', customer_name: 'Lingel Windows & Doors', width: 1600, height: 800, area: 1.2800, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 5, order_no: '26-27-T01995', pos_no: '106', customer_name: 'Lingel Windows & Doors', width: 1200, height: 700, area: 0.8400, status: 'CUT' },
    { job_id: '18-08-2026-A-06MM_CLEAR------', sheet_index: 6, order_no: '26-27-T01995', pos_no: '107', customer_name: 'Lingel Windows & Doors', width: 1300, height: 650, area: 0.8450, status: 'PENDING' },
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 1, order_no: '26-27-T02284', pos_no: '201', customer_name: 'Fenesta Building Systems', width: 1500, height: 750, area: 1.1250, status: 'CUT' },
    { job_id: '25-08-2026-X-06MM_DSN-50--', sheet_index: 2, order_no: '26-27-T02284', pos_no: '202', customer_name: 'Fenesta Building Systems', width: 1400, height: 700, area: 0.9800, status: 'CUT' },
    { job_id: '28-08-2026-B-08MM_EXTRA-CLR-', sheet_index: 1, order_no: '26-27-T02480', pos_no: '301', customer_name: 'Aluplex Facades Ltd', width: 1800, height: 900, area: 1.6200, status: 'CUT' },
    { job_id: '28-08-2026-B-08MM_EXTRA-CLR-', sheet_index: 2, order_no: '26-27-T02480', pos_no: '302', customer_name: 'Aluplex Facades Ltd', width: 1650, height: 850, area: 1.4025, status: 'CUT' },
  ];

  for (const p of pieces) {
    await db.query(`
      INSERT INTO cnc_pieces (
        job_id, sheet_index, piece_id, order_no, pos_no, customer_name,
        width_mm, height_mm, area_sqm, status, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      p.job_id, p.sheet_index, `${p.order_no}-${p.pos_no}`, p.order_no, p.pos_no,
      p.customer_name, p.width, p.height, p.area, p.status,
      p.status === 'CUT' ? CURRENT_TIMESTAMP() : null,
    ]);
  }

  // 5. Seed Orders (Google Sheets Master replica)
  const orders = [
    { work_order_no: '26-27-T01995', order_no: '0041', customer_name: 'Lingel Windows & Doors', pcs: 61 },
    { work_order_no: '26-27-T02284', order_no: '0042', customer_name: 'Fenesta Building Systems', pcs: 41 },
    { work_order_no: '26-27-T02480', order_no: '0043', customer_name: 'Aluplex Facades Ltd', pcs: 36 },
    { work_order_no: '26-27-T02511', order_no: '0044', customer_name: 'Saint-Gobain Glass', pcs: 48 },
    { work_order_no: '26-27-T02602', order_no: '0045', customer_name: 'Glass Wall Systems', pcs: 24 },
    { work_order_no: '26-27-T02715', order_no: '0046', customer_name: 'Schueco Architectural', pcs: 50 },
  ];

  for (const o of orders) {
    await db.query(`
      INSERT INTO orders (
        order_no, work_order_no, customer_name, total_required_pcs,
        total_cut_pcs, total_pending_pcs, overall_progress_pct, status, row_sha256
      ) VALUES ($1, $2, $3, $4, 0, $4, 0, 'PENDING', $5)
      ON CONFLICT (work_order_no) DO NOTHING;
    `, [o.order_no, o.work_order_no, o.customer_name, o.pcs, `seed_${o.work_order_no}`]);
  }

  // 6. Seed Order Sync State
  await db.query(`
    UPDATE order_sync_state
    SET last_sync_time = CURRENT_TIMESTAMP,
        rows_processed = 6,
        new_rows = 6,
        changed_rows = 0,
        unchanged_rows = 0,
        status = 'IDLE'
    WHERE id = 1;
  `);

  // 7. Seed System Events
  await db.query(`
    INSERT INTO system_events (event_type, job_id, message, details)
    VALUES
      ('CNC_ONLINE', NULL, 'CNC machine connection established on share \\\\192.168.11.211\\iso', 'Latency: 1.2ms'),
      ('SCAN_COMPLETE', '18-08-2026-A-06MM_CLEAR------', 'Scanned 18-08-2026-A-06MM_CLEAR------: 5 of 10 sheets completed', 'Active cutting'),
      ('GOOGLE_SYNC', NULL, 'Google Sheets order master synchronized 6 work orders', 'Range: Sheet1!A:E');
  `);
}

function CURRENT_TIMESTAMP(): string {
  return new Date().toISOString();
}

