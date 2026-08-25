-- AlterTable
ALTER TABLE "crew_positions" ADD COLUMN     "moderation_status" "CrewModerationStatus" NOT NULL DEFAULT 'ok',
ADD COLUMN     "moderated_at" TIMESTAMPTZ(6),
ADD COLUMN     "moderated_by_admin_id" UUID,
ADD COLUMN     "moderation_reason" VARCHAR(500);

-- CreateIndex
CREATE INDEX "crew_positions_moderation_idx" ON "crew_positions"("moderation_status", "created_at" DESC);
