-- Agent OS event history is an append-only journal. The run row remains the
-- lifecycle projection; immutable envelopes move out of the replaceable JSON
-- snapshot so late worker reports cannot erase newer turns or external-job
-- continuations.
CREATE TABLE "agent_os_run_events" (
    "id" VARCHAR(128) NOT NULL,
    "run_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "protocol_version" VARCHAR(32) NOT NULL,
    "session_id" VARCHAR(180) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "realtime_published_at" TIMESTAMPTZ(6),
    "realtime_publish_attempts" INTEGER NOT NULL DEFAULT 0,
    "realtime_publish_last_error" TEXT,

    CONSTRAINT "agent_os_run_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_os_run_events_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "agent_os_runs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_os_run_events_run_sequence_unique"
  ON "agent_os_run_events"("run_id", "sequence");

CREATE INDEX "agent_os_run_events_conversation_timeline_idx"
  ON "agent_os_run_events"("conversation_id", "occurred_at", "id");

CREATE INDEX "agent_os_run_events_realtime_pending_idx"
  ON "agent_os_run_events"("recorded_at", "run_id", "sequence")
  WHERE "realtime_published_at" IS NULL;

ALTER TABLE "agent_os_runs"
  ADD COLUMN "realtime_publish_lease_id" UUID,
  ADD COLUMN "realtime_publish_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "realtime_snapshot_sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pending_external" JSONB,
  ADD COLUMN "input_response_id" UUID,
  ADD COLUMN "input_request_id" UUID,
  ADD COLUMN "input_answers_fingerprint" VARCHAR(64),
  ADD COLUMN "input_response_lease_id" UUID,
  ADD COLUMN "input_response_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "start_command" JSONB,
  ADD COLUMN "start_dispatch_lease_id" UUID,
  ADD COLUMN "start_dispatch_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "start_dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "start_dispatch_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "start_dispatch_last_error" TEXT,
  ADD COLUMN "start_dispatched_at" TIMESTAMPTZ(6);

ALTER TABLE "agent_os_runs"
  ADD CONSTRAINT "agent_os_runs_input_response_claim_complete_check"
  CHECK (
    ("input_response_id" IS NULL
      AND "input_request_id" IS NULL
      AND "input_answers_fingerprint" IS NULL
      AND "input_response_lease_id" IS NULL
      AND "input_response_lease_expires_at" IS NULL)
    OR
    ("input_response_id" IS NOT NULL
      AND "input_request_id" IS NOT NULL
      AND "input_answers_fingerprint" IS NOT NULL
      AND "input_response_lease_id" IS NOT NULL
      AND "input_response_lease_expires_at" IS NOT NULL)
  );

CREATE INDEX "agent_os_runs_start_dispatch_pending_idx"
  ON "agent_os_runs"("start_dispatch_next_attempt_at", "created_at", "id")
  WHERE "start_command" IS NOT NULL
    AND "start_dispatched_at" IS NULL;

-- A conversation is the LangGraph checkpoint thread. Multiple live runs in
-- one thread would interleave checkpoints, so this is a database invariant in
-- addition to the Gateway's advisory-lock admission check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_os_runs"
    WHERE "status" IN (
      'queued',
      'running',
      'waiting_for_approval',
      'waiting_for_input',
      'waiting_for_external',
      'paused'
    )
    GROUP BY "conversation_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce Agent OS single-active-run invariant',
      DETAIL = 'One or more conversations contain multiple active agent_os_runs. Resolve those runs explicitly before retrying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "agent_os_runs_conversation_active_unique"
  ON "agent_os_runs" ("conversation_id")
  WHERE "status" IN (
    'queued',
    'running',
    'waiting_for_approval',
    'waiting_for_input',
    'waiting_for_external',
    'paused'
  );

-- Preserve every historical envelope before removing the replaceable
-- snapshot. These fields were required by fizz.agent.v1, so malformed rows
-- must stop the migration instead of being rewritten into invented events.
-- That keeps corruption observable and makes a restore/replay failure
-- impossible to postpone until after deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_os_runs"
    WHERE jsonb_typeof("events") IS DISTINCT FROM 'array'
       OR "last_sequence" < 0
       OR jsonb_array_length("events") <> "last_sequence"
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot migrate malformed Agent OS journal snapshots',
      DETAIL = 'events must be an array whose length exactly equals last_sequence.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_os_runs" AS run
    CROSS JOIN LATERAL jsonb_array_elements(run."events") WITH ORDINALITY AS item(event, ordinal)
    WHERE jsonb_typeof(item.event) IS DISTINCT FROM 'object'
       OR COALESCE(item.event ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR item.event ->> 'runId' IS DISTINCT FROM run."id"::text
       OR item.event ->> 'conversationId' IS DISTINCT FROM run."conversation_id"::text
       OR COALESCE(item.event ->> 'sequence', '') !~ '^[1-9][0-9]*$'
       OR (item.event ->> 'sequence')::integer <> item.ordinal
       OR COALESCE(item.event ->> 'protocolVersion', '') = ''
       OR length(item.event ->> 'protocolVersion') > 32
       OR COALESCE(item.event ->> 'sessionId', '') = ''
       OR length(item.event ->> 'sessionId') > 180
       OR COALESCE(item.event ->> 'type', '') = ''
       OR length(item.event ->> 'type') > 64
       OR jsonb_typeof(item.event -> 'data') IS DISTINCT FROM 'object'
       OR NOT COALESCE(pg_input_is_valid(item.event ->> 'timestamp', 'timestamp with time zone'), FALSE)
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot migrate invalid Agent OS event envelopes',
      DETAIL = 'Every event must preserve its parent run/conversation identity, contiguous ordinal sequence, protocol fields, object data, UUID id, and valid timestamp.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT item.event ->> 'id'
    FROM "agent_os_runs" AS run
    CROSS JOIN LATERAL jsonb_array_elements(run."events") AS item(event)
    GROUP BY item.event ->> 'id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot migrate duplicate Agent OS event ids',
      DETAIL = 'Event ids are globally immutable idempotency keys and must be unique before backfill.';
  END IF;
END $$;

INSERT INTO "agent_os_run_events" (
  "id",
  "run_id",
  "conversation_id",
  "sequence",
  "protocol_version",
  "session_id",
  "type",
  "data",
  "occurred_at",
  "realtime_published_at"
)
SELECT
  item.event ->> 'id',
  run."id",
  (item.event ->> 'conversationId')::uuid,
  (item.event ->> 'sequence')::integer,
  item.event ->> 'protocolVersion',
  item.event ->> 'sessionId',
  item.event ->> 'type',
  item.event -> 'data',
  (item.event ->> 'timestamp')::timestamptz,
  NOW()
FROM "agent_os_runs" AS run
CROSS JOIN LATERAL jsonb_array_elements(run."events") AS item(event);

-- Historical snapshots were already served by the previous transport. Do not
-- replay the entire product history into realtime during deployment; reconnect
-- remains available from the migrated journal immediately.
UPDATE "agent_os_runs"
SET "realtime_snapshot_sequence" = "last_sequence";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_os_runs" AS run
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS event_count, MAX(event."sequence") AS maximum_sequence
      FROM "agent_os_run_events" AS event
      WHERE event."run_id" = run."id"
    ) AS journal ON TRUE
    WHERE COALESCE(journal.event_count, 0) <> run."last_sequence"
       OR COALESCE(journal.maximum_sequence, 0) <> run."last_sequence"
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Agent OS append-only journal backfill verification failed',
      DETAIL = 'At least one run is missing a migrated event or has an incorrect sequence tail; the source JSON column will not be dropped.';
  END IF;
END $$;

ALTER TABLE "agent_os_runs" DROP COLUMN "events";
