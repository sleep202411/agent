ALTER TYPE "AiOutboxEventType" ADD VALUE IF NOT EXISTS 'media_asset_moderation_changed';

ALTER TABLE "ai_event_outbox" ALTER COLUMN "job_id" DROP NOT NULL;
