ALTER TABLE crew_task_feedback
  ADD COLUMN public_on_profile boolean NOT NULL DEFAULT false,
  ADD COLUMN score_milli integer,
  ADD COLUMN timeliness_score integer,
  ADD CONSTRAINT crew_task_feedback_score_range CHECK (score_milli BETWEEN 1000 AND 5000),
  ADD CONSTRAINT crew_task_feedback_timeliness_range CHECK (timeliness_score IN (3, 5)),
  ADD CONSTRAINT crew_task_feedback_public_score CHECK (NOT public_on_profile OR score_milli IS NOT NULL);
CREATE INDEX crew_task_feedback_public_page
  ON crew_task_feedback(subject_user_id, created_at DESC, id DESC)
  WHERE public_on_profile;
