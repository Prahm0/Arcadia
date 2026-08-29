CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

ALTER TABLE chat_messages ADD COLUMN conversation_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_user_activity ON chat_conversations(user_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON chat_messages(conversation_id, created_at);

-- Adopt any pre-existing messages into one conversation per user.
INSERT INTO chat_conversations (id, user_id, title, created_at, updated_at, last_message_at)
SELECT lower(hex(randomblob(16))), user_id, NULL, MIN(created_at), MAX(created_at), MAX(created_at)
FROM chat_messages
WHERE conversation_id IS NULL
GROUP BY user_id;

UPDATE chat_messages
SET conversation_id = (
  SELECT c.id FROM chat_conversations c
  WHERE c.user_id = chat_messages.user_id
  ORDER BY c.created_at ASC LIMIT 1
)
WHERE conversation_id IS NULL;

PRAGMA optimize;
