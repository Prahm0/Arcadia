CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('arcadia', 'google')),
  external_id TEXT,
  calendar_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('task', 'study', 'training', 'sleep', 'general')),
  subject TEXT,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
  editable INTEGER NOT NULL DEFAULT 1,
  recurrence TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'synced', 'pending', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT,
  subject TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS google_connections (
  user_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  arcadia_calendar_id TEXT,
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS google_calendars (
  user_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  title TEXT NOT NULL,
  color TEXT,
  access_role TEXT,
  sync_token TEXT,
  selected INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, calendar_id),
  FOREIGN KEY (user_id) REFERENCES google_connections(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'declined', 'expired')),
  summary TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  applied_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_user_start ON events(user_id, start_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_external ON events(user_id, calendar_id, external_id) WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_user_started ON study_sessions(user_id, started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON chat_messages(user_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_proposals_user_status ON proposals(user_id, status, created_at);
--> statement-breakpoint
PRAGMA optimize;
