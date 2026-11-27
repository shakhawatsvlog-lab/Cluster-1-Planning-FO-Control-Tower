-- ============================================================================
-- Alex Apparels — Cluster 1 Planning & FO Control Tower (Cloudflare D1 Schema)
-- Apply locally:  npx wrangler d1 execute alex-control-tower-db --local --file=cloudflare/schema.sql
-- Apply remotely: npx wrangler d1 execute alex-control-tower-db --remote --file=cloudflare/schema.sql
-- ============================================================================

-- Primary workspace singleton document (records, meta, reminders, cuttingSheetSync, siteConfig, adminAuth)
CREATE TABLE IF NOT EXISTS workspace_state (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Rolling safety backups created before destructive workspace updates or restores
CREATE TABLE IF NOT EXISTS workspace_backups (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_backups_created
  ON workspace_backups (created_at DESC);

-- One-time 6-digit OTP verification state for Admin password changes
CREATE TABLE IF NOT EXISTS admin_otp (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  target_email TEXT NOT NULL
);

-- Persisted session revocation list so logout stays enforced across Worker isolates
CREATE TABLE IF NOT EXISTS revoked_sessions (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_exp
  ON revoked_sessions (expires_at);

-- Persistent login brute-force lockout state per client IP
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- Persistent sliding-window rate limit buckets
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
