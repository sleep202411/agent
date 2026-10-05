-- Pax's review form allows ratings without a written comment.
-- Preserve the length cap and the separate immutable-response constraint.
ALTER TABLE crew_task_feedback DROP CONSTRAINT crew_task_feedback_comment_check;
ALTER TABLE crew_task_feedback ADD CONSTRAINT crew_task_feedback_comment_check
  CHECK (length(btrim(comment)) <= 2000);
