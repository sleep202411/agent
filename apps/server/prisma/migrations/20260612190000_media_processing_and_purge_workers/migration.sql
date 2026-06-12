-- Reliable media operations:
--   * moderation actions become retryable worker tasks (lock/retry/DLQ);
--   * media_processing_jobs becomes the canonical queue for thumbnails,
--     transcodes, metadata probes, moderation scans, and historical backfills.

CREATE TYPE "MediaProcessingJobType" AS ENUM (
  'thumbnail',
  'poster',
  'transcode',
  'hls_stream',
  'waveform',
  'metadata_probe',
  'moderation_scan',
  'backfill_original_placement'
);

CREATE TYPE "MediaProcessingJobStatus" AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'dead'
);

ALTER TABLE "media_moderation_actions"
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "locked_at" TIMESTAMPTZ(6),
  ADD COLUMN "locked_by" VARCHAR(128),
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "dead_at" TIMESTAMPTZ(6);

CREATE INDEX "media_moderation_actions_retry_idx"
  ON "media_moderation_actions" ("status", "action_type", "next_attempt_at");
CREATE INDEX "media_moderation_actions_lock_idx"
  ON "media_moderation_actions" ("locked_at");
CREATE INDEX "media_moderation_actions_dlq_idx"
  ON "media_moderation_actions" ("dead_at");

CREATE TABLE "media_processing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "source_variant_id" UUID,
  "job_type" "MediaProcessingJobType" NOT NULL,
  "status" "MediaProcessingJobStatus" NOT NULL DEFAULT 'pending',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 8,
  "idempotency_key" VARCHAR(180),
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB NOT NULL DEFAULT '{}',
  "error_message" TEXT,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(128),
  "next_attempt_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "dead_at" TIMESTAMPTZ(6),
  "created_by_admin_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "media_processing_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_processing_jobs_priority_nonnegative"
    CHECK ("priority" >= 0),
  CONSTRAINT "media_processing_jobs_attempt_nonnegative"
    CHECK ("attempt" >= 0 AND "max_attempts" > 0)
);

ALTER TABLE "media_processing_jobs"
  ADD CONSTRAINT "media_processing_jobs_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "media_processing_jobs_source_variant_fk"
    FOREIGN KEY ("source_variant_id") REFERENCES "media_asset_variants"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "media_processing_jobs_idempotency_unique"
  ON "media_processing_jobs" ("idempotency_key");
CREATE INDEX "media_processing_jobs_asset_type_status_idx"
  ON "media_processing_jobs" ("asset_id", "job_type", "status");
CREATE INDEX "media_processing_jobs_claim_idx"
  ON "media_processing_jobs" ("status", "next_attempt_at", "priority", "created_at");
CREATE INDEX "media_processing_jobs_lock_idx"
  ON "media_processing_jobs" ("locked_at");
CREATE INDEX "media_processing_jobs_dlq_idx"
  ON "media_processing_jobs" ("dead_at");
