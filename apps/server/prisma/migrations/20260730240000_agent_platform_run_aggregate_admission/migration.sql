-- One product Run aggregate owns one Ably run for its entire lifetime.
-- Transport triggers (root input and approval/tool-result continuations) are
-- ordered attempts below that aggregate. Admission capacity is reserved on the
-- aggregate and therefore counted exactly once across continuations, reloads,
-- retries, tabs, and gateway replicas.

CREATE TYPE "AgentPlatformInvocationAttemptStatus" AS ENUM (
  'admitting',
  'dispatched',
  'rejected'
);

ALTER TABLE "agent_platform_invocations"
  ADD COLUMN "workspace_scope_key" VARCHAR(64),
  ADD COLUMN "provider_lane" VARCHAR(64),
  ADD COLUMN "reserved_token_units" BIGINT,
  ADD COLUMN "reserved_cost_microusd" BIGINT,
  ADD COLUMN "latest_attempt_ordinal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lifecycle_attempt_ordinal" INTEGER NOT NULL DEFAULT -1;

UPDATE "agent_platform_invocations" AS invocation
SET
  "workspace_scope_key" =
    CASE
      WHEN conversation."scope_kind" = 'story-project'
        THEN conversation."scope"->>'workspaceId'
      ELSE conversation."scope_key"
    END,
  "provider_lane" = 'legacy-drain',
  "reserved_token_units" = 0,
  "reserved_cost_microusd" = 0,
  "lifecycle_attempt_ordinal" =
    CASE
      WHEN invocation."status" IN (
        'running',
        'waiting_for_approval',
        'succeeded',
        'failed',
        'cancelled'
      ) THEN 0
      ELSE -1
    END
FROM "agent_platform_conversations" AS conversation
WHERE conversation."id" = invocation."conversation_id";

ALTER TABLE "agent_platform_invocations"
  ALTER COLUMN "workspace_scope_key" SET NOT NULL,
  ALTER COLUMN "provider_lane" SET NOT NULL,
  ALTER COLUMN "reserved_token_units" SET NOT NULL,
  ALTER COLUMN "reserved_cost_microusd" SET NOT NULL,
  ADD CONSTRAINT "agent_platform_invocations_capacity_check"
    CHECK (
      "reserved_token_units" >= 0
      AND "reserved_cost_microusd" >= 0
      AND char_length(btrim("workspace_scope_key")) BETWEEN 1 AND 64
      AND char_length(btrim("provider_lane")) BETWEEN 1 AND 64
    ),
  ADD CONSTRAINT "agent_platform_invocations_attempt_ordinal_check"
    CHECK (
      "latest_attempt_ordinal" >= 0
      AND "lifecycle_attempt_ordinal" BETWEEN -1 AND "latest_attempt_ordinal"
    );

