-- Story clip uploads are durable, project-scoped sessions. Browsers write only
-- to a staging key; a worker verifies and promotes bytes to an immutable final
-- key before the MediaAsset becomes reusable.

BEGIN;

CREATE TYPE "StoryVideoUploadStatus" AS ENUM (
  'issued',
  'confirmed',
  'queued',
  'processing',
  'ready',
  'failed',
  'expired',
  'cancelled'
);

CREATE TABLE "story_video_upload_sessions" (
  "id" UUID NOT NULL,
  "story_project_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "status" "StoryVideoUploadStatus" NOT NULL DEFAULT 'issued',
  "storage_provider" "MediaStorageProvider" NOT NULL,
  "bucket" VARCHAR(128),
  "region" VARCHAR(64),
  "staging_object_key" VARCHAR(1024) NOT NULL,
  "final_object_key" VARCHAR(1024),
  "content_type" VARCHAR(128) NOT NULL,
  "declared_size_bytes" BIGINT NOT NULL,
  "actual_size_bytes" BIGINT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "reclaim_after" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "next_attempt_at" TIMESTAMPTZ(6),
  "lease_owner" VARCHAR(160),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "error_code" VARCHAR(128),
  "error_detail" TEXT,
  "confirmed_at" TIMESTAMPTZ(6),
  "queued_at" TIMESTAMPTZ(6),
  "processing_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "staging_reclaimed_at" TIMESTAMPTZ(6),
  "final_reclaimed_at" TIMESTAMPTZ(6),
  "final_reclaim_after" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "story_video_upload_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "story_video_upload_sessions_sizes_chk" CHECK (
    "declared_size_bytes" > 0 AND
    "declared_size_bytes" <= 536870912 AND
    ("actual_size_bytes" IS NULL OR "actual_size_bytes" = "declared_size_bytes")
  ),
  CONSTRAINT "story_video_upload_sessions_attempts_chk" CHECK (
    "attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"
  ),
  CONSTRAINT "story_video_upload_sessions_lease_chk" CHECK (
    (
      "lease_owner" IS NULL AND
      "lease_acquired_at" IS NULL AND
      "lease_expires_at" IS NULL
    ) OR (
      "lease_owner" IS NOT NULL AND
      btrim("lease_owner") <> '' AND
      "lease_acquired_at" IS NOT NULL AND
      "lease_expires_at" > "lease_acquired_at"
    )
  ),
  CONSTRAINT "story_video_upload_sessions_identity_chk" CHECK (
    btrim("created_by_user_id") <> '' AND
    btrim("staging_object_key") <> '' AND
    btrim("content_type") <> '' AND
    ("final_object_key" IS NULL OR btrim("final_object_key") <> '')
  )
);

CREATE UNIQUE INDEX "story_video_upload_sessions_media_asset_id_key"
  ON "story_video_upload_sessions"("media_asset_id");
CREATE UNIQUE INDEX "story_video_upload_sessions_staging_object_key_key"
  ON "story_video_upload_sessions"("staging_object_key");
CREATE INDEX "story_video_upload_sessions_user_active_idx"
  ON "story_video_upload_sessions"("created_by_user_id", "workspace_id", "status", "expires_at");
CREATE INDEX "story_video_upload_sessions_claim_idx"
  ON "story_video_upload_sessions"("status", "next_attempt_at", "lease_expires_at");
CREATE INDEX "story_video_upload_sessions_reclaim_idx"
  ON "story_video_upload_sessions"("status", "reclaim_after");
CREATE INDEX "story_video_upload_sessions_final_reclaim_idx"
  ON "story_video_upload_sessions"("status", "final_reclaim_after");
CREATE INDEX "story_video_upload_sessions_project_recent_idx"
  ON "story_video_upload_sessions"("story_project_id", "created_at" DESC);

ALTER TABLE "story_video_upload_sessions"
  ADD CONSTRAINT "story_video_upload_sessions_project_scope_fkey"
  FOREIGN KEY ("story_project_id", "workspace_id")
  REFERENCES "story_projects"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_video_upload_sessions"
  ADD CONSTRAINT "story_video_upload_sessions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_video_upload_sessions"
  ADD CONSTRAINT "story_video_upload_sessions_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
