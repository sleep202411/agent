-- MediaAsset-level BytePlus private asset mirrors.
-- This makes canvas images first-class provider-checked assets without
-- wrapping every image in a StudioCharacter.

ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'media_provider_asset_updated';

CREATE TABLE "ai_provider_media_asset_groups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(64) NOT NULL,
  "external_group_id" VARCHAR(128) NOT NULL,
  "group_type" "AiProviderAssetGroupType" NOT NULL,
  "project_name" VARCHAR(64) NOT NULL,
  "status" "AiProviderAssetGroupStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_media_asset_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_provider_media_asset_mirrors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "media_asset_id" UUID NOT NULL,
  "provider_asset_group_id" UUID NOT NULL,
  "external_asset_id" VARCHAR(128),
  "status" "AiProviderExternalAssetStatus" NOT NULL DEFAULT 'pending',
  "status_reason" VARCHAR(64),
  "provider_response" JSONB,
  "last_synced_at" TIMESTAMPTZ(6),
  "processing_deadline" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_media_asset_mirrors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_media_asset_groups_provider_type_project_unique"
  ON "ai_provider_media_asset_groups" ("provider", "group_type", "project_name");

CREATE INDEX "ai_provider_media_asset_groups_external_idx"
  ON "ai_provider_media_asset_groups" ("provider", "external_group_id");

CREATE UNIQUE INDEX "ai_provider_media_asset_mirrors_media_group_unique"
  ON "ai_provider_media_asset_mirrors" ("media_asset_id", "provider_asset_group_id");

CREATE INDEX "ai_provider_media_asset_mirrors_media_status_idx"
  ON "ai_provider_media_asset_mirrors" ("media_asset_id", "status");

CREATE INDEX "ai_provider_media_asset_mirrors_by_group_idx"
  ON "ai_provider_media_asset_mirrors" ("provider_asset_group_id", "status");

CREATE INDEX "ai_provider_media_asset_mirrors_staleness_idx"
  ON "ai_provider_media_asset_mirrors" ("status", "processing_deadline");

ALTER TABLE "ai_provider_media_asset_mirrors"
  ADD CONSTRAINT "ai_provider_media_asset_mirrors_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_media_asset_mirrors"
  ADD CONSTRAINT "ai_provider_media_asset_mirrors_provider_asset_group_id_fkey"
  FOREIGN KEY ("provider_asset_group_id") REFERENCES "ai_provider_media_asset_groups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
