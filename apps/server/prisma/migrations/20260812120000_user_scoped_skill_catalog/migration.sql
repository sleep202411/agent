-- User-imported Skills remain private to their declared project or workspace.
-- Public catalog rows continue to be globally discoverable.

ALTER TABLE "skill_catalog_items"
  ADD COLUMN "workspace_id" UUID,
  ADD COLUMN "platform_project_id" UUID,
  ADD COLUMN "story_project_id" UUID,
  ADD COLUMN "created_by_user_id" VARCHAR(64);

ALTER TABLE "skill_catalog_items"
  ADD CONSTRAINT "skill_catalog_items_scope_chk" CHECK (
    (
      "visibility" = 'public'
      AND "platform_project_id" IS NULL
      AND "story_project_id" IS NULL
    )
    OR (
      "visibility" = 'unlisted'
      AND "workspace_id" IS NOT NULL
      AND "platform_project_id" IS NULL
      AND "story_project_id" IS NULL
      AND "created_by_user_id" IS NOT NULL
    )
    OR (
      "visibility" = 'private'
      AND "workspace_id" IS NOT NULL
      AND num_nonnulls("platform_project_id", "story_project_id") = 1
      AND "created_by_user_id" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "skill_catalog_items_workspace_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "skill_catalog_items_platform_fkey"
    FOREIGN KEY ("platform_project_id", "workspace_id")
    REFERENCES "platform_projects"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "skill_catalog_items_story_fkey"
    FOREIGN KEY ("story_project_id", "workspace_id")
    REFERENCES "story_projects"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "skill_catalog_workspace_scope_idx"
  ON "skill_catalog_items"("workspace_id", "visibility", "status", "updated_at" DESC);
CREATE INDEX "skill_catalog_platform_scope_idx"
  ON "skill_catalog_items"("platform_project_id", "status", "updated_at" DESC);
CREATE INDEX "skill_catalog_story_scope_idx"
  ON "skill_catalog_items"("story_project_id", "status", "updated_at" DESC);
