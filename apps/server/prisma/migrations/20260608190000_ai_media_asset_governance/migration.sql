-- AI generated outputs are product assets, not raw URLs.
-- This migration gives generated media a durable MediaAsset identity so
-- operations can moderate/takedown assets and every user-facing read can
-- respect the same governance state.

CREATE TYPE "MediaAssetSource" AS ENUM (
  'user_upload',
  'ai_output',
  'imported',
  'system'
);

CREATE TYPE "MediaAssetModerationStatus" AS ENUM (
  'unreviewed',
  'approved',
  'flagged',
  'blocked'
);

ALTER TABLE "media_assets"
  ADD COLUMN "workspace_id" UUID,
  ADD COLUMN "source" "MediaAssetSource" NOT NULL DEFAULT 'imported',
  ADD COLUMN "moderation_status" "MediaAssetModerationStatus" NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN "moderation_reason" TEXT,
  ADD COLUMN "moderated_by_admin_id" VARCHAR(64),
  ADD COLUMN "moderated_at" TIMESTAMPTZ(6),
  ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_outputs"
  ADD COLUMN "asset_id" UUID;

ALTER TABLE "ai_outputs"
  ADD CONSTRAINT "ai_outputs_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_outputs_asset_idx"
  ON "ai_outputs" ("asset_id");

CREATE INDEX "media_assets_workspace_source_recent_idx"
  ON "media_assets" ("workspace_id", "source", "created_at" DESC);

CREATE INDEX "media_assets_source_moderation_idx"
  ON "media_assets" ("source", "moderation_status", "created_at" DESC);

-- Historical generated outputs did not record storage provider/bucket/region.
-- Preserve governance coverage by minting external_url MediaAssets for them.
-- New worker writes use first-class storage identity.
INSERT INTO "media_assets" (
  "id",
  "kind",
  "storage_provider",
  "external_url",
  "content_type",
  "size_bytes",
  "width",
  "height",
  "duration_seconds",
  "visibility",
  "status",
  "source",
  "moderation_status",
  "workspace_id",
  "created_by_user_id",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (o."url")
  gen_random_uuid(),
  CASE
    WHEN o."type" = 'video' THEN 'video'::"MediaAssetKind"
    ELSE 'image'::"MediaAssetKind"
  END,
  'external_url'::"MediaStorageProvider",
  o."url",
  COALESCE(o."mime_type", 'application/octet-stream'),
  CASE WHEN o."bytes" IS NULL THEN NULL ELSE o."bytes"::BIGINT END,
  o."width",
  o."height",
  o."duration_seconds",
  'private'::"MediaAssetVisibility",
  'ready'::"MediaAssetStatus",
  'ai_output'::"MediaAssetSource",
  'unreviewed'::"MediaAssetModerationStatus",
  j."workspace_id",
  j."user_id",
  jsonb_build_object(
    'aiJobId', j."id",
    'aiOutputId', o."id",
    'provider', j."provider",
    'modelId', j."model_id",
    'deployment', j."deployment",
    'outputIndex', o."output_index",
    'backfilled', true
  ),
  o."created_at",
  NOW()
FROM "ai_outputs" o
JOIN "ai_jobs" j ON j."id" = o."job_id"
WHERE o."url" IS NOT NULL
  AND btrim(o."url") <> ''
ON CONFLICT DO NOTHING;

UPDATE "ai_outputs" o
SET "asset_id" = asset."id"
FROM "media_assets" asset
WHERE o."asset_id" IS NULL
  AND asset."storage_provider" = 'external_url'
  AND asset."external_url" = o."url"
  AND asset."deleted_at" IS NULL;
