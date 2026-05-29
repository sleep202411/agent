-- AI generation routing policy snapshot.
--
-- Submit-time route decisions must be auditable and replayable. The
-- provider/model/preset/campaign/quota policy used for a job is stored
-- here as JSONB so new routing rules can ship without a schema change.

ALTER TABLE "ai_jobs"
  ADD COLUMN IF NOT EXISTS "routing_snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "ai_jobs_route_id_idx"
  ON "ai_jobs" (("routing_snapshot" ->> 'routeId'))
  WHERE "routing_snapshot" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ai_jobs_routing_provider_recent_idx"
  ON "ai_jobs" (("routing_snapshot" ->> 'selectedProvider'), "created_at" DESC)
  WHERE "routing_snapshot" IS NOT NULL;
