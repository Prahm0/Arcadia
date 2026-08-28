CREATE TABLE IF NOT EXISTS subject_contexts (
  subject_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  include_in_arcad INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subject_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  storage_key TEXT NOT NULL UNIQUE,
  text_excerpt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subject_contexts_user ON subject_contexts(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_subject_files_user_subject ON subject_files(user_id, subject_id, created_at);
PRAGMA optimize;
