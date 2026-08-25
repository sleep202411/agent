-- CreateEnum
CREATE TYPE "CrewModerationStatus" AS ENUM ('ok', 'taken_down');

-- AlterTable
ALTER TABLE "crews" ADD COLUMN     "moderation_status" "CrewModerationStatus" NOT NULL DEFAULT 'ok',
ADD COLUMN     "moderated_at" TIMESTAMPTZ(6),
ADD COLUMN     "moderated_by_admin_id" UUID,
ADD COLUMN     "moderation_reason" VARCHAR(500);

-- CreateIndex
CREATE INDEX "crews_moderation_idx" ON "crews"("moderation_status", "created_at" DESC);
