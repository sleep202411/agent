CREATE TYPE "StoryGenerationBatchStatus" AS ENUM (
  'awaiting_confirmation',
  'queued',
  'running',
  'completed',
  'partial_failed',
  'cancelled',
  'failed',
  'expired'
);

CREATE TYPE "StoryGenerationBatchItemStatus" AS ENUM (
  'awaiting_confirmation',
  'ready',
  'dispatching',
  'submitted',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE "story_generation_batches" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "story_chapter_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "status" "StoryGenerationBatchStatus" NOT NULL DEFAULT 'awaiting_confirmation',
  "source_surface" VARCHAR(64) NOT NULL DEFAULT 'story-studio-batch',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "quote_snapshot" JSONB NOT NULL,
  "total_points" INTEGER NOT NULL,
  "item_count" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "quote_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "last_dispatched_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_generation_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "story_generation_batch_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "status" "StoryGenerationBatchItemStatus" NOT NULL DEFAULT 'awaiting_confirmation',
  "target_kind" "StoryProductionGenerationTargetKind" NOT NULL,
  "target_id" UUID NOT NULL,
  "sequence_id" UUID,
  "target_version" INTEGER NOT NULL,
  "output_kind" "StoryProductionGenerationKind" NOT NULL,
  "model_id" VARCHAR(180) NOT NULL,
  "schema_version" VARCHAR(180) NOT NULL,
  "options" JSONB NOT NULL DEFAULT '{}',
  "quoted_points" INTEGER NOT NULL,
  "pricing_version" VARCHAR(180) NOT NULL,
  "generation_id" UUID,
  "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_dispatch_at" TIMESTAMPTZ(6),
  "lease_owner" VARCHAR(160),
  "lease_expires_at" TIMESTAMPTZ(6),
  "error" JSONB,
  "submitted_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "story_generation_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_generation_batches_actor_key_unique"
  ON "story_generation_batches"("story_chapter_id", "actor_user_id", "idempotency_key");
CREATE INDEX "story_generation_batches_fairness_idx"
  ON "story_generation_batches"("actor_user_id", "status", "last_dispatched_at", "created_at");
CREATE INDEX "story_generation_batches_chapter_recent_idx"
  ON "story_generation_batches"("story_project_id", "story_chapter_id", "created_at" DESC);
CREATE INDEX "story_generation_batches_expiry_idx"
  ON "story_generation_batches"("status", "quote_expires_at");

CREATE UNIQUE INDEX "story_generation_batch_items_generation_unique"
  ON "story_generation_batch_items"("generation_id");
CREATE UNIQUE INDEX "story_generation_batch_items_ordinal_unique"
  ON "story_generation_batch_items"("batch_id", "ordinal");
CREATE UNIQUE INDEX "story_generation_batch_items_target_unique"
  ON "story_generation_batch_items"("batch_id", "target_kind", "target_id");
CREATE INDEX "story_generation_batch_items_dispatch_idx"
  ON "story_generation_batch_items"("status", "next_dispatch_at", "lease_expires_at");
CREATE INDEX "story_generation_batch_items_batch_status_idx"
  ON "story_generation_batch_items"("batch_id", "status", "ordinal");

ALTER TABLE "story_generation_batches"
  ADD CONSTRAINT "story_generation_batches_project_fkey"
  FOREIGN KEY ("story_project_id", "workspace_id")
  REFERENCES "story_projects"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_generation_batches"
  ADD CONSTRAINT "story_generation_batches_chapter_fkey"
  FOREIGN KEY ("story_chapter_id", "story_project_id")
  REFERENCES "story_chapters"("id", "story_project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_generation_batch_items"
  ADD CONSTRAINT "story_generation_batch_items_batch_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "story_generation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_generation_batch_items"
  ADD CONSTRAINT "story_generation_batch_items_generation_fkey"
  FOREIGN KEY ("generation_id") REFERENCES "story_production_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "story_generation_batches"
  ADD CONSTRAINT "story_generation_batches_item_count_check" CHECK ("item_count" BETWEEN 1 AND 500),
  ADD CONSTRAINT "story_generation_batches_total_points_check" CHECK ("total_points" >= 0);
ALTER TABLE "story_generation_batch_items"
  ADD CONSTRAINT "story_generation_batch_items_ordinal_check" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "story_generation_batch_items_points_check" CHECK ("quoted_points" >= 0);
