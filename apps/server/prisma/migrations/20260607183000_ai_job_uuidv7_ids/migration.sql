-- Switch AI job primary identifiers from legacy text IDs to UUID storage.
--
-- Old pre-launch rows used short random strings such as `ruG0esWqtObx`.
-- They cannot be cast to uuid, so this migration builds an in-memory
-- old-id -> UUIDv7 map and rewrites all AI runtime/evidence foreign keys
-- through that map. Valid UUID-looking IDs are preserved as-is, which makes
-- the migration safe for partially upgraded dev/preprod databases.
--
-- No AI job, attempt, output, cost, provider event, trace, or outbox row is
-- intentionally deleted by this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pg_temp._fizzdragon_uuidv7_from_timestamptz(input_ts TIMESTAMPTZ)
RETURNS UUID AS $$
DECLARE
  unix_ms BIGINT;
  timestamp_hex TEXT;
  random_hex TEXT;
  variant_hex TEXT;
BEGIN
  unix_ms := FLOOR(EXTRACT(EPOCH FROM input_ts) * 1000)::BIGINT;
  timestamp_hex := LPAD(TO_HEX(unix_ms), 12, '0');
  random_hex := ENCODE(gen_random_bytes(10), 'hex');
  variant_hex := SUBSTRING('89ab' FROM ((get_byte(gen_random_bytes(1), 0) % 4) + 1) FOR 1);

  RETURN (
    SUBSTRING(timestamp_hex FROM 1 FOR 8) || '-' ||
    SUBSTRING(timestamp_hex FROM 9 FOR 4) || '-' ||
    '7' || SUBSTRING(random_hex FROM 1 FOR 3) || '-' ||
    variant_hex || SUBSTRING(random_hex FROM 4 FOR 3) || '-' ||
    SUBSTRING(random_hex FROM 7 FOR 12)
  )::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TEMP TABLE _ai_job_uuidv7_id_map (
  old_id TEXT PRIMARY KEY,
  new_id UUID NOT NULL UNIQUE
);

INSERT INTO _ai_job_uuidv7_id_map (old_id, new_id)
SELECT
  "id" AS old_id,
  CASE
    WHEN "id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN "id"::UUID
    ELSE pg_temp._fizzdragon_uuidv7_from_timestamptz(COALESCE("created_at", clock_timestamp()))
  END AS new_id
FROM "ai_jobs";

CREATE OR REPLACE FUNCTION pg_temp._map_ai_job_id_required(old_job_id TEXT)
RETURNS UUID AS $$
DECLARE
  mapped_id UUID;
BEGIN
  SELECT new_id INTO mapped_id
  FROM _ai_job_uuidv7_id_map
  WHERE old_id = old_job_id;

  IF mapped_id IS NULL THEN
    RAISE EXCEPTION 'Cannot map AI job id % to UUID during migration.', old_job_id;
  END IF;

  RETURN mapped_id;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION pg_temp._map_ai_job_id_optional(old_job_id TEXT)
RETURNS UUID AS $$
DECLARE
  mapped_id UUID;
BEGIN
  IF old_job_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT new_id INTO mapped_id
  FROM _ai_job_uuidv7_id_map
  WHERE old_id = old_job_id;

  RETURN mapped_id;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE "ai_event_outbox" DROP CONSTRAINT IF EXISTS "ai_event_outbox_job_id_fkey";
ALTER TABLE "ai_provider_trace_events" DROP CONSTRAINT IF EXISTS "ai_provider_trace_events_job_id_fkey";
ALTER TABLE "ai_cost_ledger_entries" DROP CONSTRAINT IF EXISTS "ai_cost_ledger_entries_job_id_fkey";
ALTER TABLE "ai_attempts" DROP CONSTRAINT IF EXISTS "ai_attempts_job_id_fkey";
ALTER TABLE "ai_outputs" DROP CONSTRAINT IF EXISTS "ai_outputs_job_id_fkey";

ALTER TABLE "ai_jobs"
  ALTER COLUMN "id" TYPE UUID USING pg_temp._map_ai_job_id_required("id"),
  ALTER COLUMN "retry_of_job_id" TYPE UUID USING pg_temp._map_ai_job_id_optional("retry_of_job_id");

ALTER TABLE "ai_event_outbox"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_required("job_id");

ALTER TABLE "ai_provider_trace_events"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_required("job_id");

ALTER TABLE "ai_cost_ledger_entries"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_required("job_id");

ALTER TABLE "ai_attempts"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_required("job_id");

ALTER TABLE "ai_outputs"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_required("job_id");

ALTER TABLE "ai_provider_events"
  ALTER COLUMN "job_id" TYPE UUID USING pg_temp._map_ai_job_id_optional("job_id");

ALTER TABLE "ai_event_outbox"
  ADD CONSTRAINT "ai_event_outbox_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_trace_events"
  ADD CONSTRAINT "ai_provider_trace_events_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_cost_ledger_entries"
  ADD CONSTRAINT "ai_cost_ledger_entries_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_attempts"
  ADD CONSTRAINT "ai_attempts_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_outputs"
  ADD CONSTRAINT "ai_outputs_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
