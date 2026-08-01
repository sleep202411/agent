-- The Agent Domain Gateway needs one durable receipt per accepted command.
-- Successful receipts share the exact transaction of the business mutation,
-- making Temporal activity retries exactly-once from the product's point of
-- view. Rejections are persisted separately under the same advisory lock.
CREATE TABLE "agent_domain_commands" (
  "idempotency_key" VARCHAR(256) NOT NULL,
  "tool_id" VARCHAR(128) NOT NULL,
  "actor_id" VARCHAR(128) NOT NULL,
  "surface" VARCHAR(64) NOT NULL,
  "scope_key" VARCHAR(512) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "request" JSONB NOT NULL,
  "http_status" INTEGER NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "agent_domain_commands_pkey" PRIMARY KEY ("idempotency_key"),
  CONSTRAINT "agent_domain_commands_http_status_check"
    CHECK ("http_status" BETWEEN 200 AND 499),
  CONSTRAINT "agent_domain_commands_request_hash_check"
    CHECK ("request_hash" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "agent_domain_commands_actor_recent_idx"
  ON "agent_domain_commands" ("actor_id", "created_at" DESC);

CREATE INDEX "agent_domain_commands_scope_recent_idx"
  ON "agent_domain_commands" ("surface", "scope_key", "created_at" DESC);

-- Crew.version is the optimistic-concurrency token for the complete aggregate,
-- not only the root row. Human and Agent writes to any authoritative child
-- table must therefore invalidate snapshots obtained before that write.
CREATE FUNCTION "bump_crew_aggregate_version"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_crew_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_crew_id := OLD."crew_id";
  ELSE
    affected_crew_id := NEW."crew_id";
  END IF;
  UPDATE "crews"
  SET
    "version" = "version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = affected_crew_id;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "crew_positions_bump_aggregate_version"
AFTER INSERT OR UPDATE OR DELETE ON "crew_positions"
FOR EACH ROW EXECUTE FUNCTION "bump_crew_aggregate_version"();

CREATE TRIGGER "crew_members_bump_aggregate_version"
AFTER INSERT OR UPDATE OR DELETE ON "crew_members"
FOR EACH ROW EXECUTE FUNCTION "bump_crew_aggregate_version"();

CREATE TRIGGER "crew_applications_bump_aggregate_version"
AFTER INSERT OR UPDATE OR DELETE ON "crew_applications"
FOR EACH ROW EXECUTE FUNCTION "bump_crew_aggregate_version"();

CREATE TRIGGER "episodes_bump_aggregate_version"
AFTER INSERT OR UPDATE OR DELETE ON "episodes"
FOR EACH ROW EXECUTE FUNCTION "bump_crew_aggregate_version"();

CREATE TRIGGER "episode_assignments_bump_aggregate_version"
AFTER INSERT OR UPDATE OR DELETE ON "episode_assignments"
FOR EACH ROW EXECUTE FUNCTION "bump_crew_aggregate_version"();
