-- Signed agreements are not complete until both provider artifacts are
-- durably stored in the crew asset domain. Webhooks enqueue this lease-based
-- job; workers perform provider/storage IO outside the webhook transaction.

CREATE TYPE "CrewAgreementArchiveJobStatus" AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

ALTER TABLE "crew_agreements"
  ADD COLUMN "audit_asset_node_id" UUID;

CREATE TABLE "crew_agreement_archive_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agreement_id" UUID NOT NULL,
  "status" "CrewAgreementArchiveJobStatus" NOT NULL DEFAULT 'pending',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6),
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(128),
  "last_error" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_agreement_archive_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_agreement_archive_jobs_agreement_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "crew_agreements"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crew_agreement_archive_jobs_agreement_unique"
  ON "crew_agreement_archive_jobs"("agreement_id");

CREATE INDEX "crew_agreement_archive_jobs_dispatch_idx"
  ON "crew_agreement_archive_jobs"("status", "next_attempt_at", "created_at");

CREATE INDEX "crew_agreement_archive_jobs_stale_lock_idx"
  ON "crew_agreement_archive_jobs"("status", "locked_at");

ALTER TABLE "crew_agreements"
  ADD CONSTRAINT "crew_agreements_audit_asset_node_id_fkey"
  FOREIGN KEY ("audit_asset_node_id") REFERENCES "crew_asset_nodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing completed BoldSign documents enter the exact same durable path.
INSERT INTO "crew_agreement_archive_jobs" ("agreement_id")
SELECT "id"
FROM "crew_agreements"
WHERE "status" = 'signed'
  AND (
    "asset_node_id" IS NULL
    OR "audit_asset_node_id" IS NULL
  )
ON CONFLICT ("agreement_id") DO NOTHING;
