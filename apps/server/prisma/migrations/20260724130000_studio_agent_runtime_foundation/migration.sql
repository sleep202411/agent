BEGIN;

-- Additive canonical Studio Agent runtime. It does not read, migrate, or
-- dual-write legacy Copilot/Mastra state or product-owned facts.

-- Shared-contract enums ------------------------------------------------------

CREATE TYPE "StudioAgentThreadStatus" AS ENUM ('active', 'archived');
CREATE TYPE "StudioAgentMessageRole" AS ENUM ('user', 'assistant');
CREATE TYPE "StudioAgentMessageStatus" AS ENUM (
  'accepted', 'streaming', 'completed', 'failed', 'cancelled'
);
CREATE TYPE "StudioAgentRunKind" AS ENUM ('turn', 'task');
CREATE TYPE "StudioAgentRunTrigger" AS ENUM ('message', 'retry', 'resume', 'system');
CREATE TYPE "StudioAgentRunStatus" AS ENUM (
  'queued', 'running', 'waiting_for_approval', 'waiting_for_input',
  'cancelling', 'succeeded', 'failed', 'cancelled'
);
CREATE TYPE "StudioAgentInputDelivery" AS ENUM ('steer', 'enqueue', 'stop_and_send');
CREATE TYPE "StudioAgentInputStatus" AS ENUM (
  'accepted', 'consumed', 'promoted', 'cancelled'
);
CREATE TYPE "StudioAgentCapabilityEffect" AS ENUM (
  'read', 'write', 'delete', 'generate', 'publish', 'external'
);
CREATE TYPE "StudioAgentRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "StudioAgentActionStatus" AS ENUM (
  'proposed', 'waiting_for_approval', 'queued', 'running',
  'succeeded', 'failed', 'denied', 'cancelled'
);
CREATE TYPE "StudioAgentApprovalStatus" AS ENUM (
  'pending', 'approved', 'denied', 'expired', 'cancelled'
);

-- Runtime-only enums ---------------------------------------------------------

CREATE TYPE "StudioAgentCommandType" AS ENUM ('start', 'signal', 'cancel');
CREATE TYPE "StudioAgentCommandStatus" AS ENUM ('pending', 'dispatched', 'dead_letter');
CREATE TYPE "StudioAgentArtifactKind" AS ENUM (
  'media', 'document', 'text', 'structured_data', 'bundle'
);
CREATE TYPE "StudioAgentArtifactStatus" AS ENUM ('pending', 'ready', 'failed');
CREATE TYPE "StudioAgentModelAttemptStatus" AS ENUM (
  'running', 'succeeded', 'failed', 'cancelled'
);
CREATE TYPE "StudioAgentModelAttemptPurpose" AS ENUM (
  'response', 'context_compaction'
);
CREATE TYPE "StudioAgentContextCheckpointScope" AS ENUM (
  'thread_prefix', 'run_suffix'
);

-- Reusable immutable validators. API boundaries still parse the complete
-- packages/shared schemas; these functions reject structurally invalid facts
-- even when a future writer bypasses the service layer.

