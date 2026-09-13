CREATE TABLE ip_episode_feedback (
  episode_id UUID NOT NULL REFERENCES ip_episodes(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL,
  value SMALLINT NOT NULL CHECK (value IN (-1, 1)),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, user_id)
);
