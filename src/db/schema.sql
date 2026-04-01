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

-- DM Sessions (conversations)
CREATE TABLE IF NOT EXISTS dm_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active, stopped, executed, waiting, processing
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  executed_at INTEGER,
  locked_by TEXT,       -- Worker ID that claimed the session
  locked_at INTEGER     -- When the session was claimed
);

-- Session messages (conversation history)
CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- user, bot
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES dm_sessions(id) ON DELETE CASCADE
);

-- Incoming DMs (from allowed users) - legacy/non-session
CREATE TABLE IF NOT EXISTS incoming_dms (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0
);

-- Personality sessions (restricted user conversations)
CREATE TABLE IF NOT EXISTS personality_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  personality TEXT NOT NULL,
  date TEXT NOT NULL,                -- "2026-03-29" (UTC date)
  context TEXT DEFAULT '[]',         -- JSON array of messages
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  UNIQUE(user_id, personality, date)
);

-- Active personality tracking (for sticky sessions)
CREATE TABLE IF NOT EXISTS active_personality (
  user_id TEXT PRIMARY KEY,
  personality TEXT NOT NULL,
  started_at INTEGER NOT NULL
);

-- Restricted users (approved for limited access)
CREATE TABLE IF NOT EXISTS restricted_users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  approved_by TEXT NOT NULL        -- admin user_id who approved
);

-- Pending access requests
CREATE TABLE IF NOT EXISTS access_requests (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'    -- pending, approved, denied
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_api_key ON audit_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_dedup_created ON dedup_cache(created_at);
CREATE INDEX IF NOT EXISTS idx_incoming_dms_user ON incoming_dms(user_id);
CREATE INDEX IF NOT EXISTS idx_incoming_dms_timestamp ON incoming_dms(timestamp);
CREATE INDEX IF NOT EXISTS idx_dm_sessions_user ON dm_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_sessions_status ON dm_sessions(status);
CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_personality_sessions_user ON personality_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_personality_sessions_date ON personality_sessions(date);

-- ============================================
-- Personality Engine Tables (v3)
-- ============================================

-- Brain configurations (model + parameters)
CREATE TABLE IF NOT EXISTS brains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL,
  max_tokens INTEGER DEFAULT 1024,
  temperature REAL DEFAULT 1.0,
  top_p REAL,                              -- Nucleus sampling threshold
  top_k INTEGER,                           -- Top-K sampling limit
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Personality definitions
CREATE TABLE IF NOT EXISTS personalities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,               -- 'princess-donut'
  display_name TEXT NOT NULL,              -- 'Princess Donut'
  discord_token_env TEXT NOT NULL,         -- 'DONUT_DISCORD_TOKEN'
  brain_id TEXT NOT NULL,
  system_prompt TEXT NOT NULL,             -- Full prompt text
  greeting TEXT,                           -- Optional new session greeting
  error_response TEXT,                     -- Personality-flavored error
  is_admin INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (brain_id) REFERENCES brains(id)
);

-- Channel ACL with bot-to-bot settings
CREATE TABLE IF NOT EXISTS personality_channels (
  personality_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  guild_id TEXT,                           -- NULL = DM
  can_respond INTEGER DEFAULT 1,
  respond_to_mentions INTEGER DEFAULT 1,
  respond_to_all INTEGER DEFAULT 0,
  bot_response_chance REAL DEFAULT 0.3,    -- Chance to respond to other bots (0.0-1.0)
  bot_cooldown_seconds INTEGER DEFAULT 10, -- Cooldown after speaking
  last_response_at INTEGER,                -- Track cooldown per channel
  created_at INTEGER NOT NULL,
  PRIMARY KEY (personality_id, channel_id),
  FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE CASCADE
);

-- Rate limits per user per personality (stubbed)
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  personality_id TEXT NOT NULL,
  requests_today INTEGER DEFAULT 0,
  tokens_today INTEGER DEFAULT 0,
  last_request_at INTEGER,
  reset_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, personality_id)
);

-- Usage log for debugging + cost analysis
CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  personality_id TEXT NOT NULL,
  brain_id TEXT NOT NULL,
  channel_id TEXT,                         -- NULL = DM
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  success INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);

-- Personality Engine Indexes
CREATE INDEX IF NOT EXISTS idx_personality_channels_channel ON personality_channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_created ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_log_personality ON usage_log(personality_id);

-- Migrations (for existing databases)
-- Add locked_by and locked_at columns if they don't exist
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so these will fail silently on fresh dbs
