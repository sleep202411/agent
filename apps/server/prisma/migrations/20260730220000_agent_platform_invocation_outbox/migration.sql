-- Turn invocation admission into a database-backed at-least-once outbox.
-- A gateway crash or ambiguous Agent API timeout can no longer strand a
-- published Ably input; another replica reclaims the lease and redelivers the
-- same stable invocation identity.

ALTER TABLE "agent_platform_invocations"
  ADD COLUMN "locale" VARCHAR(35) NOT NULL DEFAULT 'en-US',
  ADD COLUMN "next_admission_attempt_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "admission_lease_token" UUID,
  ADD COLUMN "admission_lease_until" TIMESTAMPTZ(6),
  ADD COLUMN "last_admission_error" JSONB;

ALTER TABLE "agent_platform_invocations"
  ALTER COLUMN "locale" DROP DEFAULT,
  ALTER COLUMN "admission_attempts" SET DEFAULT 0,
  DROP CONSTRAINT "agent_platform_invocations_attempts_check",
  ADD CONSTRAINT "agent_platform_invocations_attempts_check"
    CHECK ("admission_attempts" >= 0);

UPDATE "agent_platform_invocations"
SET "next_admission_attempt_at" = NULL
WHERE "status" <> 'admitting';

ALTER TABLE "agent_platform_invocations"
  ADD CONSTRAINT "agent_platform_invocations_locale_check"
    CHECK (char_length(btrim("locale")) BETWEEN 2 AND 35),
  ADD CONSTRAINT "agent_platform_invocations_admission_lease_check"
    CHECK (
      (
        "status" = 'admitting'
        AND "next_admission_attempt_at" IS NOT NULL
        AND (
          (
            "admission_lease_token" IS NULL
            AND "admission_lease_until" IS NULL
          )
          OR
          (
            "admission_lease_token" IS NOT NULL
            AND "admission_lease_until" IS NOT NULL
          )
        )
      )
      OR
      (
        "status" <> 'admitting'
        AND "next_admission_attempt_at" IS NULL
        AND "admission_lease_token" IS NULL
        AND "admission_lease_until" IS NULL
      )
    ),
  ADD CONSTRAINT "agent_platform_invocations_admission_error_check"
    CHECK (
      "last_admission_error" IS NULL
      OR (
        jsonb_typeof("last_admission_error") = 'object'
        AND jsonb_typeof("last_admission_error"->'code') = 'string'
        AND char_length("last_admission_error"->>'code') BETWEEN 1 AND 128
        AND jsonb_typeof("last_admission_error"->'message') = 'string'
        AND char_length("last_admission_error"->>'message') BETWEEN 1 AND 2000
        AND jsonb_typeof("last_admission_error"->'retryable') = 'boolean'
      )
    );

CREATE INDEX "agent_platform_invocations_admission_due_idx"
  ON "agent_platform_invocations" (
    "next_admission_attempt_at",
    "created_at",
    "id"
  )
  WHERE "status" = 'admitting';
