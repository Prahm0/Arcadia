ALTER TABLE user_preferences ADD COLUMN theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'midnight'));
--> statement-breakpoint
ALTER TABLE study_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'focus' CHECK (mode IN ('focus', 'stopwatch', 'rest'));
--> statement-breakpoint
ALTER TABLE study_sessions ADD COLUMN client_id TEXT;
--> statement-breakpoint
ALTER TABLE study_sessions ADD COLUMN goal TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE study_sessions ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0);
--> statement-breakpoint
ALTER TABLE study_sessions ADD COLUMN distractions INTEGER NOT NULL DEFAULT 0 CHECK (distractions >= 0);
--> statement-breakpoint
UPDATE study_sessions SET duration_seconds = duration_minutes * 60 WHERE duration_seconds = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_client ON study_sessions(user_id, client_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  password_version INTEGER NOT NULL DEFAULT 1,
  email_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email_normalized ON accounts(email_normalized);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('register', 'reset_password', 'change_email')),
  user_id TEXT,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens(kind, email_normalized, expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id, expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key_hash, action)
);
--> statement-breakpoint
PRAGMA optimize;
