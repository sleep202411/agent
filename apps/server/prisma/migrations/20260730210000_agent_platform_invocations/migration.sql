-- Durable product projection for Agent invocation admission and lifecycle.
-- Temporal owns execution history; this table is the reconnect-safe UI fact
-- for the interval before an Ably Run exists and for terminal reconciliation.

CREATE TYPE "AgentPlatformInvocationStatus" AS ENUM (
  'admitting',
  'rejected',
  'queued',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TABLE "agent_platform_invocations" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "owner_actor_id" VARCHAR(128) NOT NULL,
  "input_event_id" VARCHAR(256) NOT NULL,
  "client_message_id" VARCHAR(512) NOT NULL,
  "provisional_run_id" UUID NOT NULL,
  "workflow_id" UUID,
  "status" "AgentPlatformInvocationStatus" NOT NULL DEFAULT 'admitting',
  "error" JSONB,
  "admission_attempts" INTEGER NOT NULL DEFAULT 1,
  "admitted_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_platform_invocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_platform_invocations_conversation_owner_fkey"
    FOREIGN KEY ("conversation_id", "owner_actor_id")
    REFERENCES "agent_platform_conversations" ("id", "owner_actor_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_platform_invocations_owner_check"
    CHECK (
      char_length(btrim("owner_actor_id")) BETWEEN 1 AND 128
      AND "owner_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  CONSTRAINT "agent_platform_invocations_input_event_check"
    CHECK (
      char_length(btrim("input_event_id")) BETWEEN 1 AND 256
      AND "input_event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  CONSTRAINT "agent_platform_invocations_client_message_check"
    CHECK (char_length(btrim("client_message_id")) BETWEEN 1 AND 512),
  CONSTRAINT "agent_platform_invocations_attempts_check"
    CHECK ("admission_attempts" > 0),
  CONSTRAINT "agent_platform_invocations_error_check"
    CHECK (
      (
        "status" IN ('rejected', 'failed')
        AND jsonb_typeof("error") = 'object'
        AND jsonb_typeof("error"->'code') = 'string'
        AND char_length("error"->>'code') BETWEEN 1 AND 128
        AND jsonb_typeof("error"->'message') = 'string'
        AND char_length("error"->>'message') BETWEEN 1 AND 2000
        AND jsonb_typeof("error"->'retryable') = 'boolean'
      )
      OR
      (
        "status" NOT IN ('rejected', 'failed')
        AND "error" IS NULL
      )
    ),
  CONSTRAINT "agent_platform_invocations_lifecycle_check"
    CHECK (
      (
        "status" IN ('admitting', 'rejected')
        AND "admitted_at" IS NULL
        AND "started_at" IS NULL
        AND ("completed_at" IS NULL OR "status" = 'rejected')
      )
      OR
      (
        "status" = 'queued'
        AND "admitted_at" IS NOT NULL
        AND "started_at" IS NULL
        AND "completed_at" IS NULL
      )
      OR
      (
        "status" = 'running'
        AND "admitted_at" IS NOT NULL
        AND "started_at" IS NOT NULL
        AND "completed_at" IS NULL
      )
      OR
      (
        "status" = 'waiting_for_approval'
        AND "admitted_at" IS NOT NULL
        AND "started_at" IS NOT NULL
        AND "completed_at" IS NULL
      )
      OR
      (
        "status" IN ('succeeded', 'failed', 'cancelled')
        AND "admitted_at" IS NOT NULL
        AND "completed_at" IS NOT NULL
      )
    ),
  CONSTRAINT "agent_platform_invocations_time_order_check"
    CHECK (
      ("admitted_at" IS NULL OR "admitted_at" >= "created_at")
      AND ("started_at" IS NULL OR "started_at" >= "admitted_at")
      AND (
        "completed_at" IS NULL
        OR "completed_at" >= COALESCE("started_at", "admitted_at", "created_at")
      )
    )
);

CREATE UNIQUE INDEX "agent_platform_invocations_conversation_input_unique"
  ON "agent_platform_invocations" ("conversation_id", "input_event_id");

CREATE INDEX "agent_platform_invocations_conversation_status_idx"
  ON "agent_platform_invocations" (
    "conversation_id",
    "status",
    "created_at" DESC,
    "id" DESC
  );

CREATE INDEX "agent_platform_invocations_owner_recent_idx"
  ON "agent_platform_invocations" (
    "owner_actor_id",
    "created_at" DESC,
    "id" DESC
  );
