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

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
