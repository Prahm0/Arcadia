CREATE TABLE user_preferences_next (
  user_id TEXT PRIMARY KEY,
  bedtime TEXT NOT NULL DEFAULT '22:30',
  wake_time TEXT NOT NULL DEFAULT '06:30',
  minimum_sleep_minutes INTEGER NOT NULL DEFAULT 480 CHECK (minimum_sleep_minutes BETWEEN 360 AND 720),
  max_daily_study_minutes INTEGER NOT NULL DEFAULT 180 CHECK (max_daily_study_minutes BETWEEN 60 AND 480),
  preferred_session_minutes INTEGER NOT NULL DEFAULT 60 CHECK (preferred_session_minutes BETWEEN 25 AND 120),
  break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (break_minutes BETWEEN 5 AND 60),
  theme TEXT NOT NULL DEFAULT 'light' CHECK (length(theme) BETWEEN 1 AND 32),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO user_preferences_next (
  user_id, bedtime, wake_time, minimum_sleep_minutes, max_daily_study_minutes,
  preferred_session_minutes, break_minutes, theme, updated_at
)
SELECT user_id, bedtime, wake_time, minimum_sleep_minutes, max_daily_study_minutes,
  preferred_session_minutes, break_minutes, theme, updated_at
FROM user_preferences;
--> statement-breakpoint
DROP TABLE user_preferences;
--> statement-breakpoint
ALTER TABLE user_preferences_next RENAME TO user_preferences;
--> statement-breakpoint
PRAGMA optimize;
