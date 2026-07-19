-- Resolve the canonical grouped-Undo data head without scanning a project's
-- unbounded terminal run history.
CREATE INDEX "story_agent_runs_undo_head_idx"
  ON "story_agent_runs" (
    "story_project_id",
    "kind",
    "status",
    "result_draft_revision",
    "result_layout_revision",
    "completed_at" DESC,
    "id" DESC
  );
