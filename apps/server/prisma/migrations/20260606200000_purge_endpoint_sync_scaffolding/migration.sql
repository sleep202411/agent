-- Remove dead catalog-sync scaffolding. The AI catalog is managed MANUALLY;
-- there is no automated catalog sync, so these drift-detection / sync-timestamp
-- fields were never populated meaningfully. catalogSnapshot is KEPT (it is manual
-- operator config that the bailian runtime catalog reads).

DROP INDEX IF EXISTS "ai_provider_endpoints_last_synced_idx";

ALTER TABLE "ai_provider_endpoints"
  DROP COLUMN "schema_hash",
  DROP COLUMN "last_synced_at";

ALTER TABLE "ai_provider_model_bindings"
  DROP COLUMN "last_synced_at";
