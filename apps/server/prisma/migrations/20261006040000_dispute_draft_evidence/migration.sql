ALTER TABLE crew_dispute_attachments
  ALTER COLUMN dispute_id DROP NOT NULL,
  ADD COLUMN draft_task_id uuid REFERENCES crew_tasks(id) ON DELETE RESTRICT,
  ADD COLUMN draft_dispute_id uuid,
  ADD CONSTRAINT crew_dispute_attachment_scope_check CHECK (
    (dispute_id IS NOT NULL AND draft_task_id IS NULL AND draft_dispute_id IS NULL) OR
    (dispute_id IS NULL AND draft_task_id IS NOT NULL AND draft_dispute_id IS NOT NULL)
  );
CREATE INDEX crew_dispute_attachments_draft_scope_idx
  ON crew_dispute_attachments(draft_dispute_id, draft_task_id, uploader_user_id);
