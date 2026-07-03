-- Real-person v2: account-level enrollment + per-project authorization grants
-- (docs/character-library-real-person-v2-project-grants.md). Hand-written to
-- carry the partial-active unique index and the no-FK consent scope column.

-- CreateEnum
CREATE TYPE "CharacterProjectGrantStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "CharacterCastingInviteStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'revoked');

-- AlterTable: bare denormalized project scope on the append-only ledger (NO FK).
ALTER TABLE "character_consent_records" ADD COLUMN "scope_project_id" UUID;

-- CreateTable
CREATE TABLE "character_project_grants" (
    "id" UUID NOT NULL,
    "character_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "granted_by_user_id" VARCHAR(64) NOT NULL,
    "status" "CharacterProjectGrantStatus" NOT NULL DEFAULT 'active',
    "consent_record_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_project_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_casting_invites" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "invited_by_user_id" VARCHAR(64) NOT NULL,
    "invitee_user_id" VARCHAR(64),
    "invitee_contact" VARCHAR(256),
    "token_hash" VARCHAR(128) NOT NULL,
    "status" "CharacterCastingInviteStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "character_casting_invites_pkey" PRIMARY KEY ("id")
);

-- Partial-active unique: at most ONE live grant per (character, project); a
-- re-grant after a per-project revoke is a NEW row (revoked rows accumulate as
-- history). Matches the repo convention (WorkspaceMember/StudioCharacter).
CREATE UNIQUE INDEX "character_project_grants_active_unique"
  ON "character_project_grants"("character_id", "project_id")
  WHERE "status" = 'active';

-- CreateIndex
CREATE INDEX "character_project_grants_by_project_idx" ON "character_project_grants"("project_id", "status");

-- CreateIndex
CREATE INDEX "character_project_grants_by_character_idx" ON "character_project_grants"("character_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "character_casting_invites_token_unique" ON "character_casting_invites"("token_hash");

-- CreateIndex
CREATE INDEX "character_casting_invites_by_project_idx" ON "character_casting_invites"("project_id", "status");

-- CreateIndex
CREATE INDEX "character_casting_invites_by_invitee_idx" ON "character_casting_invites"("invitee_user_id", "status");

-- AddForeignKey
ALTER TABLE "character_project_grants" ADD CONSTRAINT "character_project_grants_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "studio_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Restrict — project delete runs an audited grant teardown, never a silent cascade.
ALTER TABLE "character_project_grants" ADD CONSTRAINT "character_project_grants_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: the consent record that authorized the grant (Restrict — evidence outlives the grant).
ALTER TABLE "character_project_grants" ADD CONSTRAINT "character_project_grants_consent_record_id_fkey" FOREIGN KEY ("consent_record_id") REFERENCES "character_consent_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_casting_invites" ADD CONSTRAINT "character_casting_invites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "platform_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
