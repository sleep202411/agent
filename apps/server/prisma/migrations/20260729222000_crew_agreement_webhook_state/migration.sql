-- Verified BoldSign webhook cursor. BoldSign delivery is at-least-once and
-- events may arrive out of order; persisting the last applied event prevents
-- retries or delayed callbacks from regressing an agreement.

ALTER TABLE "crew_agreements"
  ADD COLUMN "last_provider_event_id" VARCHAR(80),
  ADD COLUMN "last_provider_event_at" TIMESTAMPTZ(6);

DROP INDEX "crew_agreements_provider_document_idx";

CREATE UNIQUE INDEX "crew_agreements_provider_document_unique"
  ON "crew_agreements"("provider_document_id");

CREATE INDEX "crew_agreements_provider_event_idx"
  ON "crew_agreements"("last_provider_event_at");
