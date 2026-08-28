ALTER TABLE "story_generation_batches"
  ADD COLUMN "dispatch_mode" VARCHAR(16) NOT NULL DEFAULT 'parallel';

ALTER TABLE "story_generation_batches"
  ADD CONSTRAINT "story_generation_batches_dispatch_mode_check"
  CHECK ("dispatch_mode" IN ('parallel', 'sequential'));
