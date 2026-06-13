-- Media asset platform hardening:
--   * variants represent original/thumbnail/poster/transcode/stream outputs;
--   * placements represent concrete provider objects across Azure, OSS, S3, CDN;
--   * moderation cases/actions provide an auditable global takedown surface.
--
-- Existing media_assets columns remain as the compatibility read path. New
-- writes can start recording an `original` variant + primary placement without
-- requiring a blocking historical backfill.

CREATE TYPE "MediaAssetVariantKind" AS ENUM (
  'original',
  'thumbnail',
  'poster',
  'preview',
  'stream',
  'transcode',
  'waveform',
  'transcript',
  'other'
);

CREATE TYPE "MediaAssetVariantStatus" AS ENUM (
  'pending',
  'processing',
  'ready',
  'failed',
  'blocked',
  'deleted'
);

CREATE TYPE "MediaObjectPlacementRole" AS ENUM (
  'primary',
  'replica',
  'cache',
  'archive'
);

CREATE TYPE "MediaObjectPlacementStatus" AS ENUM (
  'active',
  'warming',
  'failed',
  'purging',
  'purged',
  'deleted'
);

CREATE TYPE "MediaModerationCaseStatus" AS ENUM (
  'open',
  'actioned',
  'dismissed',
  'escalated',
  'closed'
);

CREATE TYPE "MediaModerationSeverity" AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE "MediaModerationActionType" AS ENUM (
  'approve',
  'flag',
  'block',
  'unblock',
  'takedown',
  'restore',
  'restrict_visibility',
  'purge_cdn',
  'delete_object'
);

CREATE TYPE "MediaModerationActionStatus" AS ENUM (
  'pending',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "MediaAssetUsageSurface" AS ENUM (
  'standalone_generation',
  'canvas',
  'project',
  'ip_library',
  'certificate',
  'admin',
  'system'
);

CREATE TYPE "MediaAssetUsageRole" AS ENUM (
  'output',
  'reference',
  'cover',
  'thumbnail',
  'trailer',
  'evidence',
  'avatar',
  'attachment',
  'other'
);

CREATE TABLE "media_asset_variants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "variant_key" VARCHAR(80) NOT NULL,
  "kind" "MediaAssetVariantKind" NOT NULL,
  "status" "MediaAssetVariantStatus" NOT NULL DEFAULT 'pending',
  "content_type" VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "duration_seconds" INTEGER,
  "checksum_sha256" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "media_asset_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_asset_variants_key_nonempty"
    CHECK (btrim("variant_key") <> ''),
  CONSTRAINT "media_asset_variants_dimensions_nonnegative"
    CHECK (
      ("width" IS NULL OR "width" > 0)
      AND ("height" IS NULL OR "height" > 0)
      AND ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
      AND ("size_bytes" IS NULL OR "size_bytes" >= 0)
    )
);

ALTER TABLE "media_asset_variants"
  ADD CONSTRAINT "media_asset_variants_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "media_asset_variants_asset_key_unique"
  ON "media_asset_variants" ("asset_id", "variant_key");
CREATE INDEX "media_asset_variants_asset_kind_status_idx"
  ON "media_asset_variants" ("asset_id", "kind", "status");
CREATE INDEX "media_asset_variants_kind_status_recent_idx"
  ON "media_asset_variants" ("kind", "status", "created_at" DESC);

CREATE TABLE "media_asset_usages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "variant_id" UUID,
  "user_id" VARCHAR(64),
  "workspace_id" UUID,
  "project_id" UUID,
  "ai_job_id" UUID,
  "ai_job_output_id" TEXT,
  "surface" "MediaAssetUsageSurface" NOT NULL,
  "source_surface" VARCHAR(64),
  "role" "MediaAssetUsageRole" NOT NULL,
  "idempotency_key" VARCHAR(180),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "media_asset_usages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "media_asset_usages"
  ADD CONSTRAINT "media_asset_usages_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "media_asset_usages_variant_fk"
    FOREIGN KEY ("variant_id") REFERENCES "media_asset_variants"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "media_asset_usages_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "media_asset_usages_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "media_asset_usages_ai_job_fk"
    FOREIGN KEY ("ai_job_id") REFERENCES "ai_jobs"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "media_asset_usages_ai_output_fk"
    FOREIGN KEY ("ai_job_output_id") REFERENCES "ai_outputs"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "media_asset_usages_idempotency_unique"
  ON "media_asset_usages" ("idempotency_key");
CREATE INDEX "media_asset_usages_asset_surface_idx"
  ON "media_asset_usages" ("asset_id", "surface", "role", "created_at" DESC);
CREATE INDEX "media_asset_usages_workspace_surface_idx"
  ON "media_asset_usages" ("workspace_id", "surface", "created_at" DESC);
CREATE INDEX "media_asset_usages_project_surface_idx"
  ON "media_asset_usages" ("project_id", "surface", "created_at" DESC);
CREATE INDEX "media_asset_usages_ai_job_idx"
  ON "media_asset_usages" ("ai_job_id", "role");
CREATE INDEX "media_asset_usages_ai_output_idx"
  ON "media_asset_usages" ("ai_job_output_id");
CREATE INDEX "media_asset_usages_deleted_idx"
  ON "media_asset_usages" ("deleted_at");

