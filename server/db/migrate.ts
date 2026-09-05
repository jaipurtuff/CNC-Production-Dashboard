import pg from 'pg';
import dotenv from 'dotenv';
import { runDatabaseMigrations } from './migrations.js';
import { PostgresPoolClient } from './index.js';

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
  const client = new PostgresPoolClient(databaseUrl.trim());

  try {
    const probe = await client.query('SELECT current_user, current_database(), version()');
    const { current_user, current_database } = probe.rows[0];
    console.log(`[Migration] Connected to PostgreSQL at ${displayTarget} (Database: "${current_database}", User: "${current_user}").`);

    await runDatabaseMigrations(client);

    console.log('================================================================');
    console.log(`[Migration] SUCCESS: PostgreSQL database "${current_database}" is fully migrated.`);
    console.log('================================================================');
  } catch (err: any) {
    console.error('[Migration Error] Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (client.close) {
      await client.close();
    }
  }
}

// Execute migration if invoked via CLI
if (process.argv[1] && process.argv[1].includes('migrate')) {
  runMigrations().catch(err => {
    console.error('[Migration Error]', err);
    process.exit(1);
  });
}
