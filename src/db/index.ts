import Database, { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DATABASE_PATH || './data/nws-discord.db';

// Ensure data directory exists
mkdirSync(dirname(dbPath), { recursive: true });

export const db: DatabaseType = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Run migrations for existing databases
function runMigrations() {
  // Add locked_by and locked_at columns to dm_sessions if they don't exist
  const columns = db.prepare(`PRAGMA table_info(dm_sessions)`).all() as { name: string }[];
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('locked_by')) {
    db.exec(`ALTER TABLE dm_sessions ADD COLUMN locked_by TEXT`);
  }
  if (!columnNames.includes('locked_at')) {
    db.exec(`ALTER TABLE dm_sessions ADD COLUMN locked_at INTEGER`);
  }
}
runMigrations();

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
