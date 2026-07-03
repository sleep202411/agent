-- Character provider-mirror plane (design doc §1, P2 real-person track):
-- ModelArk asset-group / external-asset mirrors + liveness enrollment
-- sessions, and the character_media_updated realtime outbox event type.
-- Hand-written minimal migration per repo practice.

-- AlterEnum
ALTER TYPE "AiOutboxEventType" ADD VALUE 'character_media_updated';

-- CreateEnum
CREATE TYPE "AiProviderAssetGroupType" AS ENUM ('aigc', 'liveness_face');

-- CreateEnum
CREATE TYPE "AiProviderAssetGroupStatus" AS ENUM ('active', 'disabled', 'deleted');

-- CreateEnum
CREATE TYPE "AiProviderExternalAssetStatus" AS ENUM ('pending', 'processing', 'active', 'failed', 'disabled', 'deleted');

-- CreateEnum
CREATE TYPE "CharacterEnrollmentSessionStatus" AS ENUM ('pending', 'completed', 'failed', 'expired');

-- CreateTable
CREATE TABLE "ai_provider_asset_groups" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "external_group_id" VARCHAR(128) NOT NULL,
    "group_type" "AiProviderAssetGroupType" NOT NULL,
    "project_name" VARCHAR(64) NOT NULL,
    "status" "AiProviderAssetGroupStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_asset_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_external_assets" (
    "id" UUID NOT NULL,
    -- Nullable: a mirror survives its CharacterMedia deletion (SetNull) as a
    -- detached upstream-teardown ledger until the provider asset is deleted.
    "character_media_id" UUID,
    "provider_asset_group_id" UUID NOT NULL,
    "external_asset_id" VARCHAR(128),
    "status" "AiProviderExternalAssetStatus" NOT NULL DEFAULT 'pending',
    "status_reason" VARCHAR(64),
    "provider_response" JSONB,
    "last_synced_at" TIMESTAMPTZ(6),
    "processing_deadline" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_external_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_enrollment_sessions" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "byted_token_enc" TEXT,
    "status" "CharacterEnrollmentSessionStatus" NOT NULL DEFAULT 'pending',
    "status_reason" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_enrollment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_asset_groups_character_provider_unique" ON "ai_provider_asset_groups"("character_id", "provider");

-- CreateIndex
CREATE INDEX "ai_provider_asset_groups_external_idx" ON "ai_provider_asset_groups"("provider", "external_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_external_assets_media_group_unique" ON "ai_provider_external_assets"("character_media_id", "provider_asset_group_id");

-- CreateIndex
CREATE INDEX "ai_provider_external_assets_by_group_idx" ON "ai_provider_external_assets"("provider_asset_group_id", "status");

-- CreateIndex
CREATE INDEX "ai_provider_external_assets_staleness_idx" ON "ai_provider_external_assets"("status", "processing_deadline");

-- CreateIndex
CREATE INDEX "character_enrollment_sessions_by_character_idx" ON "character_enrollment_sessions"("character_id", "status");

-- CreateIndex
CREATE INDEX "character_enrollment_sessions_expiry_idx" ON "character_enrollment_sessions"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "ai_provider_asset_groups" ADD CONSTRAINT "ai_provider_asset_groups_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_external_assets" ADD CONSTRAINT "ai_provider_external_assets_character_media_id_fkey" FOREIGN KEY ("character_media_id") REFERENCES "character_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_external_assets" ADD CONSTRAINT "ai_provider_external_assets_provider_asset_group_id_fkey" FOREIGN KEY ("provider_asset_group_id") REFERENCES "ai_provider_asset_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_enrollment_sessions" ADD CONSTRAINT "character_enrollment_sessions_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
