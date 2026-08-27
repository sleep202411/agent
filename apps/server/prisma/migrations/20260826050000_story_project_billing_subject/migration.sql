CREATE TYPE "StoryProjectBillingMode" AS ENUM ('actor', 'account');

ALTER TABLE "story_projects"
  ADD COLUMN "billing_mode" "StoryProjectBillingMode" NOT NULL DEFAULT 'actor',
  ADD COLUMN "billing_account_id" UUID;

ALTER TABLE "ai_jobs"
  ADD COLUMN "billing_subject_type" "BillingSubjectType",
  ADD COLUMN "billing_subject_id" VARCHAR(64);

ALTER TABLE "story_generation_batches"
  ADD COLUMN "billing_subject_type" "BillingSubjectType",
  ADD COLUMN "billing_subject_id" VARCHAR(64);

-- Preserve existing personal-wallet balances without moving them. A batch is
-- actor-funded, so snapshot that actor's hidden personal-workspace wallet when
-- it exists; installations without one fall back to the user-owned wallet.
UPDATE "story_generation_batches" AS batch
SET
  "billing_subject_type" = 'workspace',
  "billing_subject_id" = personal."id"::text
FROM "workspaces" AS personal
WHERE personal."owner_user_id" = batch."actor_user_id"
  AND personal."type" = 'personal'
  AND personal."deleted_at" IS NULL;

UPDATE "story_generation_batches"
SET
  "billing_subject_type" = 'user',
  "billing_subject_id" = "actor_user_id"
WHERE "billing_subject_type" IS NULL;

ALTER TABLE "story_generation_batches"
  ALTER COLUMN "billing_subject_type" SET NOT NULL,
  ALTER COLUMN "billing_subject_id" SET NOT NULL;

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_billing_account_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "wallet_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "story_projects"
  ADD CONSTRAINT "story_projects_billing_mode_account_check" CHECK (
    ("billing_mode" = 'actor' AND "billing_account_id" IS NULL)
    OR
    ("billing_mode" = 'account' AND "billing_account_id" IS NOT NULL)
  );

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_billing_subject_pair_check" CHECK (
    ("billing_subject_type" IS NULL AND "billing_subject_id" IS NULL)
    OR
    ("billing_subject_type" IS NOT NULL AND "billing_subject_id" IS NOT NULL)
  );

CREATE INDEX "story_projects_billing_account_idx"
  ON "story_projects"("billing_account_id")
  WHERE "billing_account_id" IS NOT NULL;

CREATE INDEX "ai_jobs_billing_subject_recent_idx"
  ON "ai_jobs"("billing_subject_type", "billing_subject_id", "created_at" DESC);

CREATE INDEX "story_generation_batches_billing_subject_idx"
  ON "story_generation_batches"("billing_subject_type", "billing_subject_id", "created_at" DESC);

-- Existing Story projects intentionally remain actor-funded. Their current
-- personal/team balances are not moved; submission resolves and freezes the
-- actual legacy wallet identity onto each new AI job.