CREATE TABLE "agent_platform_invocation_attempts" (
  "id" UUID NOT NULL,
  "invocation_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "input_event_id" VARCHAR(256) NOT NULL,
  "client_message_id" VARCHAR(512) NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "status" "AgentPlatformInvocationAttemptStatus" NOT NULL DEFAULT 'admitting',
  "error" JSONB,
  "admission_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_admission_attempt_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "admission_lease_token" UUID,
  "admission_lease_until" TIMESTAMPTZ(6),
  "dispatched_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_platform_invocation_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_platform_invocation_attempts_invocation_fkey"
    FOREIGN KEY ("invocation_id")
    REFERENCES "agent_platform_invocations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_platform_invocation_attempts_ordinal_check"
    CHECK ("ordinal" >= 0),
  CONSTRAINT "agent_platform_invocation_attempts_input_event_check"
    CHECK (
      char_length(btrim("input_event_id")) BETWEEN 1 AND 256
      AND "input_event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  CONSTRAINT "agent_platform_invocation_attempts_client_message_check"
    CHECK (char_length(btrim("client_message_id")) BETWEEN 1 AND 512),
  CONSTRAINT "agent_platform_invocation_attempts_locale_check"
    CHECK (char_length(btrim("locale")) BETWEEN 2 AND 35),
  CONSTRAINT "agent_platform_invocation_attempts_attempts_check"
    CHECK ("admission_attempts" >= 0),
  CONSTRAINT "agent_platform_invocation_attempts_lifecycle_check"
    CHECK (
      (
        "status" = 'admitting'
        AND "next_admission_attempt_at" IS NOT NULL
        AND "dispatched_at" IS NULL
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
        "status" = 'dispatched'
        AND "next_admission_attempt_at" IS NULL
        AND "admission_lease_token" IS NULL
        AND "admission_lease_until" IS NULL
        AND "dispatched_at" IS NOT NULL
      )
      OR
      (
        "status" = 'rejected'
        AND "next_admission_attempt_at" IS NULL
        AND "admission_lease_token" IS NULL
        AND "admission_lease_until" IS NULL
        AND "dispatched_at" IS NULL
      )
    ),
  CONSTRAINT "agent_platform_invocation_attempts_error_check"
    CHECK (
      (
        "status" = 'rejected'
        AND jsonb_typeof("error") = 'object'
        AND jsonb_typeof("error"->'code') = 'string'
        AND char_length("error"->>'code') BETWEEN 1 AND 128
        AND jsonb_typeof("error"->'message') = 'string'
        AND char_length("error"->>'message') BETWEEN 1 AND 2000
        AND jsonb_typeof("error"->'retryable') = 'boolean'
      )
      OR
      ("status" <> 'rejected' AND "error" IS NULL)
    )
);

-- Preserve every existing root trigger as ordinal zero. Its old outbox state
-- becomes the new attempt state without changing invocation/run identity.
INSERT INTO "agent_platform_invocation_attempts" (
  "id",
  "invocation_id",
  "conversation_id",
  "ordinal",
  "input_event_id",
  "client_message_id",
  "locale",
  "status",
  "error",
  "admission_attempts",
  "next_admission_attempt_at",
  "admission_lease_token",
  "admission_lease_until",
  "dispatched_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "id",
  "conversation_id",
  0,
  "input_event_id",
  "client_message_id",
  "locale",
  CASE
    WHEN "status" = 'admitting'
      THEN 'admitting'::"AgentPlatformInvocationAttemptStatus"
    WHEN "status" = 'rejected'
      THEN 'rejected'::"AgentPlatformInvocationAttemptStatus"
    ELSE 'dispatched'::"AgentPlatformInvocationAttemptStatus"
  END,
  CASE WHEN "status" = 'rejected' THEN "error" ELSE NULL END,
  "admission_attempts",
  CASE WHEN "status" = 'admitting' THEN "next_admission_attempt_at" ELSE NULL END,
  CASE WHEN "status" = 'admitting' THEN "admission_lease_token" ELSE NULL END,
  CASE WHEN "status" = 'admitting' THEN "admission_lease_until" ELSE NULL END,
  CASE
    WHEN "status" NOT IN ('admitting', 'rejected')
      THEN COALESCE("admitted_at", "started_at", "completed_at", "updated_at")
    ELSE NULL
  END,
  "created_at",
  "updated_at"
FROM "agent_platform_invocations";

CREATE UNIQUE INDEX "agent_platform_invocation_attempts_ordinal_unique"
  ON "agent_platform_invocation_attempts" ("invocation_id", "ordinal");
CREATE UNIQUE INDEX "agent_platform_invocation_attempts_message_unique"
  ON "agent_platform_invocation_attempts" (
    "conversation_id",
    "client_message_id"
  );
CREATE UNIQUE INDEX "agent_platform_invocation_attempts_input_unique"
  ON "agent_platform_invocation_attempts" (
    "conversation_id",
    "input_event_id"
  );
CREATE INDEX "agent_platform_invocation_attempts_due_idx"
  ON "agent_platform_invocation_attempts" (
    "status",
    "next_admission_attempt_at",
    "created_at",
    "id"
  );

CREATE INDEX "agent_platform_invocations_workspace_active_idx"
  ON "agent_platform_invocations" (
    "workspace_scope_key",
    "status",
    "created_at",
    "id"
  );
CREATE INDEX "agent_platform_invocations_provider_active_idx"
  ON "agent_platform_invocations" (
    "provider_lane",
    "status",
    "created_at",
    "id"
  );

-- Causal transport identity is immutable. A retry reopens delivery state on
-- the same event/message/attempt; a new event must create a new message and
-- attempt instead of rewriting history underneath Ably or Temporal.
CREATE OR REPLACE FUNCTION "reject_agent_invocation_identity_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."conversation_id",
    NEW."owner_actor_id",
    NEW."input_event_id",
    NEW."client_message_id",
    NEW."locale",
    NEW."provisional_run_id"
  ) IS DISTINCT FROM ROW(
    OLD."conversation_id",
    OLD."owner_actor_id",
    OLD."input_event_id",
    OLD."client_message_id",
    OLD."locale",
    OLD."provisional_run_id"
  )
  THEN
    RAISE EXCEPTION
      'agent invocation causal identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_platform_invocations_identity_immutable_trigger"
BEFORE UPDATE OF
  "conversation_id",
  "owner_actor_id",
  "input_event_id",
  "client_message_id",
  "locale",
  "provisional_run_id"
ON "agent_platform_invocations"
FOR EACH ROW
EXECUTE FUNCTION "reject_agent_invocation_identity_update"();

CREATE OR REPLACE FUNCTION "reject_agent_invocation_attempt_identity_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."invocation_id",
    NEW."conversation_id",
    NEW."ordinal",
    NEW."input_event_id",
    NEW."client_message_id",
    NEW."locale"
  ) IS DISTINCT FROM ROW(
    OLD."invocation_id",
    OLD."conversation_id",
    OLD."ordinal",
    OLD."input_event_id",
    OLD."client_message_id",
    OLD."locale"
  )
  THEN
    RAISE EXCEPTION
      'agent invocation attempt causal identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_platform_invocation_attempts_identity_immutable_trigger"
BEFORE UPDATE OF
  "invocation_id",
  "conversation_id",
  "ordinal",
  "input_event_id",
  "client_message_id",
  "locale"
ON "agent_platform_invocation_attempts"
FOR EACH ROW
EXECUTE FUNCTION "reject_agent_invocation_attempt_identity_update"();

DROP INDEX "agent_platform_invocations_admission_due_idx";

ALTER TABLE "agent_platform_invocations"
  DROP CONSTRAINT "agent_platform_invocations_admission_lease_check",
  DROP CONSTRAINT "agent_platform_invocations_admission_error_check",
  DROP CONSTRAINT "agent_platform_invocations_attempts_check",
  DROP COLUMN "admission_attempts",
  DROP COLUMN "next_admission_attempt_at",
  DROP COLUMN "admission_lease_token",
  DROP COLUMN "admission_lease_until",
  DROP COLUMN "last_admission_error";