CREATE FUNCTION "studio_agent_is_stable_key"("value" TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    "value" IS NOT NULL
    AND char_length("value") BETWEEN 1 AND 160
    AND "value" ~ '^[a-z][a-z0-9]*([-._:][a-z0-9]+)*$'
$$;

CREATE FUNCTION "studio_agent_is_manifest_version"("value" TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    "value" IS NOT NULL
    AND "value" ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
$$;

CREATE FUNCTION "studio_agent_is_sha256"("value" TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT "value" IS NOT NULL AND "value" ~ '^[a-f0-9]{64}$'
$$;

CREATE FUNCTION "studio_agent_is_resource_ref"("value" JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("value") <> 'object' THEN FALSE
    WHEN NOT ("value" ?& ARRAY['resourceType', 'resourceId', 'revision']) THEN FALSE
    WHEN (SELECT count(*) FROM jsonb_object_keys("value")) <> 3 THEN FALSE
    WHEN NOT "studio_agent_is_stable_key"("value"->>'resourceType') THEN FALSE
    WHEN char_length(btrim(COALESCE("value"->>'resourceId', ''))) NOT BETWEEN 1 AND 256 THEN FALSE
    WHEN
      ("value"->'revision') <> 'null'::jsonb
      AND (
        jsonb_typeof("value"->'revision') <> 'string'
        OR char_length(btrim("value"->>'revision')) NOT BETWEEN 1 AND 160
      )
      THEN FALSE
    ELSE TRUE
  END
$$;

CREATE FUNCTION "studio_agent_is_permission_policy"("value" JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("value") <> 'object' THEN FALSE
    WHEN NOT ("value" ?& ARRAY[
      'schemaVersion', 'policyId', 'revision', 'mode', 'rules', 'createdAt'
    ]) THEN FALSE
    WHEN "value"->>'schemaVersion' <> 'studio-agent-v1' THEN FALSE
    WHEN COALESCE("value"->>'policyId', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      THEN FALSE
    WHEN COALESCE("value"->>'revision', '') !~ '^[1-9][0-9]*$' THEN FALSE
    WHEN COALESCE("value"->>'mode', '') NOT IN ('ask', 'smart', 'full', 'custom') THEN FALSE
    WHEN jsonb_typeof("value"->'rules') <> 'array' THEN FALSE
    WHEN jsonb_array_length("value"->'rules') > 256 THEN FALSE
    WHEN jsonb_typeof("value"->'createdAt') <> 'string' THEN FALSE
    ELSE TRUE
  END
$$;

CREATE FUNCTION "studio_agent_is_error"("value" JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("value") <> 'object' THEN FALSE
    WHEN NOT ("value" ?& ARRAY['code', 'message', 'retryable', 'details']) THEN FALSE
    WHEN NOT "studio_agent_is_stable_key"("value"->>'code') THEN FALSE
    WHEN char_length(btrim(COALESCE("value"->>'message', ''))) NOT BETWEEN 1 AND 8000 THEN FALSE
    WHEN jsonb_typeof("value"->'retryable') <> 'boolean' THEN FALSE
    WHEN
      ("value"->'details') <> 'null'::jsonb
      AND jsonb_typeof("value"->'details') <> 'object'
      THEN FALSE
    ELSE TRUE
  END
$$;

-- Canonical tables -----------------------------------------------------------

CREATE TABLE "studio_agent_threads" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "surface_id" VARCHAR(160) NOT NULL,
  "scenario_id" VARCHAR(160) NOT NULL,
  "scenario_version" VARCHAR(64) NOT NULL,
  "scope_container" JSONB NOT NULL,
  "scope_focus" JSONB,
  "scope_key" VARCHAR(64) NOT NULL,
  "owner_actor_id" VARCHAR(160) NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "title" VARCHAR(240),
  "status" "StudioAgentThreadStatus" NOT NULL DEFAULT 'active',
  "permission_policy" JSONB NOT NULL,
  "active_run_id" UUID,
  "next_message_ordinal" BIGINT NOT NULL DEFAULT 0,
  "next_event_sequence" BIGINT NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_threads_identity_chk" CHECK (
    "studio_agent_is_stable_key"("surface_id")
    AND "studio_agent_is_stable_key"("scenario_id")
    AND "studio_agent_is_manifest_version"("scenario_version")
    AND char_length(btrim("owner_actor_id")) BETWEEN 1 AND 160
    AND char_length(btrim("locale")) BETWEEN 2 AND 35
    AND ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 240)
  ),
  CONSTRAINT "studio_agent_threads_scope_chk" CHECK (
    "studio_agent_is_resource_ref"("scope_container")
    -- Thread identity is container-scoped. Focus is submission context and is
    -- frozen on runs/inputs, never updated on this shared project row.
    AND "scope_focus" IS NULL
    AND "studio_agent_is_sha256"("scope_key")
  ),
  CONSTRAINT "studio_agent_threads_policy_chk" CHECK (
    "studio_agent_is_permission_policy"("permission_policy")
  ),
  CONSTRAINT "studio_agent_threads_sequence_chk" CHECK (
    "next_message_ordinal" >= 0 AND "next_event_sequence" >= 1
  )
);

CREATE TABLE "studio_agent_messages" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID,
  "ordinal" BIGINT NOT NULL,
  "client_message_id" VARCHAR(128),
  "request_hash" VARCHAR(64),
  "role" "StudioAgentMessageRole" NOT NULL,
  "status" "StudioAgentMessageStatus" NOT NULL DEFAULT 'accepted',
  "parts" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "studio_agent_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_messages_ordinal_chk" CHECK ("ordinal" >= 0),
  CONSTRAINT "studio_agent_messages_client_id_chk" CHECK (
    "client_message_id" IS NULL OR btrim("client_message_id") <> ''
  ),
  CONSTRAINT "studio_agent_messages_request_hash_chk" CHECK (
    ("client_message_id" IS NULL AND "request_hash" IS NULL)
    OR (
      "client_message_id" IS NOT NULL
      AND "studio_agent_is_sha256"("request_hash")
    )
  ),
  CONSTRAINT "studio_agent_messages_parts_chk" CHECK (
    CASE
      WHEN jsonb_typeof("parts") = 'array'
        THEN jsonb_array_length("parts") BETWEEN 1 AND 128
          AND octet_length(convert_to("parts"::text, 'UTF8')) <= 2097152
      ELSE FALSE
    END
  ),
  CONSTRAINT "studio_agent_messages_lifecycle_chk" CHECK (
    ("role" <> 'user' OR "status" <> 'streaming')
    AND ("status" <> 'completed' OR "completed_at" IS NOT NULL)
    AND ("status" NOT IN ('accepted', 'streaming') OR "completed_at" IS NULL)
    AND ("completed_at" IS NULL OR "completed_at" >= "created_at")
  )
);

CREATE TABLE "studio_agent_runs" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "root_run_id" UUID NOT NULL,
  "parent_run_id" UUID,
  "source_step_id" UUID,
  "source_tool_call_id" VARCHAR(512),
  "depth" INTEGER NOT NULL,
  "context_boundary_ordinal" BIGINT,
  "kind" "StudioAgentRunKind" NOT NULL,
  "task" JSONB,
  "trigger" "StudioAgentRunTrigger" NOT NULL,
  "trigger_message_id" UUID,
  "scenario_id" VARCHAR(160) NOT NULL,
  "scenario_version" VARCHAR(64) NOT NULL,
  "execution_scope_container" JSONB NOT NULL,
  "execution_scope_focus" JSONB,
  "locale" VARCHAR(35) NOT NULL,
  "permission_policy" JSONB NOT NULL,
  "workflow_id" VARCHAR(255) NOT NULL,
  "status" "StudioAgentRunStatus" NOT NULL DEFAULT 'queued',
  "phase" VARCHAR(160),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "error" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_runs_identity_chk" CHECK (
    btrim("workflow_id") <> ''
    AND "studio_agent_is_stable_key"("scenario_id")
    AND "studio_agent_is_manifest_version"("scenario_version")
    AND "studio_agent_is_resource_ref"("execution_scope_container")
    AND (
      "execution_scope_focus" IS NULL
      OR "studio_agent_is_resource_ref"("execution_scope_focus")
    )
    AND char_length(btrim("locale")) BETWEEN 2 AND 35
    AND ("phase" IS NULL OR "studio_agent_is_stable_key"("phase"))
    AND "studio_agent_is_permission_policy"("permission_policy")
    AND ("error" IS NULL OR "studio_agent_is_error"("error"))
  ),
  CONSTRAINT "studio_agent_runs_hierarchy_chk" CHECK (
    (
      "kind" = 'turn'
      AND "root_run_id" = "id"
      AND "parent_run_id" IS NULL
      AND "source_step_id" IS NULL
      AND "source_tool_call_id" IS NULL
      AND "depth" = 0
      AND "context_boundary_ordinal" IS NULL
      AND "task" IS NULL
    )
    OR
    (
      "kind" = 'task'
      AND "root_run_id" <> "id"
      AND "parent_run_id" IS NOT NULL
      AND "source_step_id" IS NOT NULL
      AND char_length(btrim(COALESCE("source_tool_call_id", ''))) BETWEEN 1 AND 512
      AND "depth" >= 1
      AND "context_boundary_ordinal" >= 0
      AND CASE
        WHEN jsonb_typeof("task") = 'object'
          THEN "studio_agent_is_stable_key"("task"->>'taskKey')
            AND char_length(btrim(COALESCE("task"->>'title', ''))) BETWEEN 1 AND 240
        ELSE FALSE
      END
    )
  ),
  CONSTRAINT "studio_agent_runs_lifecycle_chk" CHECK (
    CASE "status"
      WHEN 'queued' THEN
        "started_at" IS NULL AND "completed_at" IS NULL AND "error" IS NULL
      WHEN 'running' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NULL AND "error" IS NULL
      WHEN 'waiting_for_approval' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NULL AND "error" IS NULL
      WHEN 'waiting_for_input' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NULL AND "error" IS NULL
      WHEN 'cancelling' THEN
        "completed_at" IS NULL AND "error" IS NULL
      WHEN 'succeeded' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "error" IS NULL
      WHEN 'failed' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NOT NULL
          AND "studio_agent_is_error"("error")
      WHEN 'cancelled' THEN
        "completed_at" IS NOT NULL AND "error" IS NULL
      ELSE FALSE
    END
  ),
  CONSTRAINT "studio_agent_runs_time_order_chk" CHECK (
    ("started_at" IS NULL OR "started_at" >= "created_at")
    AND (
      "completed_at" IS NULL
      OR "completed_at" >= COALESCE("started_at", "created_at")
    )
  )
);

CREATE TABLE "studio_agent_run_budgets" (
  "root_run_id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "max_child_depth" INTEGER NOT NULL,
  "max_child_runs" INTEGER NOT NULL,
  "max_concurrent_child_runs" INTEGER NOT NULL,
  "max_model_steps_per_run" INTEGER NOT NULL,
  "max_model_steps_per_root" INTEGER NOT NULL,
  "max_total_token_units" INTEGER NOT NULL,
  "max_context_bytes_per_step" INTEGER NOT NULL,
  "context_compaction_trigger_ratio" DOUBLE PRECISION NOT NULL,
  "context_compaction_retain_tail_units" INTEGER NOT NULL,
  "context_compaction_max_output_tokens" INTEGER NOT NULL,
  "image_token_reserve_units" INTEGER NOT NULL,
  "min_output_token_units_per_step" INTEGER NOT NULL,
  "max_output_token_units_per_step" INTEGER NOT NULL,
  "deadline_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_run_budgets_pkey" PRIMARY KEY ("root_run_id"),
  CONSTRAINT "studio_agent_run_budgets_limits_chk" CHECK (
    "max_child_depth" >= 1
    AND "max_child_runs" >= 1
    AND "max_concurrent_child_runs" >= 1
    AND "max_concurrent_child_runs" <= "max_child_runs"
    AND "max_model_steps_per_run" >= 1
    AND "max_model_steps_per_root" >= "max_model_steps_per_run"
    AND "max_total_token_units" >= 1
    AND "max_context_bytes_per_step" >= 1
    AND "context_compaction_trigger_ratio" BETWEEN 0.5 AND 0.95
    AND "context_compaction_retain_tail_units" >= 1
    AND "context_compaction_max_output_tokens" >= 1
    AND "context_compaction_max_output_tokens" <= "max_output_token_units_per_step"
    AND "image_token_reserve_units" >= 0
    AND "min_output_token_units_per_step" >= 1
    AND "max_output_token_units_per_step" >= "min_output_token_units_per_step"
    AND "max_output_token_units_per_step" <= "max_total_token_units"
    AND "image_token_reserve_units" + "min_output_token_units_per_step"
      <= "max_total_token_units"
    AND "deadline_at" > "created_at"
  )
);

CREATE TABLE "studio_agent_events" (
  "event_id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "root_run_id" UUID NOT NULL,
  "parent_run_id" UUID,
  "sequence" BIGINT NOT NULL,
  "type" VARCHAR(96) NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotency_key" VARCHAR(256) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "studio_agent_events_sequence_chk" CHECK ("sequence" >= 1),
  CONSTRAINT "studio_agent_events_identity_chk" CHECK (
    btrim("idempotency_key") <> ''
    AND "type" IN (
      'run.created',
      'run.started',
      'run.phase_changed',
      'run.waiting',
      'run.resumed',
      'run.cancellation_requested',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'assistant.segment.started',
      'assistant.segment.delta',
      'assistant.segment.completed',
      'activity.started',
      'activity.progress',
      'activity.completed',
      'activity.failed',
      'activity.cancelled',
      'action.proposed',
      'action.started',
      'action.completed',
      'approval.requested',
      'approval.resolved',
      'input.accepted',
      'input.consumed',
      'input.promoted',
      'input.cancelled',
      'context.compacted',
      'changeset.proposed',
      'changeset.applied',
      'changeset.rejected',
      'task.created',
      'task.started',
      'task.completed',
      'task.failed',
      'task.cancelled'
    )
  ),
  CONSTRAINT "studio_agent_events_payload_chk" CHECK (
    jsonb_typeof("payload") = 'object'
    AND octet_length(convert_to("payload"::text, 'UTF8')) <= 4194304
  )
);

CREATE TABLE "studio_agent_inputs" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "target_run_id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "delivery" "StudioAgentInputDelivery" NOT NULL,
  "status" "StudioAgentInputStatus" NOT NULL DEFAULT 'accepted',
  "sequence" BIGINT NOT NULL,
  "submission_scope_container" JSONB NOT NULL,
  "submission_scope_focus" JSONB,
  "submission_locale" VARCHAR(35) NOT NULL,
  "promoted_to_run_id" UUID,
  "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" TIMESTAMPTZ(6),

  CONSTRAINT "studio_agent_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_inputs_sequence_chk" CHECK ("sequence" >= 1),
  CONSTRAINT "studio_agent_inputs_submission_context_chk" CHECK (
    "studio_agent_is_resource_ref"("submission_scope_container")
    AND (
      "submission_scope_focus" IS NULL
      OR "studio_agent_is_resource_ref"("submission_scope_focus")
    )
    AND char_length(btrim("submission_locale")) BETWEEN 2 AND 35
  ),
  CONSTRAINT "studio_agent_inputs_lifecycle_chk" CHECK (
    ("status" = 'promoted') = ("promoted_to_run_id" IS NOT NULL)
    AND ("consumed_at" IS NULL OR "consumed_at" >= "accepted_at")
  )
);

