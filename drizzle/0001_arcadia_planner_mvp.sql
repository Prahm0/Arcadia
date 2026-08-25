ALTER TABLE profiles ADD COLUMN grade TEXT;
--> statement-breakpoint
ALTER TABLE profiles ADD COLUMN onboarding_complete INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  title TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'homework' CHECK (task_type IN ('homework', 'assignment', 'exam', 'revision', 'project', 'other')),
  due_at TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
  remaining_minutes INTEGER NOT NULL CHECK (remaining_minutes >= 0),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'archived')),
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject_id TEXT,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('school', 'sport', 'extracurricular', 'other')),
  start_date TEXT,
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'weekly', 'weekdays')),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  bedtime TEXT NOT NULL DEFAULT '22:30',
  wake_time TEXT NOT NULL DEFAULT '06:30',
  minimum_sleep_minutes INTEGER NOT NULL DEFAULT 480 CHECK (minimum_sleep_minutes BETWEEN 360 AND 720),
  max_daily_study_minutes INTEGER NOT NULL DEFAULT 180 CHECK (max_daily_study_minutes BETWEEN 60 AND 480),
  preferred_session_minutes INTEGER NOT NULL DEFAULT 60 CHECK (preferred_session_minutes BETWEEN 25 AND 120),
  break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (break_minutes BETWEEN 5 AND 60),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE events ADD COLUMN task_id TEXT;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN commitment_id TEXT;
--> statement-breakpoint
ALTER TABLE events ADD COLUMN event_category TEXT NOT NULL DEFAULT 'other' CHECK (event_category IN ('school', 'study', 'sport', 'extracurricular', 'other', 'sleep'));
--> statement-breakpoint
ALTER TABLE events ADD COLUMN outcome TEXT NOT NULL DEFAULT 'planned' CHECK (outcome IN ('planned', 'completed', 'missed'));
--> statement-breakpoint
ALTER TABLE events ADD COLUMN occurrence_key TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_id TEXT,
  task_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'missed')),
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  occurred_at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_commitment_occurrence ON events(user_id, commitment_id, occurrence_key) WHERE commitment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_user_task ON events(user_id, task_id, start_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_user_name ON subjects(user_id, name COLLATE NOCASE);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, status, due_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_commitments_user_active ON commitments(user_id, active, recurrence);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_activity_user_occurred ON activity(user_id, occurred_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_event ON activity(user_id, event_id) WHERE event_id IS NOT NULL;
--> statement-breakpoint
PRAGMA optimize;
