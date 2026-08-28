CREATE TABLE IF NOT EXISTS companion_profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Arcad' CHECK (length(name) BETWEEN 1 AND 40),
  form TEXT NOT NULL DEFAULT 'orb' CHECK (form IN ('orb', 'comet', 'nebula')),
  palette TEXT NOT NULL DEFAULT 'violet' CHECK (palette IN ('violet', 'aqua', 'coral', 'gold')),
  accessory TEXT NOT NULL DEFAULT 'ring' CHECK (accessory IN ('none', 'ring', 'star', 'book', 'headphones')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_companion_profiles_updated ON companion_profiles(updated_at);
