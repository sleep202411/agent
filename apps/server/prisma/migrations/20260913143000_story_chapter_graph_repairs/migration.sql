CREATE TABLE "story_chapter_graph_repairs" (
    "id" UUID NOT NULL,
    "story_project_id" UUID NOT NULL,
    "trigger" VARCHAR(64) NOT NULL,
    "repair_fingerprint" VARCHAR(64) NOT NULL,
    "draft_revision_before" INTEGER NOT NULL,
    "draft_revision_after" INTEGER NOT NULL,
    "before_draft" JSONB NOT NULL,
    "repaired_draft" JSONB NOT NULL,
    "before_chapters" JSONB NOT NULL,
    "repaired_chapters" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "decisions" JSONB NOT NULL,
    "actor_user_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_chapter_graph_repairs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "story_chapter_graph_repairs_project_fkey"
      FOREIGN KEY ("story_project_id") REFERENCES "story_projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_chapter_graph_repairs_repair_fingerprint_key"
  ON "story_chapter_graph_repairs"("repair_fingerprint");
CREATE INDEX "story_chapter_graph_repairs_project_recent_idx"
  ON "story_chapter_graph_repairs"("story_project_id", "created_at" DESC);
