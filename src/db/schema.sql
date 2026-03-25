-- API keys with metadata
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rate_limit INTEGER DEFAULT 30,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  enabled INTEGER DEFAULT 1
);

-- Per-key channel permissions
CREATE TABLE IF NOT EXISTS channel_permissions (
  api_key_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  can_read INTEGER DEFAULT 1,
  can_write INTEGER DEFAULT 1,
  PRIMARY KEY (api_key_id, channel_id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT NOT NULL,
  action TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  timestamp INTEGER NOT NULL
);

-- Deduplication cache (namespaced per client)
CREATE TABLE IF NOT EXISTS dedup_cache (
  api_key_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (api_key_id, idempotency_key)
);

-- Incoming DMs (from allowed users)
CREATE TABLE IF NOT EXISTS incoming_dms (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key ON audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_dedup_created ON dedup_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_incoming_dms_user ON incoming_dms(user_id);
CREATE INDEX IF NOT EXISTS idx_incoming_dms_timestamp ON incoming_dms(timestamp);
