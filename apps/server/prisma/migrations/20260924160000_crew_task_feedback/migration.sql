CREATE TABLE crew_task_feedback (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES crew_tasks(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES crew_task_submissions(id) ON DELETE RESTRICT,
  author_user_id varchar(64) NOT NULL,
  subject_user_id varchar(64) NOT NULL,
  direction varchar(16) NOT NULL CHECK (direction IN ('creator', 'manager')),
  ratings jsonb NOT NULL,
  comment text NOT NULL CHECK (length(btrim(comment)) BETWEEN 3 AND 2000),
  response text CHECK (response IS NULL OR length(btrim(response)) BETWEEN 3 AND 2000),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_task_feedback_no_self CHECK (author_user_id <> subject_user_id),
  CONSTRAINT crew_task_feedback_once UNIQUE (task_id, author_user_id, subject_user_id)
);
CREATE INDEX crew_task_feedback_page ON crew_task_feedback(task_id, created_at DESC, id DESC);
