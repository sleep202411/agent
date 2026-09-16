-- Realtime signal: compute credit landed and blocked Story generation
-- batches are now resumable. Notify-only; nothing auto-resumes.
ALTER TYPE "AiOutboxEventType" ADD VALUE 'story_generation_batches_resumable';
