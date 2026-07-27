ALTER TABLE "studio_agent_artifacts"
  ADD COLUMN "ingest_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "ingest_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ingest_lease_token" UUID,
  ADD COLUMN "ingest_lease_owner" VARCHAR(240),
  ADD COLUMN "ingest_lease_acquired_at" TIMESTAMPTZ(6),
  ADD COLUMN "ingest_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "ingest_completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "ingest_last_error_code" VARCHAR(96),
  ADD COLUMN "ingest_last_error_detail" TEXT;

-- Pending document artifacts created by the pre-worker registration path must
-- remain processable after deploy. Non-document artifacts never enter this
-- queue and therefore keep a NULL due time.
UPDATE "studio_agent_artifacts"
SET "ingest_next_attempt_at" = NOW()
WHERE "kind" = 'document'::"StudioAgentArtifactKind"
  AND "status" = 'pending'::"StudioAgentArtifactStatus"
  AND "cleanup_status" = 'active'::"StudioAgentArtifactCleanupStatus";

CREATE INDEX "studio_agent_artifacts_ingest_due_idx"
  ON "studio_agent_artifacts"(
    "kind",
    "status",
    "ingest_next_attempt_at",
    "created_at",
    "id"
  );

CREATE INDEX "studio_agent_artifacts_ingest_stale_lease_idx"
  ON "studio_agent_artifacts"("ingest_lease_expires_at");
