import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

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

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(
      `[FATAL DATABASE ERROR] DATABASE_URL environment variable is missing.\n` +
      `The production application requires a direct PostgreSQL connection.\n` +
      `Expected format: DATABASE_URL=postgresql://cnc_user:<LOCAL_PASSWORD>@localhost:5432/cnc_dashboard\n` +
      `Please configure DATABASE_URL in your environment or .env file.`
    );
  }

  const { displayTarget, sanitizedUrl } = formatPostgresTarget(databaseUrl.trim());
  console.log(`[DB] Connecting to PostgreSQL at ${displayTarget}...`);
  const pgClient = new PostgresPoolClient(databaseUrl.trim());
  try {
    // Fast probe to verify connection and credentials
    const probe = await pgClient.query('SELECT current_user, current_database(), version()');
    const { current_user, current_database } = probe.rows[0];
    console.log(`[DB] Connected to PostgreSQL at ${displayTarget} (Database: ${current_database}, User: ${current_user})`);
    await initSchema(pgClient);
    dbInstance = pgClient;
    return dbInstance;
  } catch (err: any) {
    console.error(`[FATAL DATABASE ERROR] Could not connect to PostgreSQL at ${displayTarget}: ${err.message}`);
    console.error(`Connection target: ${sanitizedUrl}`);
    throw err;
  }
}

export async function createTestDb(): Promise<IDbClient> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(
      `[FATAL TEST ERROR] DATABASE_URL environment variable is required to run tests.\n` +
      `Expected format: DATABASE_URL=postgresql://cnc_user:<LOCAL_PASSWORD>@localhost:5432/cnc_dashboard\n` +
      `Please ensure PostgreSQL server is running and DATABASE_URL is set.`
    );
  }

  const client = new PostgresPoolClient(databaseUrl.trim());
  await client.query('SELECT 1 as probe');
  await initSchema(client);
  return client;
}

async function initSchema(db: IDbClient) {
  const schemaPath = path.resolve(process.cwd(), 'server/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  await db.exec(schemaSql);

  // Column migration for cnc_jobs.file_base_name
  await db.query(`ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS file_base_name TEXT;`);
  await db.query(`ALTER TABLE cnc_jobs ADD COLUMN IF NOT EXISTS base_filename TEXT;`);
  await db.query(`UPDATE cnc_jobs SET file_base_name = base_filename WHERE file_base_name IS NULL AND base_filename IS NOT NULL;`);
  await db.query(`UPDATE cnc_jobs SET base_filename = file_base_name WHERE base_filename IS NULL AND file_base_name IS NOT NULL;`);

  const defaultShare = process.env.CNC_SHARE_PATH || '\\\\192.168.11.211\\iso';

  // Initialize monitor state singleton
  await db.query(`
    INSERT INTO cnc_monitor_state (id, is_online, share_path, total_jobs_tracked)
    VALUES (1, FALSE, $1, 0)
    ON CONFLICT (id) DO UPDATE SET
      share_path = EXCLUDED.share_path;
  `, [defaultShare]);

  // Initialize order sync state singleton
  await db.query(`
    INSERT INTO order_sync_state (id, status, rows_processed)
    VALUES (1, 'IDLE', 0)
    ON CONFLICT (id) DO NOTHING;
  `);
}
