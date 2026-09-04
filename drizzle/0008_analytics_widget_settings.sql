CREATE TABLE IF NOT EXISTS analytics_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analytics_settings_updated ON analytics_settings(updated_at);

PRAGMA optimize;
