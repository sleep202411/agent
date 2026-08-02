ALTER TYPE "CrewAgreementStatus" ADD VALUE IF NOT EXISTS 'sending' AFTER 'draft';

CREATE TYPE "CrewAgreementSendJobStatus" AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

ALTER TABLE "crew_invitations"
  ADD COLUMN "agreement_title" VARCHAR(180),
  ADD COLUMN "agreement_signer_name" VARCHAR(128),
  ADD COLUMN "agreement_signer_email" VARCHAR(320);

ALTER TABLE "crew_agreements"
  ADD COLUMN "invitation_id" UUID;

CREATE UNIQUE INDEX "crew_agreements_invitation_unique"
  ON "crew_agreements" ("invitation_id");

ALTER TABLE "crew_agreements"
  ADD CONSTRAINT "crew_agreements_invitation_id_fkey"
  FOREIGN KEY ("invitation_id")
  REFERENCES "crew_invitations" ("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "crew_agreement_send_jobs" (
  "id" UUID NOT NULL,
  "agreement_id" UUID NOT NULL,
  "status" "CrewAgreementSendJobStatus" NOT NULL DEFAULT 'pending',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6),
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(128),
  "last_error" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crew_agreement_send_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_agreement_send_jobs_agreement_id_fkey"
    FOREIGN KEY ("agreement_id")
    REFERENCES "crew_agreements" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "crew_agreement_send_jobs_agreement_unique"
  ON "crew_agreement_send_jobs" ("agreement_id");

CREATE INDEX "crew_agreement_send_jobs_dispatch_idx"
  ON "crew_agreement_send_jobs" ("status", "next_attempt_at", "created_at");

CREATE INDEX "crew_agreement_send_jobs_stale_lock_idx"
  ON "crew_agreement_send_jobs" ("status", "locked_at");