CREATE TABLE "studio_agent_actions" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "step_id" UUID NOT NULL,
  "tool_call_id" VARCHAR(512) NOT NULL,
  "capability_id" VARCHAR(160) NOT NULL,
  "capability_version" VARCHAR(64) NOT NULL,
  "effect" "StudioAgentCapabilityEffect" NOT NULL,
  "risk" "StudioAgentRiskLevel" NOT NULL,
  "status" "StudioAgentActionStatus" NOT NULL DEFAULT 'proposed',
  "title" VARCHAR(240) NOT NULL,
  "summary" TEXT NOT NULL,
  "target" JSONB,
  "input" JSONB NOT NULL,
  "input_hash" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(256),
  "output" JSONB,
  "change_set" JSONB,
  "error" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "studio_agent_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_actions_identity_chk" CHECK (
    char_length(btrim("tool_call_id")) BETWEEN 1 AND 512
    AND "studio_agent_is_stable_key"("capability_id")
    AND "studio_agent_is_manifest_version"("capability_version")
    AND char_length(btrim("title")) BETWEEN 1 AND 240
    AND char_length(btrim("summary")) BETWEEN 1 AND 4000
    AND "studio_agent_is_sha256"("input_hash")
    AND ("idempotency_key" IS NULL OR btrim("idempotency_key") <> '')
  ),
  CONSTRAINT "studio_agent_actions_payload_chk" CHECK (
    jsonb_typeof("input") = 'object'
    AND ("target" IS NULL OR "studio_agent_is_resource_ref"("target"))
    AND ("change_set" IS NULL OR jsonb_typeof("change_set") = 'object')
    AND ("error" IS NULL OR "studio_agent_is_error"("error"))
    AND octet_length(convert_to("input"::text, 'UTF8')) <= 4194304
  ),
  CONSTRAINT "studio_agent_actions_lifecycle_chk" CHECK (
    CASE "status"
      WHEN 'proposed' THEN
        "started_at" IS NULL AND "completed_at" IS NULL
          AND "output" IS NULL AND "change_set" IS NULL AND "error" IS NULL
      WHEN 'waiting_for_approval' THEN
        "started_at" IS NULL AND "completed_at" IS NULL
          AND "output" IS NULL AND "change_set" IS NULL AND "error" IS NULL
      WHEN 'queued' THEN
        "started_at" IS NULL AND "completed_at" IS NULL
          AND "output" IS NULL AND "change_set" IS NULL AND "error" IS NULL
      WHEN 'running' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NULL
          AND "output" IS NULL AND "change_set" IS NULL AND "error" IS NULL
      WHEN 'succeeded' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NOT NULL
          AND "error" IS NULL
      WHEN 'failed' THEN
        "started_at" IS NOT NULL AND "completed_at" IS NOT NULL
          AND "change_set" IS NULL AND "studio_agent_is_error"("error")
      WHEN 'denied' THEN
        "started_at" IS NULL AND "completed_at" IS NOT NULL
          AND "output" IS NULL AND "change_set" IS NULL AND "error" IS NULL
      WHEN 'cancelled' THEN
        "completed_at" IS NOT NULL AND "output" IS NULL
          AND "change_set" IS NULL AND "error" IS NULL
      ELSE FALSE
    END
  ),
  CONSTRAINT "studio_agent_actions_time_order_chk" CHECK (
    ("started_at" IS NULL OR "started_at" >= "created_at")
    AND (
      "completed_at" IS NULL
      OR "completed_at" >= COALESCE("started_at", "created_at")
    )
  )
);

CREATE TABLE "studio_agent_approvals" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "action_id" UUID NOT NULL,
  "status" "StudioAgentApprovalStatus" NOT NULL DEFAULT 'pending',
  "reason" TEXT NOT NULL,
  "action_input_hash" VARCHAR(64) NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6),
  "decision" JSONB,

  CONSTRAINT "studio_agent_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_approvals_identity_chk" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 4000
    AND "studio_agent_is_sha256"("action_input_hash")
    AND ("expires_at" IS NULL OR "expires_at" > "requested_at")
  ),
  CONSTRAINT "studio_agent_approvals_decision_chk" CHECK (
    CASE "status"
      WHEN 'pending' THEN "decision" IS NULL
      WHEN 'expired' THEN "decision" IS NULL
      WHEN 'cancelled' THEN "decision" IS NULL
      WHEN 'approved' THEN
        jsonb_typeof("decision") = 'object'
        AND "decision"->>'decision' = 'approved'
        AND char_length(btrim(COALESCE("decision"->>'actorId', ''))) BETWEEN 1 AND 160
        AND jsonb_typeof("decision"->'decidedAt') = 'string'
        AND (
          ("decision"->'note') = 'null'::jsonb
          OR (
            jsonb_typeof("decision"->'note') = 'string'
            AND char_length("decision"->>'note') <= 2000
          )
        )
      WHEN 'denied' THEN
        jsonb_typeof("decision") = 'object'
        AND "decision"->>'decision' = 'denied'
        AND char_length(btrim(COALESCE("decision"->>'actorId', ''))) BETWEEN 1 AND 160
        AND jsonb_typeof("decision"->'decidedAt') = 'string'
        AND (
          ("decision"->'note') = 'null'::jsonb
          OR (
            jsonb_typeof("decision"->'note') = 'string'
            AND char_length("decision"->>'note') <= 2000
          )
        )
      ELSE FALSE
    END
  )
);

CREATE TABLE "studio_agent_command_outbox" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "input_id" UUID,
  "type" "StudioAgentCommandType" NOT NULL,
  "status" "StudioAgentCommandStatus" NOT NULL DEFAULT 'pending',
  "payload" JSONB NOT NULL,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 12,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_owner" VARCHAR(160),
  "lease_acquired_at" TIMESTAMPTZ(6),
  "lease_expires_at" TIMESTAMPTZ(6),
  "dispatched_at" TIMESTAMPTZ(6),
  "dead_lettered_at" TIMESTAMPTZ(6),
  "last_error_code" VARCHAR(96),
  "last_error_detail" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_command_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_commands_identity_chk" CHECK (
    btrim("idempotency_key") <> ''
    AND jsonb_typeof("payload") = 'object'
    AND ("lease_owner" IS NULL OR btrim("lease_owner") <> '')
    AND ("last_error_code" IS NULL OR btrim("last_error_code") <> '')
  ),
  CONSTRAINT "studio_agent_commands_attempt_chk" CHECK (
    "attempt_count" >= 0
    AND "max_attempts" > 0
    AND "attempt_count" <= "max_attempts"
  ),
  CONSTRAINT "studio_agent_commands_lease_chk" CHECK (
    (
      "lease_token" IS NULL
      AND "lease_owner" IS NULL
      AND "lease_acquired_at" IS NULL
      AND "lease_expires_at" IS NULL
    )
    OR
    (
      "status" = 'pending'
      AND "lease_token" IS NOT NULL
      AND "lease_owner" IS NOT NULL
      AND "lease_acquired_at" IS NOT NULL
      AND "lease_expires_at" > "lease_acquired_at"
    )
  ),
  CONSTRAINT "studio_agent_commands_status_chk" CHECK (
    CASE "status"
      WHEN 'pending' THEN "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL
      WHEN 'dispatched' THEN "dispatched_at" IS NOT NULL AND "dead_lettered_at" IS NULL
      WHEN 'dead_letter' THEN "dispatched_at" IS NULL AND "dead_lettered_at" IS NOT NULL
      ELSE FALSE
    END
  )
);

CREATE TABLE "studio_agent_artifacts" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID,
  "message_id" UUID,
  "action_id" UUID,
  "created_by_actor_id" VARCHAR(160) NOT NULL,
  "kind" "StudioAgentArtifactKind" NOT NULL,
  "status" "StudioAgentArtifactStatus" NOT NULL DEFAULT 'pending',
  "name" VARCHAR(255) NOT NULL,
  "media_asset_id" UUID,
  "value" JSONB,
  "content_hash" VARCHAR(64),
  "ready_at" TIMESTAMPTZ(6),
  "error" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_artifacts_identity_chk" CHECK (
    char_length(btrim("created_by_actor_id")) BETWEEN 1 AND 160
    AND char_length(btrim("name")) BETWEEN 1 AND 255
    AND ("content_hash" IS NULL OR "studio_agent_is_sha256"("content_hash"))
    AND ("error" IS NULL OR "studio_agent_is_error"("error"))
    AND ("action_id" IS NULL OR "run_id" IS NOT NULL)
  ),
  CONSTRAINT "studio_agent_artifacts_lifecycle_chk" CHECK (
    CASE "status"
      WHEN 'pending' THEN "ready_at" IS NULL AND "error" IS NULL
      WHEN 'failed' THEN "ready_at" IS NULL AND "studio_agent_is_error"("error")
      WHEN 'ready' THEN
        "ready_at" IS NOT NULL
        AND "error" IS NULL
        AND (
          (
            "kind" IN ('media', 'document')
            AND "media_asset_id" IS NOT NULL
            AND "value" IS NULL
            AND "content_hash" IS NULL
          )
          OR
          (
            "kind" IN ('text', 'structured_data', 'bundle')
            AND "media_asset_id" IS NULL
            AND "value" IS NOT NULL
            AND "content_hash" IS NOT NULL
            AND octet_length(convert_to("value"::text, 'UTF8')) <= 2097152
          )
        )
      ELSE FALSE
    END
  ),
  CONSTRAINT "studio_agent_artifacts_time_order_chk" CHECK (
    "ready_at" IS NULL OR "ready_at" >= "created_at"
  )
);

CREATE TABLE "studio_agent_context_checkpoints" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "producer_run_id" UUID NOT NULL,
  "scope" "StudioAgentContextCheckpointScope" NOT NULL,
  "scope_run_id" UUID,
  "boundary_ordinal" BIGINT,
  "revision" INTEGER NOT NULL,
  "source_event_sequence" BIGINT NOT NULL,
  "model_attempt_id" UUID NOT NULL,
  "previous_checkpoint_id" UUID,
  "covered_through_message_id" UUID NOT NULL,
  "covered_message_count" INTEGER NOT NULL,
  "retained_message_count" INTEGER NOT NULL,
  "source_hash" VARCHAR(64) NOT NULL,
  "summary_text" TEXT NOT NULL,
  "summary_hash" VARCHAR(64) NOT NULL,
  "compacted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_agent_context_checkpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_checkpoints_shape_chk" CHECK (
    "revision" >= 1
    AND "source_event_sequence" >= 1
    AND "covered_message_count" >= 1
    AND "retained_message_count" >= 0
    AND "retained_message_count" <= "covered_message_count"
    AND char_length("source_hash") = 64
    AND "source_hash" ~ '^[0-9a-f]{64}$'
    AND octet_length(convert_to("summary_text", 'UTF8')) BETWEEN 1 AND 200000
    AND char_length("summary_hash") = 64
    AND "summary_hash" ~ '^[0-9a-f]{64}$'
    AND (
      (
        "scope" = 'thread_prefix'
        AND "scope_run_id" IS NULL
        AND "boundary_ordinal" IS NULL
      )
      OR (
        "scope" = 'run_suffix'
        AND "scope_run_id" IS NOT NULL
        AND "boundary_ordinal" IS NOT NULL
        AND "boundary_ordinal" >= 0
      )
    )
  )
);

