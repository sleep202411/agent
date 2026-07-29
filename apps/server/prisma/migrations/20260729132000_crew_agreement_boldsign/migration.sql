ALTER TYPE "CrewAgreementStatus" ADD VALUE 'declined';
ALTER TYPE "CrewAgreementStatus" ADD VALUE 'expired';
ALTER TYPE "CrewAgreementStatus" ADD VALUE 'failed';

ALTER TABLE "crew_agreements"
  ADD COLUMN "signer_name" VARCHAR(128) NOT NULL,
  ADD COLUMN "signer_email" VARCHAR(320) NOT NULL,
  ADD COLUMN "provider_status" VARCHAR(64),
  ADD COLUMN "last_synced_at" TIMESTAMPTZ(6);

CREATE INDEX "crew_agreements_provider_document_idx"
  ON "crew_agreements"("provider_document_id");
