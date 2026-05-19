-- Crew schema hardening.
--
-- Existing production crew data can be reset, but this migration is still
-- written to be safe on a non-empty database where possible.

-- ─── Application compensation: replace CN-only expected_salary_cents ───

ALTER TABLE "crew_applications"
  ADD COLUMN "expected_compensation_amount" BIGINT,
  ADD COLUMN "expected_compensation_currency" VARCHAR(3),
  ADD COLUMN "expected_compensation_period" VARCHAR(16);

UPDATE "crew_applications"
SET
  "expected_compensation_amount" = "expected_salary_cents",
  "expected_compensation_currency" = CASE
    WHEN "expected_salary_cents" IS NULL THEN NULL
    ELSE 'CNY'
  END
WHERE "expected_salary_cents" IS NOT NULL;

ALTER TABLE "crew_applications"
  DROP CONSTRAINT IF EXISTS "chk_crew_applications_expected_salary_nonneg",
  DROP COLUMN IF EXISTS "expected_salary_cents";

ALTER TABLE "crew_applications"
  ADD CONSTRAINT "chk_crew_applications_expected_compensation_nonneg"
    CHECK ("expected_compensation_amount" IS NULL OR "expected_compensation_amount" >= 0),
  ADD CONSTRAINT "chk_crew_applications_expected_compensation_currency"
    CHECK (
      "expected_compensation_currency" IS NULL
      OR "expected_compensation_currency" IN
        ('CNY','USD','EUR','GBP','JPY','HKD','AUD','CAD','SGD')
    ),
  ADD CONSTRAINT "chk_crew_applications_expected_compensation_period"
    CHECK (
      "expected_compensation_period" IS NULL
      OR "expected_compensation_period" IN ('month','episode','project')
    ),
  ADD CONSTRAINT "chk_crew_applications_expected_compensation_needs_currency"
    CHECK (
      "expected_compensation_amount" IS NULL
      OR "expected_compensation_currency" IS NOT NULL
    );

-- ─── Composite FK targets and constraints ─────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS "crew_positions_id_crew_unique"
  ON "crew_positions"("id", "crew_id");

CREATE UNIQUE INDEX IF NOT EXISTS "episodes_id_crew_unique"
  ON "episodes"("id", "crew_id");

ALTER TABLE "crew_applications"
  DROP CONSTRAINT IF EXISTS "crew_applications_position_id_fkey";

ALTER TABLE "crew_applications"
  ADD CONSTRAINT "crew_applications_position_id_crew_id_fkey"
    FOREIGN KEY ("position_id", "crew_id")
    REFERENCES "crew_positions"("id", "crew_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "episode_assignments"
  DROP CONSTRAINT IF EXISTS "episode_assignments_episode_id_fkey";

ALTER TABLE "episode_assignments"
  ADD CONSTRAINT "episode_assignments_episode_id_crew_id_fkey"
    FOREIGN KEY ("episode_id", "crew_id")
    REFERENCES "episodes"("id", "crew_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

ALTER TABLE "episode_activities"
  DROP CONSTRAINT IF EXISTS "episode_activities_episode_id_fkey";

ALTER TABLE "episode_activities"
  ADD CONSTRAINT "episode_activities_episode_id_crew_id_fkey"
    FOREIGN KEY ("episode_id", "crew_id")
    REFERENCES "episodes"("id", "crew_id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- ─── AI generation hardening ─────────────────────────────────────────

DROP INDEX IF EXISTS "ai_jobs_idempotency_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "ai_jobs_idempotency_active_unique"
  ON "ai_jobs"("user_id", "model_id", "idempotency_key")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "ai_jobs_idempotency_lookup_idx"
  ON "ai_jobs"("user_id", "model_id", "idempotency_key");

ALTER TABLE "ai_provider_events"
  ADD COLUMN "event_fingerprint" TEXT;

UPDATE "ai_provider_events"
SET "event_fingerprint" = COALESCE("provider_event_id", "id")
WHERE "event_fingerprint" IS NULL;

ALTER TABLE "ai_provider_events"
  ALTER COLUMN "event_fingerprint" SET NOT NULL;

DROP INDEX IF EXISTS "ai_provider_events_provider_event_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_events_provider_fingerprint_unique"
  ON "ai_provider_events"("provider", "event_fingerprint");
