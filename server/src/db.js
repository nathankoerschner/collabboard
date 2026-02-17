import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;

function parseBool(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolveSslConfig(connectionString) {
  const databaseSsl = parseBool(process.env.DATABASE_SSL);
  const sslNoVerify = parseBool(process.env.DATABASE_SSL_NO_VERIFY);
  const sslMode = (process.env.PGSSLMODE || '').trim().toLowerCase();

  if (databaseSsl === false || sslMode === 'disable') {
    return false;
  }

  const explicitSslMode = ['require', 'prefer', 'allow', 'verify-ca', 'verify-full', 'no-verify'];
  if (databaseSsl === true || explicitSslMode.includes(sslMode)) {
    const rejectUnauthorized = ['verify-ca', 'verify-full'].includes(sslMode) && sslNoVerify !== true;
    return { rejectUnauthorized };
  }

  // Default: use SSL for non-local databases (Railway, Supabase, etc).
  try {
    const hostname = new URL(connectionString).hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    return isLocal ? false : { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

export function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    const connectionString = process.env.DATABASE_URL;
    pool = new pg.Pool({
      connectionString,
      ssl: resolveSslConfig(connectionString),
    });
  }
  return pool;
}

export async function migrate() {
  const db = getPool();
  if (!db) {
    console.log('No DATABASE_URL set, skipping migrations');
    return;
  }

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  // Ensure migrations tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: applied } = await db.query('SELECT name FROM _migrations ORDER BY name');
  const appliedSet = new Set(applied.map(r => r.name));

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await db.query(sql);
    await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  }
}
