-- Agent apply and external release delivery share the permanent project
-- write-state row as their acceptance-order fence. This index keeps the
-- post-fence active-lease lookup bounded per project as receipt history grows.

CREATE INDEX "story_experience_draft_releases_project_lease_idx"
  ON "story_experience_draft_releases" (
    "story_project_id", "status", "lease_expires_at"
  );
