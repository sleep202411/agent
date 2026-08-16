ALTER TABLE "world_model_worlds"
ADD COLUMN "submission_key" VARCHAR(64),
ADD COLUMN "request_fingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "world_model_worlds_submission_key_unique"
ON "world_model_worlds"("submission_key");
