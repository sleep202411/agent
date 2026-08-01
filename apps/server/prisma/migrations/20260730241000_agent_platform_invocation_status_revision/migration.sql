-- A global monotonic revision lets reconnecting clients reconcile invocation
-- aggregates incrementally without polling hundreds of historical rows.
CREATE SEQUENCE "agent_platform_invocation_status_revision_seq" AS BIGINT;

ALTER TABLE "agent_platform_invocations"
  ADD COLUMN "status_revision" BIGINT NOT NULL
    DEFAULT nextval('"agent_platform_invocation_status_revision_seq"');

-- Pre-boundary development rows may contain raw infrastructure messages.
-- Replace them with the stable public wire shape before strict projection is
-- enabled. The original details remain available in historical telemetry.
UPDATE "agent_platform_invocations"
SET "error" = jsonb_build_object(
  'code', CASE
    WHEN ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
      THEN "error"->>'code'
    ELSE 'AGENT_RUNTIME_FAILED'
  END,
  'messageKey', 'agent.error.runtime_failed',
  'message', 'StoryOS could not complete this request. Please retry.',
  'retryable', COALESCE(("error"->>'retryable')::boolean, true),
  'diagnosticId', gen_random_uuid()
)
WHERE "error" IS NOT NULL
  AND NOT (
    jsonb_typeof("error") = 'object'
    AND (
      "error" - ARRAY[
        'code',
        'messageKey',
        'message',
        'retryable',
        'diagnosticId'
      ]::TEXT[]
    ) = '{}'::JSONB
    AND ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
    AND ("error"->>'messageKey') ~ '^[a-z][a-z0-9_.-]{0,127}$'
    AND char_length("error"->>'message') BETWEEN 1 AND 1000
    AND jsonb_typeof("error"->'retryable') = 'boolean'
    AND ("error"->>'diagnosticId') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

UPDATE "agent_platform_invocation_attempts"
SET "error" = jsonb_build_object(
  'code', CASE
    WHEN ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
      THEN "error"->>'code'
    ELSE 'AGENT_PLATFORM_REQUEST_FAILED'
  END,
  'messageKey', 'agent.error.service_unavailable',
  'message', 'StoryOS could not accept this request. Please retry shortly.',
  'retryable', COALESCE(("error"->>'retryable')::boolean, true),
  'diagnosticId', "id"
)
WHERE "error" IS NOT NULL
  AND NOT (
    jsonb_typeof("error") = 'object'
    AND (
      "error" - ARRAY[
        'code',
        'messageKey',
        'message',
        'retryable',
        'diagnosticId'
      ]::TEXT[]
    ) = '{}'::JSONB
    AND ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
    AND ("error"->>'messageKey') ~ '^[a-z][a-z0-9_.-]{0,127}$'
    AND char_length("error"->>'message') BETWEEN 1 AND 1000
    AND jsonb_typeof("error"->'retryable') = 'boolean'
    AND ("error"->>'diagnosticId') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

ALTER TABLE "agent_platform_invocations"
  DROP CONSTRAINT "agent_platform_invocations_error_check",
  ADD CONSTRAINT "agent_platform_invocations_error_check"
    CHECK (
      (
        "status" IN ('rejected', 'failed')
        AND jsonb_typeof("error") = 'object'
        AND (
          "error" - ARRAY[
            'code',
            'messageKey',
            'message',
            'retryable',
            'diagnosticId'
          ]::TEXT[]
        ) = '{}'::jsonb
        AND ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
        AND ("error"->>'messageKey') ~ '^[a-z][a-z0-9_.-]{0,127}$'
        AND char_length("error"->>'message') BETWEEN 1 AND 1000
        AND jsonb_typeof("error"->'retryable') = 'boolean'
        AND ("error"->>'diagnosticId') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      OR
      (
        "status" NOT IN ('rejected', 'failed')
        AND "error" IS NULL
      )
    );

ALTER TABLE "agent_platform_invocation_attempts"
  DROP CONSTRAINT "agent_platform_invocation_attempts_error_check",
  ADD CONSTRAINT "agent_platform_invocation_attempts_error_check"
    CHECK (
      (
        "status" = 'rejected'
        AND jsonb_typeof("error") = 'object'
        AND (
          "error" - ARRAY[
            'code',
            'messageKey',
            'message',
            'retryable',
            'diagnosticId'
          ]::TEXT[]
        ) = '{}'::jsonb
        AND ("error"->>'code') ~ '^[A-Z][A-Z0-9_]{0,127}$'
        AND ("error"->>'messageKey') ~ '^[a-z][a-z0-9_.-]{0,127}$'
        AND char_length("error"->>'message') BETWEEN 1 AND 1000
        AND jsonb_typeof("error"->'retryable') = 'boolean'
        AND ("error"->>'diagnosticId') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      OR
      ("status" <> 'rejected' AND "error" IS NULL)
    );

CREATE INDEX "agent_platform_invocations_conversation_revision_idx"
  ON "agent_platform_invocations" ("conversation_id", "status_revision");

CREATE OR REPLACE FUNCTION "bump_agent_platform_invocation_status_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR ROW(
      NEW."input_event_id",
      NEW."client_message_id",
      NEW."provisional_run_id",
      NEW."latest_attempt_ordinal",
      NEW."status",
      NEW."error",
      NEW."started_at",
      NEW."completed_at"
    ) IS DISTINCT FROM ROW(
      OLD."input_event_id",
      OLD."client_message_id",
      OLD."provisional_run_id",
      OLD."latest_attempt_ordinal",
      OLD."status",
      OLD."error",
      OLD."started_at",
      OLD."completed_at"
    )
  THEN
    NEW."status_revision" :=
      nextval('"agent_platform_invocation_status_revision_seq"');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_platform_invocations_status_revision_trigger"
BEFORE INSERT OR UPDATE OF
  "input_event_id",
  "client_message_id",
  "provisional_run_id",
  "latest_attempt_ordinal",
  "status",
  "error",
  "started_at",
  "completed_at"
ON "agent_platform_invocations"
FOR EACH ROW
EXECUTE FUNCTION "bump_agent_platform_invocation_status_revision"();

-- Trigger delivery is part of the user-visible Run state even when the
-- aggregate remains waiting_for_approval. Advancing the aggregate revision
-- makes admitting/dispatched/rejected continuation state incrementally
-- observable without inventing transcript messages.
CREATE OR REPLACE FUNCTION "bump_agent_invocation_revision_from_attempt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "agent_platform_invocations"
  SET "status_revision" =
    nextval('"agent_platform_invocation_status_revision_seq"')
  WHERE "id" = NEW."invocation_id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_platform_invocation_attempts_revision_trigger"
AFTER INSERT OR UPDATE OF "status", "error"
ON "agent_platform_invocation_attempts"
FOR EACH ROW
EXECUTE FUNCTION "bump_agent_invocation_revision_from_attempt"();
