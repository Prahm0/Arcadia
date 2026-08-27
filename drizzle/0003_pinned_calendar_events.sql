ALTER TABLE events ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
PRAGMA optimize;
