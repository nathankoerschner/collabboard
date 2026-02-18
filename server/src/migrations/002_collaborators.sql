ALTER TABLE boards ADD COLUMN IF NOT EXISTS link_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS board_collaborators (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'collaborator')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_collaborators_user_id ON board_collaborators(user_id);

-- Backfill: ensure every existing board has an owner row
INSERT INTO board_collaborators (board_id, user_id, role)
SELECT id, owner_id, 'owner' FROM boards
ON CONFLICT (board_id, user_id) DO NOTHING;
