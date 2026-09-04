ALTER TABLE user_preferences ADD COLUMN navigation_layout TEXT NOT NULL DEFAULT 'sidebar' CHECK (navigation_layout IN ('sidebar', 'topbar'));
--> statement-breakpoint
ALTER TABLE user_preferences ADD COLUMN sidebar_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (sidebar_collapsed IN (0, 1));
