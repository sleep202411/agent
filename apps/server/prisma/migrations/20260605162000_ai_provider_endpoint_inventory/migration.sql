-- Split provider endpoint inventory from user-facing model bindings.
--
-- Provider catalog sync now writes into ai_provider_endpoints only. A
-- provider binding is an explicit operator decision that connects a verified
-- endpoint to a canonical model for routing, pricing, quota and fallback.

CREATE TABLE "ai_provider_endpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_account_id" UUID NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "endpoint_id" VARCHAR(180) NOT NULL,
  "display_name" VARCHAR(160),
  "modality" "AiJobType" NOT NULL,
  "status" "AiControlPlaneStatus" NOT NULL DEFAULT 'draft',
  "health_status" "AiProviderHealthStatus" NOT NULL DEFAULT 'unknown',
  "supported_modes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "capabilities" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_input_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_output_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_pricing" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_quota_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "catalog_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "documentation" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "schema_hash" VARCHAR(80),
  "pricing_hash" VARCHAR(80),
  "disabled_reason" TEXT,
  "last_synced_at" TIMESTAMPTZ(6),
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_provider_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_endpoints_account_endpoint_unique"
  ON "ai_provider_endpoints"("provider_account_id", "endpoint_id");
CREATE INDEX "ai_provider_endpoints_provider_endpoint_idx"
  ON "ai_provider_endpoints"("provider", "endpoint_id");
CREATE INDEX "ai_provider_endpoints_catalog_idx"
  ON "ai_provider_endpoints"("modality", "status", "health_status");
CREATE INDEX "ai_provider_endpoints_last_synced_idx"
  ON "ai_provider_endpoints"("last_synced_at" DESC);

ALTER TABLE "ai_provider_model_bindings"
  ADD COLUMN "provider_endpoint_id" UUID;

CREATE INDEX "ai_provider_bindings_endpoint_route_idx"
  ON "ai_provider_model_bindings"("provider_endpoint_id", "status", "priority");

ALTER TABLE "ai_provider_endpoints"
  ADD CONSTRAINT "ai_provider_endpoints_provider_account_fkey"
  FOREIGN KEY ("provider_account_id")
  REFERENCES "ai_provider_accounts"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ai_provider_model_bindings"
  ADD CONSTRAINT "ai_provider_model_bindings_provider_endpoint_fkey"
  FOREIGN KEY ("provider_endpoint_id")
  REFERENCES "ai_provider_endpoints"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

INSERT INTO "ai_provider_endpoints" (
  "provider_account_id",
  "provider",
  "endpoint_id",
  "display_name",
  "modality",
  "status",
  "supported_modes",
  "provider_input_schema",
  "provider_output_schema",
  "provider_pricing",
  "catalog_snapshot",
  "documentation",
  "last_synced_at",
  "created_by_admin_id",
  "updated_by_admin_id",
  "created_at",
  "updated_at",
  "archived_at"
)
SELECT DISTINCT ON ("provider_account_id", "endpoint_id")
  "provider_account_id",
  "provider",
  "endpoint_id",
  "display_name",
  "modality",
  CASE
    WHEN "status" = 'archived' THEN 'disabled'::"AiControlPlaneStatus"
    ELSE "status"
  END,
  "supported_modes",
  "provider_input_schema",
  "provider_output_schema",
  "provider_pricing",
  "catalog_snapshot",
  "documentation",
  "last_synced_at",
  "created_by_admin_id",
  "updated_by_admin_id",
  "created_at",
  "updated_at",
  "archived_at"
FROM "ai_provider_model_bindings"
ORDER BY "provider_account_id", "endpoint_id", "updated_at" DESC;

UPDATE "ai_provider_model_bindings" b
SET "provider_endpoint_id" = e."id"
FROM "ai_provider_endpoints" e
WHERE e."provider_account_id" = b."provider_account_id"
  AND e."endpoint_id" = b."endpoint_id";