CREATE TABLE "studio_agent_model_attempts" (
  "id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "step_id" UUID NOT NULL,
  "purpose" "StudioAgentModelAttemptPurpose" NOT NULL DEFAULT 'response',
  "assistant_message_id" UUID,
  "segment_id" UUID,
  "context_plan" JSONB,
  "ordinal" INTEGER NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "model_id" VARCHAR(160) NOT NULL,
  "provider_response_id" VARCHAR(512),
  "status" "StudioAgentModelAttemptStatus" NOT NULL DEFAULT 'running',
  "reserved_token_units" INTEGER NOT NULL,
  "reserved_output_token_units" INTEGER NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "cached_input_tokens" INTEGER,
  "reasoning_tokens" INTEGER,
  "finish_reason" VARCHAR(64),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "error" JSONB,

  CONSTRAINT "studio_agent_model_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "studio_agent_model_attempts_identity_chk" CHECK (
    "ordinal" >= 0
    AND "studio_agent_is_stable_key"("provider")
    AND btrim("model_id") <> ''
    AND ("provider_response_id" IS NULL OR btrim("provider_response_id") <> '')
    AND ("finish_reason" IS NULL OR btrim("finish_reason") <> '')
    AND ("error" IS NULL OR "studio_agent_is_error"("error"))
    AND (
      (
        "purpose" = 'response'
        AND "assistant_message_id" IS NOT NULL
        AND "segment_id" IS NOT NULL
        AND "context_plan" IS NULL
      )
      OR (
        "purpose" = 'context_compaction'
        AND "assistant_message_id" IS NULL
        AND "segment_id" IS NULL
        AND jsonb_typeof("context_plan") = 'object'
      )
    )
  ),
  CONSTRAINT "studio_agent_model_attempts_usage_chk" CHECK (
    "reserved_token_units" >= 1
    AND "reserved_output_token_units" >= 1
    AND "reserved_output_token_units" <= "reserved_token_units"
    AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
    AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
    AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
    AND ("reasoning_tokens" IS NULL OR "reasoning_tokens" >= 0)
  ),
  CONSTRAINT "studio_agent_model_attempts_lifecycle_chk" CHECK (
    CASE "status"
      WHEN 'running' THEN
        "completed_at" IS NULL
        AND "input_tokens" IS NULL
        AND "output_tokens" IS NULL
        AND "cached_input_tokens" IS NULL
        AND "reasoning_tokens" IS NULL
        AND "finish_reason" IS NULL
        AND "error" IS NULL
      WHEN 'succeeded' THEN
        "completed_at" IS NOT NULL
        AND "input_tokens" IS NOT NULL
        AND "output_tokens" IS NOT NULL
        AND "error" IS NULL
      WHEN 'failed' THEN
        "completed_at" IS NOT NULL
        AND "studio_agent_is_error"("error")
      WHEN 'cancelled' THEN
        "completed_at" IS NOT NULL AND "error" IS NULL
      ELSE FALSE
    END
  ),
  CONSTRAINT "studio_agent_model_attempts_time_order_chk" CHECK (
    "completed_at" IS NULL OR "completed_at" >= "started_at"
  )
);

-- Lookup, uniqueness, and allocation indexes --------------------------------

CREATE INDEX "studio_agent_threads_workspace_recent_idx"
  ON "studio_agent_threads"("workspace_id", "status", "updated_at" DESC, "id" DESC);
CREATE INDEX "studio_agent_threads_owner_surface_recent_idx"
  ON "studio_agent_threads"(
    "owner_actor_id", "surface_id", "status", "updated_at" DESC, "id" DESC
  );
CREATE INDEX "studio_agent_threads_scenario_idx"
  ON "studio_agent_threads"("surface_id", "scenario_id", "scenario_version");
CREATE UNIQUE INDEX "studio_agent_threads_active_run_thread_unique"
  ON "studio_agent_threads"("active_run_id", "id");

-- The resolver has one canonical active thread for a scenario/container.
-- Container revision and focus are intentionally absent from scope_key so
-- refreshed context does not fork a chat.
CREATE UNIQUE INDEX "studio_agent_threads_active_identity_unique"
  ON "studio_agent_threads"(
    "owner_actor_id",
    "surface_id",
    "scenario_id",
    "scenario_version",
    "scope_key"
  )
  WHERE "status" = 'active';

CREATE INDEX "studio_agent_messages_thread_status_ordinal_idx"
  ON "studio_agent_messages"("thread_id", "status", "ordinal");
CREATE INDEX "studio_agent_messages_run_ordinal_idx"
  ON "studio_agent_messages"("run_id", "ordinal");
CREATE UNIQUE INDEX "studio_agent_messages_id_thread_unique"
  ON "studio_agent_messages"("id", "thread_id");
CREATE UNIQUE INDEX "studio_agent_messages_thread_ordinal_unique"
  ON "studio_agent_messages"("thread_id", "ordinal");
CREATE UNIQUE INDEX "studio_agent_messages_thread_client_message_unique"
  ON "studio_agent_messages"("thread_id", "client_message_id");

CREATE UNIQUE INDEX "studio_agent_runs_workflow_unique"
  ON "studio_agent_runs"("workflow_id");
CREATE INDEX "studio_agent_runs_thread_kind_status_recent_idx"
  ON "studio_agent_runs"(
    "thread_id", "kind", "status", "created_at" DESC, "id" DESC
  );
