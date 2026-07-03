-- CreateEnum
CREATE TYPE "CharacterKind" AS ENUM ('virtual', 'real_person');

-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('draft', 'pending_verification', 'active', 'disabled', 'revoked');

-- CreateEnum
CREATE TYPE "CharacterMediaStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "CharacterConsentRecordType" AS ENUM ('consent_granted', 'liveness_verification', 'revocation', 'admin_takedown');

-- CreateTable
CREATE TABLE "studio_characters" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "CharacterKind" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(200),
    "cover_asset_id" UUID,
    "status" "CharacterStatus" NOT NULL DEFAULT 'draft',
    "created_by_user_id" VARCHAR(64) NOT NULL,
    "subject_user_id" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "studio_characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_media" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "media_kind" "MediaAssetKind" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CharacterMediaStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_project_cast" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "added_by_user_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_project_cast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_consent_records" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "type" "CharacterConsentRecordType" NOT NULL,
    "provider" VARCHAR(64),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "consent_version" VARCHAR(32) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_characters_workspace_idx" ON "studio_characters"("workspace_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "studio_characters_created_by_idx" ON "studio_characters"("created_by_user_id");

-- CreateIndex
CREATE INDEX "character_media_by_character_idx" ON "character_media"("character_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "character_media_by_asset_idx" ON "character_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_media_unique" ON "character_media"("character_id", "media_asset_id");

-- CreateIndex
CREATE INDEX "character_project_cast_by_character_idx" ON "character_project_cast"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "character_project_cast_unique" ON "character_project_cast"("project_id", "character_id");

-- CreateIndex
CREATE INDEX "character_consents_by_character_idx" ON "character_consent_records"("character_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "studio_characters" ADD CONSTRAINT "studio_characters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_characters" ADD CONSTRAINT "studio_characters_cover_asset_id_fkey" FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_media" ADD CONSTRAINT "character_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_project_cast" ADD CONSTRAINT "character_project_cast_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_project_cast" ADD CONSTRAINT "character_project_cast_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_consent_records" ADD CONSTRAINT "character_consent_records_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added: live-name uniqueness per workspace (soft-deleted rows excluded),
-- promised by the StudioCharacter schema comment. @mention labels must be
-- unambiguous within a library.
-- Uniqueness domain = the LIVE library: exclude soft-deleted AND revoked
-- rows. A revoked real_person likeness is retained (append-only ledger /
-- 30-day dispute window) but must not squat its @mention name — the subject
-- can re-enroll under the same name.
CREATE UNIQUE INDEX "studio_characters_workspace_name_live_unique"
  ON "studio_characters"("workspace_id", "name")
  WHERE "deleted_at" IS NULL AND "status" <> 'revoked';