CREATE TABLE "media_object_placements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "variant_id" UUID,
  "role" "MediaObjectPlacementRole" NOT NULL DEFAULT 'primary',
  "status" "MediaObjectPlacementStatus" NOT NULL DEFAULT 'active',
  "storage_provider" "MediaStorageProvider" NOT NULL,
  "bucket" VARCHAR(128),
  "region" VARCHAR(64),
  "object_key" VARCHAR(1024),
  "external_url" VARCHAR(2048),
  "public_base_url" VARCHAR(512),
  "cdn_provider" VARCHAR(64),
  "cdn_cache_key" VARCHAR(1024),
  "priority" INTEGER NOT NULL DEFAULT 100,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "last_verified_at" TIMESTAMPTZ(6),
  "purged_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "media_object_placements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_object_placements_priority_nonnegative"
    CHECK ("priority" >= 0),
  CONSTRAINT "media_object_placements_storage_shape"
    CHECK (
      (
        "storage_provider" = 'external_url'
        AND "external_url" IS NOT NULL
      )
      OR (
        "storage_provider" <> 'external_url'
        AND "bucket" IS NOT NULL
        AND "object_key" IS NOT NULL
      )
    )
);

ALTER TABLE "media_object_placements"
  ADD CONSTRAINT "media_object_placements_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "media_object_placements_variant_fk"
    FOREIGN KEY ("variant_id") REFERENCES "media_asset_variants"("id") ON DELETE CASCADE;

CREATE INDEX "media_object_placements_asset_role_lookup_idx"
  ON "media_object_placements" ("asset_id", "role", "status", "priority");
CREATE INDEX "media_object_placements_variant_role_lookup_idx"
  ON "media_object_placements" ("variant_id", "role", "status", "priority");
CREATE UNIQUE INDEX "media_object_placements_variant_storage_unique"
  ON "media_object_placements" ("variant_id", "role", "storage_provider", "bucket", "object_key");
CREATE INDEX "media_object_placements_storage_lookup_idx"
  ON "media_object_placements" ("storage_provider", "bucket", "object_key");
CREATE INDEX "media_object_placements_status_updated_idx"
  ON "media_object_placements" ("status", "updated_at");

CREATE TABLE "media_moderation_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asset_id" UUID NOT NULL,
  "status" "MediaModerationCaseStatus" NOT NULL DEFAULT 'open',
  "severity" "MediaModerationSeverity" NOT NULL DEFAULT 'medium',
  "reason_code" VARCHAR(80) NOT NULL,
  "reason" TEXT,
  "reporter_user_id" VARCHAR(64),
  "opened_by_admin_id" VARCHAR(64),
  "assigned_admin_id" VARCHAR(64),
  "resolution_summary" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "media_moderation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_moderation_cases_reason_code_nonempty"
    CHECK (btrim("reason_code") <> ''),
  CONSTRAINT "media_moderation_cases_resolution_order"
    CHECK ("resolved_at" IS NULL OR "resolved_at" >= "opened_at")
);

ALTER TABLE "media_moderation_cases"
  ADD CONSTRAINT "media_moderation_cases_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE;

CREATE INDEX "media_moderation_cases_asset_status_idx"
  ON "media_moderation_cases" ("asset_id", "status", "opened_at" DESC);
CREATE INDEX "media_moderation_cases_queue_idx"
  ON "media_moderation_cases" ("status", "severity", "opened_at" DESC);
CREATE INDEX "media_moderation_cases_reporter_idx"
  ON "media_moderation_cases" ("reporter_user_id", "opened_at" DESC);

CREATE TABLE "media_moderation_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID,
  "asset_id" UUID NOT NULL,
  "variant_id" UUID,
  "placement_id" UUID,
  "action_type" "MediaModerationActionType" NOT NULL,
  "status" "MediaModerationActionStatus" NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "actor_admin_id" VARCHAR(64),
  "idempotency_key" VARCHAR(180),
  "provider" VARCHAR(64),
  "provider_task_id" VARCHAR(180),
  "error_message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),

  CONSTRAINT "media_moderation_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_moderation_actions_terminal_time"
    CHECK (
      ("completed_at" IS NULL OR "failed_at" IS NULL)
      AND ("completed_at" IS NULL OR "completed_at" >= "created_at")
      AND ("failed_at" IS NULL OR "failed_at" >= "created_at")
    )
);

ALTER TABLE "media_moderation_actions"
  ADD CONSTRAINT "media_moderation_actions_case_fk"
    FOREIGN KEY ("case_id") REFERENCES "media_moderation_cases"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "media_moderation_actions_asset_fk"
    FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "media_moderation_actions_variant_fk"
    FOREIGN KEY ("variant_id") REFERENCES "media_asset_variants"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "media_moderation_actions_placement_fk"
    FOREIGN KEY ("placement_id") REFERENCES "media_object_placements"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "media_moderation_actions_idempotency_unique"
  ON "media_moderation_actions" ("idempotency_key");
CREATE INDEX "media_moderation_actions_asset_recent_idx"
  ON "media_moderation_actions" ("asset_id", "created_at" DESC);
CREATE INDEX "media_moderation_actions_case_recent_idx"
  ON "media_moderation_actions" ("case_id", "created_at" DESC);
CREATE INDEX "media_moderation_actions_status_type_idx"
  ON "media_moderation_actions" ("status", "action_type", "created_at");
CREATE INDEX "media_moderation_actions_placement_idx"
  ON "media_moderation_actions" ("placement_id", "action_type", "status");
