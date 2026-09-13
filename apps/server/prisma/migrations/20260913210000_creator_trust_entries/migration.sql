CREATE TABLE crew_creator_trust_entries (
 submission_id UUID NOT NULL REFERENCES crew_task_submissions(id) ON DELETE RESTRICT,
 task_id UUID NOT NULL,
 user_id VARCHAR(64) NOT NULL,
 points INTEGER NOT NULL CHECK (points IN (200,-200)),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 PRIMARY KEY (task_id,user_id)
);
CREATE INDEX crew_creator_trust_user_idx ON crew_creator_trust_entries(user_id,created_at DESC);
