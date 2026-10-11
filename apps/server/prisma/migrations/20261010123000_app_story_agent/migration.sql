CREATE TABLE "app_story_runs" (
  "version" INTEGER NOT NULL DEFAULT 0,
  "id" UUID PRIMARY KEY,
  "project_id" UUID NOT NULL,
  "chapter_id" UUID NOT NULL,
  "actor_id" VARCHAR(64) NOT NULL,
  "submission_id" UUID NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "message" TEXT NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'queued',
  "phase" VARCHAR(24) NOT NULL DEFAULT 'planning',
  "model_config" JSONB NOT NULL,
  "document_id" UUID REFERENCES "copilot_documents"("id") ON DELETE RESTRICT,
  "plan" JSONB,
  "assistant_text" TEXT,
  "authorized_points" INTEGER NOT NULL,
  "committed_points" INTEGER NOT NULL DEFAULT 0,
  "required_points" INTEGER,
  "authoring_run_id" UUID,
  "batch_id" UUID,
  "result" JSONB,
  "error_code" VARCHAR(96),
  "error_detail" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "stage_attempt" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(160),
  "lease_expires_at" TIMESTAMPTZ(6),
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deadline_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (now() + interval '2 hours'),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "app_story_runs_status_check" CHECK ("status" IN ('queued','planning','producing','blocked','cancelling','completed','failed','cancelled')),
  CONSTRAINT "app_story_runs_points_check" CHECK ("authorized_points" >= 0 AND "committed_points" >= 0 AND "committed_points" <= "authorized_points"),
  CONSTRAINT "app_story_runs_chapter_scope_fkey" FOREIGN KEY ("chapter_id", "project_id") REFERENCES "story_chapters"("id", "story_project_id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "app_story_runs_project_id_actor_id_submission_id_key" ON "app_story_runs"("project_id","actor_id","submission_id");
CREATE UNIQUE INDEX "app_story_runs_active_project_key" ON "app_story_runs"("project_id") WHERE "status" IN ('queued','planning','producing','blocked','cancelling');
CREATE INDEX "app_story_runs_status_next_attempt_at_lease_expires_at_idx" ON "app_story_runs"("status","next_attempt_at","lease_expires_at");
CREATE INDEX "app_story_runs_project_id_actor_id_created_at_idx" ON "app_story_runs"("project_id","actor_id","created_at");
ALTER TABLE "story_agent_runs" ADD COLUMN "source_app_story_run_id" UUID;
ALTER TABLE "story_agent_runs" ADD CONSTRAINT "story_agent_runs_source_app_story_run_id_fkey" FOREIGN KEY ("source_app_story_run_id") REFERENCES "app_story_runs"("id") ON DELETE RESTRICT;
ALTER TABLE "story_agent_runs" ADD CONSTRAINT "story_agent_runs_source_product_check" CHECK ("source_app_story_run_id" IS NULL OR "source_agent_run_id" IS NULL);
CREATE INDEX "story_agent_runs_app_source_idx" ON "story_agent_runs"("source_app_story_run_id");
