-- Provider bindings are route definitions, not loose provider records.
-- This control plane is not live yet, so incomplete legacy bindings are
-- removed instead of supported. Every binding must connect one canonical model
-- to one provider endpoint.

DELETE FROM "ai_provider_model_bindings"
WHERE "canonical_model_id" IS NULL
   OR "provider_endpoint_id" IS NULL;

ALTER TABLE "ai_provider_model_bindings"
  DROP CONSTRAINT IF EXISTS "ai_provider_model_bindings_canonical_model_id_fkey";

ALTER TABLE "ai_provider_model_bindings"
  DROP CONSTRAINT IF EXISTS "ai_provider_model_bindings_provider_endpoint_fkey";

ALTER TABLE "ai_provider_model_bindings"
  ALTER COLUMN "canonical_model_id" SET NOT NULL,
  ALTER COLUMN "provider_endpoint_id" SET NOT NULL;

ALTER TABLE "ai_provider_model_bindings"
  ADD CONSTRAINT "ai_provider_model_bindings_canonical_model_id_fkey"
  FOREIGN KEY ("canonical_model_id")
  REFERENCES "ai_canonical_models"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "ai_provider_model_bindings"
  ADD CONSTRAINT "ai_provider_model_bindings_provider_endpoint_fkey"
  FOREIGN KEY ("provider_endpoint_id")
  REFERENCES "ai_provider_endpoints"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
