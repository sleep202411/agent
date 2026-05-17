/*
  Warnings:

  - Changed the type of `status` on the `ai_attempts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `event_type` to the `ai_event_outbox` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `ai_jobs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `ai_jobs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stage` on the `ai_jobs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `type` on the `ai_outputs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `event_type` on the `ai_provider_events` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('CREATED', 'IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AiJobStage" AS ENUM ('created', 'queued', 'validating', 'calling_provider', 'provider_queued', 'generating', 'fetching_output', 'uploading_to_oss', 'completed', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "AiAttemptStatus" AS ENUM ('succeeded', 'failed', 'aborted');

-- CreateEnum
CREATE TYPE "AiProviderEventType" AS ENUM ('queue_update', 'started', 'completed', 'failed', 'unknown');

-- CreateEnum
CREATE TYPE "AiOutboxEventType" AS ENUM ('job_update');

-- DropIndex
DROP INDEX "ai_event_outbox_pending_idx";

-- AlterTable
ALTER TABLE "ai_attempts" DROP COLUMN "status",
ADD COLUMN     "status" "AiAttemptStatus" NOT NULL;

-- AlterTable
ALTER TABLE "ai_event_outbox" ADD COLUMN     "dead_at" TIMESTAMPTZ(6),
ADD COLUMN     "event_type" "AiOutboxEventType" NOT NULL,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "locked_at" TIMESTAMPTZ(6),
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "ai_jobs" DROP COLUMN "type",
ADD COLUMN     "type" "AiJobType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "AiJobStatus" NOT NULL,
DROP COLUMN "stage",
ADD COLUMN     "stage" "AiJobStage" NOT NULL;

-- AlterTable
ALTER TABLE "ai_outputs" DROP COLUMN "type",
ADD COLUMN     "type" "AiJobType" NOT NULL;

-- AlterTable
ALTER TABLE "ai_provider_events" DROP COLUMN "event_type",
ADD COLUMN     "event_type" "AiProviderEventType" NOT NULL;

-- CreateIndex
CREATE INDEX "ai_event_outbox_pending_idx" ON "ai_event_outbox"("dispatched_at", "dead_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ai_event_outbox_job_recent_idx" ON "ai_event_outbox"("job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_event_outbox_locked_idx" ON "ai_event_outbox"("locked_at");

-- CreateIndex
CREATE INDEX "ai_event_outbox_dead_idx" ON "ai_event_outbox"("dead_at");

-- CreateIndex
CREATE INDEX "ai_jobs_queue_claim_idx" ON "ai_jobs"("queue_name", "status", "queued_at");

-- CreateIndex
CREATE INDEX "ai_jobs_provider_job_id_idx" ON "ai_jobs"("provider", "provider_job_id");
