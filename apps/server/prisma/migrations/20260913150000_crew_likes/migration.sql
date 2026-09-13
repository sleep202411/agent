CREATE TABLE crew_likes (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX crew_likes_user_idx ON crew_likes(user_id);
