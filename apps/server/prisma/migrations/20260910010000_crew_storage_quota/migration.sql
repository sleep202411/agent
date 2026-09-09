ALTER TABLE "crews" ADD COLUMN "storage_limit_bytes" BIGINT NOT NULL DEFAULT 100000000000;
ALTER TABLE "crews" ADD CONSTRAINT "crews_storage_limit_positive" CHECK ("storage_limit_bytes" > 0);
CREATE TABLE "crew_upload_reservations" (
  "storage_key" TEXT PRIMARY KEY,
  "crew_id" TEXT NOT NULL REFERENCES "crews"("id") ON DELETE CASCADE,
  "user_id" VARCHAR(64) NOT NULL,
  "size_bytes" BIGINT NOT NULL CHECK ("size_bytes" > 0),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending','completed','cancelled')),
  "cleaned_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "crew_upload_reservations_capacity_idx" ON "crew_upload_reservations"("crew_id", "state", "expires_at");
CREATE INDEX "crew_upload_reservations_cleanup_idx" ON "crew_upload_reservations"("expires_at") WHERE "cleaned_at" IS NULL;
CREATE INDEX "media_assets_crew_storage_idx" ON "media_assets" ((metadata->>'crewId')) WHERE deleted_at IS NULL;
