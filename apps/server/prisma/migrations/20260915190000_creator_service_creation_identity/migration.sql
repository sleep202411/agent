ALTER TABLE "creator_services"
  ADD COLUMN "creation_key" VARCHAR(64),
  ADD COLUMN "creation_fingerprint" VARCHAR(64),
  ADD CONSTRAINT "creator_services_creation_receipt_pair" CHECK (
    ("creation_key" IS NULL AND "creation_fingerprint" IS NULL)
    OR ("creation_key" IS NOT NULL AND "creation_fingerprint" IS NOT NULL)
  );
CREATE UNIQUE INDEX "creator_services_creation_key_unique"
  ON "creator_services" ("creator_id", "creation_key");