CREATE INDEX "studio_agent_runs_thread_status_recent_idx"
  ON "studio_agent_runs"("thread_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "studio_agent_runs_root_created_idx"
  ON "studio_agent_runs"("root_run_id", "created_at", "id");
CREATE INDEX "studio_agent_runs_parent_created_idx"
  ON "studio_agent_runs"("parent_run_id", "created_at", "id");
CREATE INDEX "studio_agent_runs_trigger_message_idx"
  ON "studio_agent_runs"("trigger_message_id");
CREATE UNIQUE INDEX "studio_agent_runs_id_thread_unique"
  ON "studio_agent_runs"("id", "thread_id");
CREATE UNIQUE INDEX "studio_agent_runs_parent_tool_call_unique"
  ON "studio_agent_runs"(
    "parent_run_id", "source_step_id", "source_tool_call_id"
  );

CREATE INDEX "studio_agent_run_budgets_thread_deadline_idx"
  ON "studio_agent_run_budgets"("thread_id", "deadline_at");
CREATE UNIQUE INDEX "studio_agent_run_budgets_root_thread_unique"
  ON "studio_agent_run_budgets"("root_run_id", "thread_id");

CREATE INDEX "studio_agent_events_run_sequence_idx"
  ON "studio_agent_events"("run_id", "sequence");
CREATE INDEX "studio_agent_events_root_run_sequence_idx"
  ON "studio_agent_events"("root_run_id", "sequence");
CREATE INDEX "studio_agent_events_thread_type_sequence_idx"
  ON "studio_agent_events"("thread_id", "type", "sequence");
CREATE UNIQUE INDEX "studio_agent_events_thread_sequence_unique"
  ON "studio_agent_events"("thread_id", "sequence");
CREATE UNIQUE INDEX "studio_agent_events_thread_idempotency_unique"
  ON "studio_agent_events"("thread_id", "idempotency_key");

CREATE INDEX "studio_agent_inputs_thread_status_idx"
  ON "studio_agent_inputs"("thread_id", "status", "accepted_at", "id");
CREATE INDEX "studio_agent_inputs_run_status_sequence_idx"
  ON "studio_agent_inputs"("target_run_id", "status", "sequence");
CREATE INDEX "studio_agent_inputs_promoted_run_idx"
  ON "studio_agent_inputs"("promoted_to_run_id");
CREATE UNIQUE INDEX "studio_agent_inputs_id_thread_unique"
  ON "studio_agent_inputs"("id", "thread_id");
CREATE UNIQUE INDEX "studio_agent_inputs_thread_message_unique"
  ON "studio_agent_inputs"("thread_id", "message_id");
CREATE UNIQUE INDEX "studio_agent_inputs_run_sequence_unique"
  ON "studio_agent_inputs"("target_run_id", "sequence");

CREATE UNIQUE INDEX "studio_agent_actions_idempotency_unique"
  ON "studio_agent_actions"("idempotency_key");
CREATE INDEX "studio_agent_actions_run_status_idx"
  ON "studio_agent_actions"("run_id", "status", "created_at", "id");
CREATE INDEX "studio_agent_actions_thread_status_idx"
  ON "studio_agent_actions"("thread_id", "status", "created_at", "id");
CREATE INDEX "studio_agent_actions_capability_status_idx"
  ON "studio_agent_actions"("capability_id", "capability_version", "status");
CREATE UNIQUE INDEX "studio_agent_actions_id_thread_run_unique"
  ON "studio_agent_actions"("id", "thread_id", "run_id");
CREATE UNIQUE INDEX "studio_agent_actions_run_tool_call_unique"
  ON "studio_agent_actions"("run_id", "step_id", "tool_call_id");

CREATE UNIQUE INDEX "studio_agent_approvals_action_unique"
  ON "studio_agent_approvals"("action_id");
CREATE INDEX "studio_agent_approvals_pending_expiry_idx"
  ON "studio_agent_approvals"("status", "expires_at", "id");
CREATE INDEX "studio_agent_approvals_thread_status_idx"
  ON "studio_agent_approvals"("thread_id", "status", "requested_at", "id");
CREATE UNIQUE INDEX "studio_agent_approvals_action_thread_run_unique"
  ON "studio_agent_approvals"("action_id", "thread_id", "run_id");

CREATE UNIQUE INDEX "studio_agent_commands_idempotency_unique"
  ON "studio_agent_command_outbox"("idempotency_key");
CREATE INDEX "studio_agent_commands_dispatch_idx"
  ON "studio_agent_command_outbox"("status", "next_attempt_at", "created_at", "id");
CREATE INDEX "studio_agent_commands_stale_lease_idx"
  ON "studio_agent_command_outbox"("lease_expires_at");
CREATE INDEX "studio_agent_commands_run_type_idx"
  ON "studio_agent_command_outbox"("run_id", "type", "created_at", "id");

CREATE INDEX "studio_agent_artifacts_thread_recent_idx"
  ON "studio_agent_artifacts"("thread_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "studio_agent_artifacts_run_created_idx"
  ON "studio_agent_artifacts"("run_id", "created_at", "id");
CREATE INDEX "studio_agent_artifacts_message_idx"
  ON "studio_agent_artifacts"("message_id");
CREATE INDEX "studio_agent_artifacts_media_asset_idx"
  ON "studio_agent_artifacts"("media_asset_id");

CREATE INDEX "studio_agent_checkpoints_producer_run_sequence_idx"
  ON "studio_agent_context_checkpoints"("producer_run_id", "source_event_sequence" DESC);
CREATE INDEX "studio_agent_checkpoints_thread_scope_revision_idx"
  ON "studio_agent_context_checkpoints"("thread_id", "scope", "revision" DESC);
CREATE INDEX "studio_agent_checkpoints_scope_run_revision_idx"
  ON "studio_agent_context_checkpoints"("scope_run_id", "revision" DESC);
CREATE UNIQUE INDEX "studio_agent_checkpoints_thread_sequence_unique"
  ON "studio_agent_context_checkpoints"("thread_id", "source_event_sequence");
CREATE UNIQUE INDEX "studio_agent_checkpoints_thread_prefix_revision_unique"
  ON "studio_agent_context_checkpoints"("thread_id", "revision")
  WHERE "scope" = 'thread_prefix';
CREATE UNIQUE INDEX "studio_agent_checkpoints_run_suffix_revision_unique"
  ON "studio_agent_context_checkpoints"("scope_run_id", "revision")
  WHERE "scope" = 'run_suffix';
CREATE UNIQUE INDEX "studio_agent_checkpoints_model_attempt_unique"
  ON "studio_agent_context_checkpoints"("model_attempt_id");

CREATE INDEX "studio_agent_model_attempts_run_step_idx"
  ON "studio_agent_model_attempts"("run_id", "step_id", "ordinal");
CREATE INDEX "studio_agent_model_attempts_thread_recent_idx"
  ON "studio_agent_model_attempts"("thread_id", "started_at" DESC, "id" DESC);
CREATE INDEX "studio_agent_model_attempts_status_idx"
  ON "studio_agent_model_attempts"("status", "started_at", "id");
CREATE UNIQUE INDEX "studio_agent_model_attempts_step_ordinal_unique"
  ON "studio_agent_model_attempts"("step_id", "ordinal");
CREATE UNIQUE INDEX "studio_agent_model_attempts_assistant_message_thread_unique"
  ON "studio_agent_model_attempts"("assistant_message_id", "thread_id")
  WHERE "assistant_message_id" IS NOT NULL;
CREATE UNIQUE INDEX "studio_agent_model_attempts_segment_unique"
  ON "studio_agent_model_attempts"("segment_id")
  WHERE "segment_id" IS NOT NULL;
CREATE UNIQUE INDEX "studio_agent_model_attempts_provider_response_unique"
  ON "studio_agent_model_attempts"("provider", "provider_response_id");

-- Relational ownership -------------------------------------------------------

ALTER TABLE "studio_agent_threads"
  ADD CONSTRAINT "studio_agent_threads_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "studio_agent_threads"
  ADD CONSTRAINT "studio_agent_threads_active_run_id_id_fkey"
  FOREIGN KEY ("active_run_id", "id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_messages"
  ADD CONSTRAINT "studio_agent_messages_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_messages"
  ADD CONSTRAINT "studio_agent_messages_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_runs"
  ADD CONSTRAINT "studio_agent_runs_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_runs"
  ADD CONSTRAINT "studio_agent_runs_root_run_id_thread_id_fkey"
  FOREIGN KEY ("root_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_runs"
  ADD CONSTRAINT "studio_agent_runs_parent_run_id_thread_id_fkey"
  FOREIGN KEY ("parent_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_runs"
  ADD CONSTRAINT "studio_agent_runs_trigger_message_id_thread_id_fkey"
  FOREIGN KEY ("trigger_message_id", "thread_id")
  REFERENCES "studio_agent_messages"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_run_budgets"
  ADD CONSTRAINT "studio_agent_run_budgets_root_run_id_thread_id_fkey"
  FOREIGN KEY ("root_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_agent_events"
  ADD CONSTRAINT "studio_agent_events_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_events"
  ADD CONSTRAINT "studio_agent_events_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_events"
  ADD CONSTRAINT "studio_agent_events_root_run_id_thread_id_fkey"
  FOREIGN KEY ("root_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_events"
  ADD CONSTRAINT "studio_agent_events_parent_run_id_thread_id_fkey"
  FOREIGN KEY ("parent_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_inputs"
  ADD CONSTRAINT "studio_agent_inputs_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_inputs"
  ADD CONSTRAINT "studio_agent_inputs_target_run_id_thread_id_fkey"
  FOREIGN KEY ("target_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_inputs"
  ADD CONSTRAINT "studio_agent_inputs_message_id_thread_id_fkey"
  FOREIGN KEY ("message_id", "thread_id")
  REFERENCES "studio_agent_messages"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_inputs"
  ADD CONSTRAINT "studio_agent_inputs_promoted_to_run_id_thread_id_fkey"
  FOREIGN KEY ("promoted_to_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_actions"
  ADD CONSTRAINT "studio_agent_actions_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_actions"
  ADD CONSTRAINT "studio_agent_actions_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_approvals"
  ADD CONSTRAINT "studio_agent_approvals_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_approvals"
  ADD CONSTRAINT "studio_agent_approvals_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_approvals"
  ADD CONSTRAINT "studio_agent_approvals_action_id_thread_id_run_id_fkey"
  FOREIGN KEY ("action_id", "thread_id", "run_id")
  REFERENCES "studio_agent_actions"("id", "thread_id", "run_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_agent_command_outbox"
  ADD CONSTRAINT "studio_agent_command_outbox_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_command_outbox"
  ADD CONSTRAINT "studio_agent_command_outbox_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_command_outbox"
  ADD CONSTRAINT "studio_agent_command_outbox_input_id_thread_id_fkey"
  FOREIGN KEY ("input_id", "thread_id")
  REFERENCES "studio_agent_inputs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_message_id_thread_id_fkey"
  FOREIGN KEY ("message_id", "thread_id")
  REFERENCES "studio_agent_messages"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_action_id_thread_id_run_id_fkey"
  FOREIGN KEY ("action_id", "thread_id", "run_id")
  REFERENCES "studio_agent_actions"("id", "thread_id", "run_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_artifacts"
  ADD CONSTRAINT "studio_agent_artifacts_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_producer_run_id_thread_fkey"
  FOREIGN KEY ("producer_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_scope_run_id_thread_fkey"
  FOREIGN KEY ("scope_run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_thread_id_source_event_se_fkey"
  FOREIGN KEY ("thread_id", "source_event_sequence")
  REFERENCES "studio_agent_events"("thread_id", "sequence")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_covered_through_message_i_fkey"
  FOREIGN KEY ("covered_through_message_id", "thread_id")
  REFERENCES "studio_agent_messages"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_previous_checkpoint_id_fkey"
  FOREIGN KEY ("previous_checkpoint_id")
  REFERENCES "studio_agent_context_checkpoints"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "studio_agent_model_attempts"
  ADD CONSTRAINT "studio_agent_model_attempts_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "studio_agent_threads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_agent_model_attempts"
  ADD CONSTRAINT "studio_agent_model_attempts_run_id_thread_id_fkey"
  FOREIGN KEY ("run_id", "thread_id")
  REFERENCES "studio_agent_runs"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_model_attempts"
  ADD CONSTRAINT "studio_agent_model_attempts_assistant_message_id_thread_id_fkey"
  FOREIGN KEY ("assistant_message_id", "thread_id")
  REFERENCES "studio_agent_messages"("id", "thread_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "studio_agent_context_checkpoints"
  ADD CONSTRAINT "studio_agent_context_checkpoints_model_attempt_id_fkey"
  FOREIGN KEY ("model_attempt_id")
  REFERENCES "studio_agent_model_attempts"("id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

-- Cross-row invariants -------------------------------------------------------

CREATE FUNCTION "studio_agent_guard_run_hierarchy"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "parent_root_run_id" UUID;
  "parent_depth" INTEGER;
  "parent_scope_container" JSONB;
  "parent_scope_focus" JSONB;
  "parent_locale" VARCHAR(35);
  "root_kind" "StudioAgentRunKind";
  "root_parent_run_id" UUID;
  "root_root_run_id" UUID;
  "source_boundary_ordinal" BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."root_run_id" IS DISTINCT FROM OLD."root_run_id"
    OR NEW."parent_run_id" IS DISTINCT FROM OLD."parent_run_id"
    OR NEW."source_step_id" IS DISTINCT FROM OLD."source_step_id"
    OR NEW."source_tool_call_id" IS DISTINCT FROM OLD."source_tool_call_id"
    OR NEW."depth" IS DISTINCT FROM OLD."depth"
    OR NEW."context_boundary_ordinal" IS DISTINCT FROM OLD."context_boundary_ordinal"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."task" IS DISTINCT FROM OLD."task"
    OR NEW."trigger" IS DISTINCT FROM OLD."trigger"
    OR NEW."trigger_message_id" IS DISTINCT FROM OLD."trigger_message_id"
    OR NEW."scenario_id" IS DISTINCT FROM OLD."scenario_id"
    OR NEW."scenario_version" IS DISTINCT FROM OLD."scenario_version"
    OR NEW."execution_scope_container" IS DISTINCT FROM OLD."execution_scope_container"
    OR NEW."execution_scope_focus" IS DISTINCT FROM OLD."execution_scope_focus"
    OR NEW."locale" IS DISTINCT FROM OLD."locale"
    OR NEW."permission_policy" IS DISTINCT FROM OLD."permission_policy"
    OR NEW."workflow_id" IS DISTINCT FROM OLD."workflow_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_immutable_identity_chk',
      MESSAGE = 'Studio Agent run identity and execution snapshot are immutable.';
  END IF;

  IF NEW."kind" = 'turn' THEN
    RETURN NEW;
  END IF;

  SELECT
      "root_run_id",
      "depth",
      "execution_scope_container",
      "execution_scope_focus",
      "locale"
    INTO
      "parent_root_run_id",
      "parent_depth",
      "parent_scope_container",
      "parent_scope_focus",
      "parent_locale"
    FROM "studio_agent_runs"
   WHERE "id" = NEW."parent_run_id"
     AND "thread_id" = NEW."thread_id";

  IF NOT FOUND OR "parent_root_run_id" <> NEW."root_run_id" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_parent_tree_chk',
      MESSAGE = 'A task run parent must belong to the same root run tree.';
  END IF;

  IF NEW."depth" <> "parent_depth" + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_depth_chk',
      MESSAGE = 'A task run depth must be exactly one greater than its parent.';
  END IF;

  IF NEW."execution_scope_container" IS DISTINCT FROM "parent_scope_container"
    OR NEW."execution_scope_focus" IS DISTINCT FROM "parent_scope_focus"
    OR NEW."locale" IS DISTINCT FROM "parent_locale"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_child_execution_context_chk',
      MESSAGE = 'A child run must inherit its parent execution scope and locale exactly.';
  END IF;

  SELECT "message"."ordinal"
    INTO "source_boundary_ordinal"
    FROM "studio_agent_model_attempts" AS "attempt"
    JOIN "studio_agent_messages" AS "message"
      ON "message"."id" = "attempt"."assistant_message_id"
     AND "message"."thread_id" = "attempt"."thread_id"
   WHERE "attempt"."thread_id" = NEW."thread_id"
     AND "attempt"."run_id" = NEW."parent_run_id"
     AND "attempt"."step_id" = NEW."source_step_id";

  IF NOT FOUND
    OR "source_boundary_ordinal" <> NEW."context_boundary_ordinal"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_context_boundary_chk',
      MESSAGE = 'A task context boundary must identify its parent model attempt message.';
  END IF;

  SELECT "kind", "parent_run_id", "root_run_id"
    INTO "root_kind", "root_parent_run_id", "root_root_run_id"
    FROM "studio_agent_runs"
   WHERE "id" = NEW."root_run_id"
     AND "thread_id" = NEW."thread_id";

  IF NOT FOUND
    OR "root_kind" <> 'turn'
    OR "root_parent_run_id" IS NOT NULL
    OR "root_root_run_id" <> NEW."root_run_id"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_root_turn_chk',
      MESSAGE = 'Every task run must resolve to a root turn in the same thread.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_runs_hierarchy_guard"
BEFORE INSERT OR UPDATE ON "studio_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_run_hierarchy"();

CREATE FUNCTION "studio_agent_guard_root_budget"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "run_kind" "StudioAgentRunKind";
  "run_root_run_id" UUID;
  "run_parent_run_id" UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_run_budgets_immutable_chk',
      MESSAGE = 'A Studio Agent root-run budget is immutable.';
  END IF;

  SELECT "kind", "root_run_id", "parent_run_id"
    INTO "run_kind", "run_root_run_id", "run_parent_run_id"
    FROM "studio_agent_runs"
   WHERE "id" = NEW."root_run_id"
     AND "thread_id" = NEW."thread_id";

  IF NOT FOUND
    OR "run_kind" <> 'turn'
    OR "run_root_run_id" <> NEW."root_run_id"
    OR "run_parent_run_id" IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_run_budgets_root_turn_chk',
      MESSAGE = 'A Studio Agent budget may only bind its canonical root turn.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_run_budgets_guard"
BEFORE INSERT OR UPDATE ON "studio_agent_run_budgets"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_root_budget"();

CREATE FUNCTION "studio_agent_guard_event_envelope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "expected_root_run_id" UUID;
  "expected_parent_run_id" UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_events_append_only_chk',
      MESSAGE = 'Studio Agent events are append-only.';
  END IF;

  SELECT "root_run_id", "parent_run_id"
    INTO "expected_root_run_id", "expected_parent_run_id"
    FROM "studio_agent_runs"
   WHERE "id" = NEW."run_id"
     AND "thread_id" = NEW."thread_id";

  IF NOT FOUND
    OR NEW."root_run_id" IS DISTINCT FROM "expected_root_run_id"
    OR NEW."parent_run_id" IS DISTINCT FROM "expected_parent_run_id"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_events_run_envelope_chk',
      MESSAGE = 'An event envelope must match its canonical run hierarchy.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_events_envelope_guard"
BEFORE INSERT OR UPDATE ON "studio_agent_events"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_event_envelope"();

-- A thread row is the serialized allocator for both canonical message order
-- and replay event order. Allocation and insert happen in one transaction,
-- while the unique (thread, ordinal/sequence) indexes reject duplicates.
--
-- Do not verify full-history contiguity in a row trigger: streaming emits many
-- events and a count/min/max scan per delta makes a thread O(n²) over its
-- lifetime. Full continuity belongs in an offline integrity audit.

CREATE FUNCTION "studio_agent_assert_active_run"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "affected_thread_id" UUID;
  "active_run_id_value" UUID;
  "active_run_kind" "StudioAgentRunKind";
  "active_run_status" "StudioAgentRunStatus";
  "active_root_run_id" UUID;
  "thread_status_value" "StudioAgentThreadStatus";
BEGIN
  IF TG_TABLE_NAME = 'studio_agent_threads' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    "affected_thread_id" := NEW."id";
  ELSE
    "affected_thread_id" := NEW."thread_id";
  END IF;

  SELECT "active_run_id", "status"
    INTO "active_run_id_value", "thread_status_value"
    FROM "studio_agent_threads"
   WHERE "id" = "affected_thread_id";

  IF NOT FOUND OR "active_run_id_value" IS NULL THEN
    RETURN NULL;
  END IF;

  IF "thread_status_value" <> 'active' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_threads_archived_idle_chk',
      MESSAGE = 'An archived Studio Agent thread cannot retain an active run.';
  END IF;

  SELECT "kind", "status", "root_run_id"
    INTO "active_run_kind", "active_run_status", "active_root_run_id"
    FROM "studio_agent_runs"
   WHERE "id" = "active_run_id_value"
     AND "thread_id" = "affected_thread_id";

  IF NOT FOUND
    OR "active_run_kind" <> 'turn'
    OR "active_root_run_id" <> "active_run_id_value"
    OR "active_run_status" NOT IN (
      'queued',
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'cancelling'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_threads_active_root_run_chk',
      MESSAGE = 'A thread activeRunId must reference its live root turn.';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "studio_agent_threads_active_run_consistency"
AFTER INSERT OR UPDATE ON "studio_agent_threads"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_active_run"();

CREATE CONSTRAINT TRIGGER "studio_agent_runs_active_thread_consistency"
AFTER INSERT OR UPDATE ON "studio_agent_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_active_run"();

-- Forward-only lifecycle guards ---------------------------------------------

CREATE FUNCTION "studio_agent_guard_message_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."client_message_id" IS DISTINCT FROM OLD."client_message_id"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR (
      NEW."run_id" IS DISTINCT FROM OLD."run_id"
      AND NOT (OLD."run_id" IS NULL AND NEW."run_id" IS NOT NULL)
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_messages_immutable_identity_chk',
      MESSAGE = 'Studio Agent message identity and ordering are immutable.';
  END IF;

  IF OLD."status" IN ('completed', 'failed', 'cancelled') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."parts" IS DISTINCT FROM OLD."parts"
      OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'studio_agent_messages_terminal_content_immutable_chk',
        MESSAGE = 'Terminal Studio Agent message content cannot be rewritten.';
    END IF;

    -- A submitted user message may be persisted before its root run in the
    -- same transaction, then gain the one-way run binding after run creation.
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'accepted' AND NEW."status" IN (
      'accepted', 'streaming', 'completed', 'failed', 'cancelled'
    ))
    OR
    (OLD."status" = 'streaming' AND NEW."status" IN (
      'streaming', 'completed', 'failed', 'cancelled'
    ))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_messages_forward_status_chk',
      MESSAGE = 'Studio Agent message status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_messages_update_guard"
BEFORE UPDATE ON "studio_agent_messages"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_message_update"();

CREATE FUNCTION "studio_agent_guard_run_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_terminal_immutable_chk',
      MESSAGE = 'A terminal Studio Agent run cannot be rewritten.';
  END IF;

  IF NOT (
    (OLD."status" = 'queued' AND NEW."status" IN (
      'queued', 'running', 'cancelling', 'failed', 'cancelled'
    ))
    OR
    (OLD."status" = 'running' AND NEW."status" IN (
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'cancelling',
      'succeeded',
      'failed',
      'cancelled'
    ))
    OR
    (OLD."status" IN ('waiting_for_approval', 'waiting_for_input')
      AND NEW."status" IN (
        'running', 'cancelling', 'succeeded', 'failed', 'cancelled'
      ))
    OR
    (OLD."status" = 'cancelling' AND NEW."status" IN (
      'cancelling', 'succeeded', 'failed', 'cancelled'
    ))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_runs_forward_status_chk',
      MESSAGE = 'Studio Agent run status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_runs_update_guard"
BEFORE UPDATE ON "studio_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_run_update"();

CREATE FUNCTION "studio_agent_guard_input_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR (
      NEW."target_run_id" IS DISTINCT FROM OLD."target_run_id"
      AND NOT (
        OLD."status" = 'accepted'
        AND NEW."status" = 'accepted'
        AND OLD."delivery" = 'enqueue'
        AND NEW."delivery" = 'enqueue'
      )
    )
    OR NEW."message_id" IS DISTINCT FROM OLD."message_id"
    OR NEW."delivery" IS DISTINCT FROM OLD."delivery"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."submission_scope_container" IS DISTINCT FROM OLD."submission_scope_container"
    OR NEW."submission_scope_focus" IS DISTINCT FROM OLD."submission_scope_focus"
    OR NEW."submission_locale" IS DISTINCT FROM OLD."submission_locale"
    OR NEW."accepted_at" IS DISTINCT FROM OLD."accepted_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_inputs_immutable_identity_chk',
      MESSAGE = 'Studio Agent input identity and delivery order are immutable outside accepted enqueue promotion.';
  END IF;

  IF OLD."status" IN ('consumed', 'promoted', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_inputs_terminal_immutable_chk',
      MESSAGE = 'A terminal Studio Agent input cannot be rewritten.';
  END IF;

  IF NOT (
    OLD."status" = 'accepted'
    AND NEW."status" IN ('accepted', 'consumed', 'promoted', 'cancelled')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_inputs_forward_status_chk',
      MESSAGE = 'Studio Agent input status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_inputs_update_guard"
BEFORE UPDATE ON "studio_agent_inputs"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_input_update"();

CREATE FUNCTION "studio_agent_guard_action_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
    OR NEW."step_id" IS DISTINCT FROM OLD."step_id"
    OR NEW."tool_call_id" IS DISTINCT FROM OLD."tool_call_id"
    OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id"
    OR NEW."capability_version" IS DISTINCT FROM OLD."capability_version"
    OR NEW."effect" IS DISTINCT FROM OLD."effect"
    OR NEW."risk" IS DISTINCT FROM OLD."risk"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."summary" IS DISTINCT FROM OLD."summary"
    OR NEW."target" IS DISTINCT FROM OLD."target"
    OR NEW."input" IS DISTINCT FROM OLD."input"
    OR NEW."input_hash" IS DISTINCT FROM OLD."input_hash"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_actions_immutable_intent_chk',
      MESSAGE = 'A prepared Studio Agent action intent is immutable.';
  END IF;

  IF OLD."status" IN ('succeeded', 'failed', 'denied', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_actions_terminal_immutable_chk',
      MESSAGE = 'A terminal Studio Agent action cannot be rewritten.';
  END IF;

  IF NOT (
    (OLD."status" = 'proposed' AND NEW."status" IN (
      'proposed',
      'waiting_for_approval',
      'queued',
      'running',
      'denied',
      'cancelled'
    ))
    OR
    (OLD."status" = 'waiting_for_approval' AND NEW."status" IN (
      'waiting_for_approval', 'queued', 'running', 'denied', 'cancelled'
    ))
    OR
    (OLD."status" = 'queued' AND NEW."status" IN (
      'queued', 'running', 'failed', 'cancelled'
    ))
    OR
    (OLD."status" = 'running' AND NEW."status" IN (
      'running', 'succeeded', 'failed', 'cancelled'
    ))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_actions_forward_status_chk',
      MESSAGE = 'Studio Agent action status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_actions_update_guard"
BEFORE UPDATE ON "studio_agent_actions"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_action_update"();

CREATE FUNCTION "studio_agent_guard_approval_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
    OR NEW."action_id" IS DISTINCT FROM OLD."action_id"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."action_input_hash" IS DISTINCT FROM OLD."action_input_hash"
    OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_approvals_immutable_challenge_chk',
      MESSAGE = 'A Studio Agent approval challenge is immutable.';
  END IF;

  IF OLD."status" <> 'pending' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_approvals_terminal_immutable_chk',
      MESSAGE = 'A resolved Studio Agent approval cannot be rewritten.';
  END IF;

  IF NEW."status" NOT IN (
    'pending', 'approved', 'denied', 'expired', 'cancelled'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_approvals_forward_status_chk',
      MESSAGE = 'Studio Agent approval status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_approvals_update_guard"
BEFORE UPDATE ON "studio_agent_approvals"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_approval_update"();

CREATE FUNCTION "studio_agent_guard_command_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
    OR NEW."input_id" IS DISTINCT FROM OLD."input_id"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_commands_immutable_intent_chk',
      MESSAGE = 'A Studio Agent outbox command intent is immutable.';
  END IF;

  IF OLD."status" IN ('dispatched', 'dead_letter') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_commands_terminal_immutable_chk',
      MESSAGE = 'A terminal Studio Agent outbox command cannot be rewritten.';
  END IF;

  IF NOT (
    OLD."status" = 'pending'
    AND NEW."status" IN ('pending', 'dispatched', 'dead_letter')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_commands_forward_status_chk',
      MESSAGE = 'Studio Agent outbox command status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_commands_update_guard"
BEFORE UPDATE ON "studio_agent_command_outbox"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_command_update"();

CREATE FUNCTION "studio_agent_guard_artifact_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR (
      NEW."run_id" IS DISTINCT FROM OLD."run_id"
      AND NOT (OLD."run_id" IS NULL AND NEW."run_id" IS NOT NULL)
    )
    OR (
      NEW."message_id" IS DISTINCT FROM OLD."message_id"
      AND NOT (OLD."message_id" IS NULL AND NEW."message_id" IS NOT NULL)
    )
    OR (
      NEW."action_id" IS DISTINCT FROM OLD."action_id"
      AND NOT (OLD."action_id" IS NULL AND NEW."action_id" IS NOT NULL)
    )
    OR NEW."created_by_actor_id" IS DISTINCT FROM OLD."created_by_actor_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_artifacts_immutable_identity_chk',
      MESSAGE = 'Studio Agent artifact identity is immutable.';
  END IF;

  IF OLD."status" IN ('ready', 'failed') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."media_asset_id" IS DISTINCT FROM OLD."media_asset_id"
      OR NEW."value" IS DISTINCT FROM OLD."value"
      OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
      OR NEW."ready_at" IS DISTINCT FROM OLD."ready_at"
      OR NEW."error" IS DISTINCT FROM OLD."error"
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'studio_agent_artifacts_terminal_content_immutable_chk',
        MESSAGE = 'Terminal Studio Agent artifact content cannot be rewritten.';
    END IF;

    -- A composer upload may finish before its eventual message/run exists.
    -- Binding those one-way nullable associations does not mutate content.
    RETURN NEW;
  END IF;

  IF NOT (
    OLD."status" = 'pending'
    AND NEW."status" IN ('pending', 'ready', 'failed')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_artifacts_forward_status_chk',
      MESSAGE = 'Studio Agent artifact status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_artifacts_update_guard"
BEFORE UPDATE ON "studio_agent_artifacts"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_artifact_update"();

CREATE FUNCTION "studio_agent_guard_model_attempt_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
    OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
    OR NEW."step_id" IS DISTINCT FROM OLD."step_id"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."assistant_message_id" IS DISTINCT FROM OLD."assistant_message_id"
    OR NEW."segment_id" IS DISTINCT FROM OLD."segment_id"
    OR NEW."context_plan" IS DISTINCT FROM OLD."context_plan"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model_id" IS DISTINCT FROM OLD."model_id"
    OR NEW."reserved_token_units" IS DISTINCT FROM OLD."reserved_token_units"
    OR NEW."reserved_output_token_units" IS DISTINCT FROM OLD."reserved_output_token_units"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_model_attempts_immutable_identity_chk',
      MESSAGE = 'Studio Agent model-attempt identity is immutable.';
  END IF;

  IF OLD."status" <> 'running' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_model_attempts_terminal_immutable_chk',
      MESSAGE = 'A terminal Studio Agent model attempt cannot be rewritten.';
  END IF;

  IF NEW."status" NOT IN ('running', 'succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_model_attempts_forward_status_chk',
      MESSAGE = 'Studio Agent model-attempt status transitions are forward-only.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_model_attempts_update_guard"
BEFORE UPDATE ON "studio_agent_model_attempts"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_model_attempt_update"();

CREATE FUNCTION "studio_agent_guard_thread_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."surface_id" IS DISTINCT FROM OLD."surface_id"
    OR NEW."scenario_id" IS DISTINCT FROM OLD."scenario_id"
    OR NEW."scenario_version" IS DISTINCT FROM OLD."scenario_version"
    OR NEW."scope_container"->>'resourceType'
      IS DISTINCT FROM OLD."scope_container"->>'resourceType'
    OR NEW."scope_container"->>'resourceId'
      IS DISTINCT FROM OLD."scope_container"->>'resourceId'
    OR NEW."scope_key" IS DISTINCT FROM OLD."scope_key"
    OR NEW."scope_focus" IS DISTINCT FROM OLD."scope_focus"
    OR NEW."locale" IS DISTINCT FROM OLD."locale"
    OR NEW."owner_actor_id" IS DISTINCT FROM OLD."owner_actor_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_threads_immutable_identity_chk',
      MESSAGE = 'Studio Agent thread ownership and container identity are immutable.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_threads_update_guard"
BEFORE UPDATE ON "studio_agent_threads"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_thread_update"();

-- Approval authority is bound to an immutable action-input digest. Action and
-- approval transitions are committed together so reconnect never observes a
-- decision that authorizes different bytes or a contradictory action state.
CREATE FUNCTION "studio_agent_assert_approval_action"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "affected_action_id" UUID;
  "action_status_value" "StudioAgentActionStatus";
  "action_input_hash_value" VARCHAR(64);
  "approval_status_value" "StudioAgentApprovalStatus";
  "approval_input_hash_value" VARCHAR(64);
BEGIN
  IF TG_TABLE_NAME = 'studio_agent_actions' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    "affected_action_id" := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    "affected_action_id" := OLD."action_id";
  ELSE
    "affected_action_id" := NEW."action_id";
  END IF;

  SELECT "status", "input_hash"
    INTO "action_status_value", "action_input_hash_value"
    FROM "studio_agent_actions"
   WHERE "id" = "affected_action_id";

  -- Cascading action deletion legitimately removes its approval.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT "status", "action_input_hash"
    INTO "approval_status_value", "approval_input_hash_value"
    FROM "studio_agent_approvals"
   WHERE "action_id" = "affected_action_id";

  IF NOT FOUND THEN
    IF "action_status_value" = 'waiting_for_approval' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'studio_agent_actions_waiting_approval_chk',
        MESSAGE = 'An action waiting for approval must own one pending approval.';
    END IF;
    RETURN NULL;
  END IF;

  IF "approval_input_hash_value" <> "action_input_hash_value" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_approvals_action_hash_chk',
      MESSAGE = 'Approval authority does not match the immutable action input.';
  END IF;

  IF (
    "approval_status_value" = 'pending'
    AND "action_status_value" <> 'waiting_for_approval'
  ) OR (
    "approval_status_value" = 'approved'
    AND "action_status_value" NOT IN (
      'queued', 'running', 'succeeded', 'failed', 'cancelled'
    )
  ) OR (
    "approval_status_value" = 'denied'
    AND "action_status_value" <> 'denied'
  ) OR (
    "approval_status_value" IN ('expired', 'cancelled')
    AND "action_status_value" <> 'cancelled'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_approvals_action_state_chk',
      MESSAGE = 'Approval and action lifecycle states must be committed atomically.';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "studio_agent_actions_approval_consistency"
AFTER INSERT OR UPDATE ON "studio_agent_actions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_approval_action"();

CREATE CONSTRAINT TRIGGER "studio_agent_approvals_action_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "studio_agent_approvals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_approval_action"();

CREATE FUNCTION "studio_agent_guard_artifact_workspace"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "artifact_workspace_id" UUID;
  "asset_workspace_id" UUID;
BEGIN
  IF NEW."media_asset_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "workspace_id"
    INTO "artifact_workspace_id"
    FROM "studio_agent_threads"
   WHERE "id" = NEW."thread_id";

  SELECT "workspace_id"
    INTO "asset_workspace_id"
    FROM "media_assets"
   WHERE "id" = NEW."media_asset_id";

  IF "artifact_workspace_id" IS NULL
    OR "asset_workspace_id" IS NULL
    OR "artifact_workspace_id" <> "asset_workspace_id"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_artifacts_media_workspace_chk',
      MESSAGE = 'A Studio Agent artifact can only reference media owned by its workspace.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_artifacts_workspace_guard"
BEFORE INSERT OR UPDATE OF "thread_id", "media_asset_id"
ON "studio_agent_artifacts"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_artifact_workspace"();

CREATE FUNCTION "studio_agent_guard_context_checkpoint"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "expected_revision" INTEGER;
  "event_run_id" UUID;
  "event_type" VARCHAR(96);
  "event_payload" JSONB;
  "covered_ordinal" BIGINT;
  "covered_run_id" UUID;
  "covered_run_kind" "StudioAgentRunKind";
  "scope_boundary" BIGINT;
  "attempt_thread_id" UUID;
  "attempt_run_id" UUID;
  "attempt_purpose" "StudioAgentModelAttemptPurpose";
  "attempt_status" "StudioAgentModelAttemptStatus";
  "attempt_plan" JSONB;
  "previous_scope" "StudioAgentContextCheckpointScope";
  "previous_scope_run_id" UUID;
  "previous_covered_ordinal" BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_immutable_chk',
      MESSAGE = 'Studio Agent context checkpoints are immutable.';
  END IF;

  IF NEW."scope" = 'thread_prefix' THEN
    SELECT COALESCE(max("revision"), 0) + 1
      INTO "expected_revision"
      FROM "studio_agent_context_checkpoints"
     WHERE "thread_id" = NEW."thread_id"
       AND "scope" = 'thread_prefix';
  ELSE
    SELECT COALESCE(max("revision"), 0) + 1
      INTO "expected_revision"
      FROM "studio_agent_context_checkpoints"
     WHERE "scope" = 'run_suffix'
       AND "scope_run_id" = NEW."scope_run_id";
  END IF;

  IF NEW."revision" <> "expected_revision" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_contiguous_revision_chk',
      MESSAGE = 'Context checkpoint revisions must be contiguous from one.';
  END IF;

  SELECT "run_id", "type", "payload"
    INTO "event_run_id", "event_type", "event_payload"
    FROM "studio_agent_events"
   WHERE "thread_id" = NEW."thread_id"
     AND "sequence" = NEW."source_event_sequence";

  IF NOT FOUND
    OR "event_run_id" <> NEW."producer_run_id"
    OR "event_type" <> 'context.compacted'
    OR "event_payload"->>'checkpointId' <> NEW."id"::text
    OR "event_payload"->>'scope' <> NEW."scope"::text
    OR "event_payload"->>'coveredThroughMessageId'
      <> NEW."covered_through_message_id"::text
    OR "event_payload"->>'coveredMessageCount'
      <> NEW."covered_message_count"::text
    OR "event_payload"->>'retainedMessageCount'
      <> NEW."retained_message_count"::text
    OR "event_payload"->>'summaryHash' <> NEW."summary_hash"
    OR "event_payload"->>'sourceHash' <> NEW."source_hash"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_source_event_chk',
      MESSAGE = 'A context checkpoint must exactly match its context.compacted event.';
  END IF;

  SELECT "message"."ordinal", "message"."run_id", "run"."kind"
    INTO "covered_ordinal", "covered_run_id", "covered_run_kind"
    FROM "studio_agent_messages" AS "message"
    LEFT JOIN "studio_agent_runs" AS "run"
      ON "run"."id" = "message"."run_id"
     AND "run"."thread_id" = "message"."thread_id"
   WHERE "message"."id" = NEW."covered_through_message_id"
     AND "message"."thread_id" = NEW."thread_id";

  IF "covered_ordinal" IS NULL
    OR (
      NEW."scope" = 'thread_prefix'
      AND "covered_run_kind" IS DISTINCT FROM 'turn'
    )
    OR (
      NEW."scope" = 'run_suffix'
      AND "covered_run_id" IS DISTINCT FROM NEW."scope_run_id"
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_coverage_chk',
      MESSAGE = 'A context checkpoint may only cover messages in its declared scope.';
  END IF;

  IF NEW."scope" = 'run_suffix' THEN
    SELECT "context_boundary_ordinal"
      INTO "scope_boundary"
      FROM "studio_agent_runs"
     WHERE "id" = NEW."scope_run_id"
       AND "thread_id" = NEW."thread_id"
       AND "kind" = 'task';

    IF NOT FOUND OR "scope_boundary" IS DISTINCT FROM NEW."boundary_ordinal" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'studio_agent_checkpoints_boundary_chk',
        MESSAGE = 'A run-suffix checkpoint must preserve its task context boundary.';
    END IF;
  END IF;

  SELECT "thread_id", "run_id", "purpose", "status", "context_plan"
    INTO "attempt_thread_id", "attempt_run_id", "attempt_purpose", "attempt_status", "attempt_plan"
    FROM "studio_agent_model_attempts"
   WHERE "id" = NEW."model_attempt_id";

  IF NOT FOUND
    OR "attempt_thread_id" <> NEW."thread_id"
    OR "attempt_run_id" <> NEW."producer_run_id"
    OR "attempt_purpose" <> 'context_compaction'
    OR "attempt_status" <> 'succeeded'
    OR "attempt_plan"->>'checkpointId' <> NEW."id"::text
    OR "attempt_plan"->>'scope' <> NEW."scope"::text
    OR "attempt_plan"->>'sourceHash' <> NEW."source_hash"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_attempt_chk',
      MESSAGE = 'A context checkpoint must be the terminal result of its declared compaction attempt.';
  END IF;

  IF encode(digest(convert_to(NEW."summary_text", 'UTF8'), 'sha256'), 'hex')
    <> NEW."summary_hash"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_summary_hash_chk',
      MESSAGE = 'A context checkpoint summary hash must match its exact summary text.';
  END IF;

  IF NEW."previous_checkpoint_id" IS NOT NULL THEN
    SELECT
      "checkpoint"."scope",
      "checkpoint"."scope_run_id",
      "message"."ordinal"
      INTO "previous_scope", "previous_scope_run_id", "previous_covered_ordinal"
      FROM "studio_agent_context_checkpoints" AS "checkpoint"
      JOIN "studio_agent_messages" AS "message"
        ON "message"."id" = "checkpoint"."covered_through_message_id"
       AND "message"."thread_id" = "checkpoint"."thread_id"
     WHERE "checkpoint"."id" = NEW."previous_checkpoint_id"
       AND "checkpoint"."thread_id" = NEW."thread_id";

    IF NOT FOUND
      OR "previous_scope" <> NEW."scope"
      OR "previous_scope_run_id" IS DISTINCT FROM NEW."scope_run_id"
      OR NEW."revision" <= 1
      OR "previous_covered_ordinal" >= "covered_ordinal"
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'studio_agent_checkpoints_chain_chk',
        MESSAGE = 'A context checkpoint chain must advance within one immutable scope.';
    END IF;
  ELSIF NEW."revision" <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_checkpoints_chain_chk',
      MESSAGE = 'Every checkpoint revision after one must identify its predecessor.';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "studio_agent_context_checkpoints_guard"
BEFORE INSERT OR UPDATE ON "studio_agent_context_checkpoints"
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_guard_context_checkpoint"();

-- A failed/cancelled run cannot strand an approval prompt. Runtime transition
-- commands settle pending approvals and their unresolved actions in the same
-- transaction; this deferred check observes only the committed end state.
CREATE FUNCTION "studio_agent_assert_terminal_run_settled"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "affected_run_id" UUID;
  "run_status_value" "StudioAgentRunStatus";
BEGIN
  IF TG_TABLE_NAME = 'studio_agent_runs' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    "affected_run_id" := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    "affected_run_id" := OLD."run_id";
  ELSE
    "affected_run_id" := NEW."run_id";
  END IF;

  SELECT "status"
    INTO "run_status_value"
    FROM "studio_agent_runs"
   WHERE "id" = "affected_run_id";

  IF NOT FOUND OR "run_status_value" NOT IN ('failed', 'cancelled') THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "studio_agent_approvals"
     WHERE "run_id" = "affected_run_id"
       AND "status" = 'pending'
  ) OR EXISTS (
    SELECT 1
      FROM "studio_agent_actions"
     WHERE "run_id" = "affected_run_id"
       AND "status" IN ('proposed', 'waiting_for_approval')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'studio_agent_terminal_run_settlement_chk',
      MESSAGE = 'A failed or cancelled run cannot retain unresolved actions or approvals.';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "studio_agent_runs_terminal_settlement"
AFTER INSERT OR UPDATE ON "studio_agent_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_terminal_run_settled"();

CREATE CONSTRAINT TRIGGER "studio_agent_actions_terminal_run_settlement"
AFTER INSERT OR UPDATE OR DELETE ON "studio_agent_actions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_terminal_run_settled"();

CREATE CONSTRAINT TRIGGER "studio_agent_approvals_terminal_run_settlement"
AFTER INSERT OR UPDATE OR DELETE ON "studio_agent_approvals"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "studio_agent_assert_terminal_run_settled"();

COMMIT;
