-- AI model operations control plane.
--
-- Goals:
--   - One user-facing canonical model can route to many providers.
--   - Provider endpoints keep their own schemas, cost, queue, and SLO policy.
--   - Canonical model policy owns membership, pricing, quota, and queue rules.
--   - Cost and provider request evidence are immutable enough for audit,
--     support, margin analysis, and future alerting/reconciliation.

CREATE TYPE "AiControlPlaneStatus" AS ENUM (
  'draft',
  'active',
  'disabled',
  'degraded',
  'archived'
);

CREATE TYPE "AiProviderHealthStatus" AS ENUM (
  'unknown',
  'healthy',
  'degraded',
  'outage'
);

CREATE TYPE "AiModelVisibility" AS ENUM (
  'hidden',
  'direct'
);

CREATE TYPE "AiCostLedgerEntryType" AS ENUM (
  'reservation',
  'charge',
  'refund',
  'provider_cost',
  'adjustment'
);

CREATE TABLE "ai_provider_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" VARCHAR(64) NOT NULL,
  "display_name" VARCHAR(160) NOT NULL,
  "site_region" VARCHAR(24) NOT NULL DEFAULT 'global',
  "status" "AiControlPlaneStatus" NOT NULL DEFAULT 'active',
  "health_status" "AiProviderHealthStatus" NOT NULL DEFAULT 'unknown',
  "credential_ref" VARCHAR(160),
  "api_base_url" VARCHAR(512),
  "queue_base_url" VARCHAR(512),
  "rate_limit_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "quota_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "alert_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "health_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_health_check_at" TIMESTAMPTZ(6),
  "last_catalog_synced_at" TIMESTAMPTZ(6),
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_provider_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_canonical_models" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(120) NOT NULL,
  "display_name" VARCHAR(160) NOT NULL,
  "modality" "AiJobType" NOT NULL,
  "family" VARCHAR(80) NOT NULL,
  "generation_modes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "visibility" "AiModelVisibility" NOT NULL DEFAULT 'direct',
  "status" "AiControlPlaneStatus" NOT NULL DEFAULT 'draft',
  "description" TEXT,
  "parameter_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "output_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "entitlement_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "billing_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "queue_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "ui_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "observability_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_canonical_models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_provider_model_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_account_id" UUID NOT NULL,
  "canonical_model_id" UUID,
  "provider" VARCHAR(64) NOT NULL,
  "endpoint_id" VARCHAR(180) NOT NULL,
  "display_name" VARCHAR(160),
  "modality" "AiJobType" NOT NULL,
  "status" "AiControlPlaneStatus" NOT NULL DEFAULT 'draft',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "supported_modes" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "input_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "output_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_input_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_output_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "parameter_map" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "output_map" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "pricing_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "provider_pricing" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "queue_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "routing_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "region_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "fallback_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "observability_policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "catalog_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "documentation" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "disabled_reason" TEXT,
  "last_synced_at" TIMESTAMPTZ(6),
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_provider_model_bindings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_jobs"
  ADD COLUMN "canonical_model_id" UUID,
  ADD COLUMN "provider_binding_id" UUID;

ALTER TABLE "ai_attempts"
  ADD COLUMN "provider_request_id" VARCHAR(180),
  ADD COLUMN "provider_endpoint" VARCHAR(180),
  ADD COLUMN "queue_position" INTEGER,
  ADD COLUMN "pricing_snapshot" JSONB,
  ADD COLUMN "profit_accounting" JSONB,
  ADD COLUMN "timing" JSONB,
  ADD COLUMN "raw_status" JSONB,
  ADD COLUMN "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "execution_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "first_byte_at" TIMESTAMPTZ(6);

CREATE TABLE "ai_cost_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_id" TEXT NOT NULL,
  "attempt_id" TEXT,
  "provider_binding_id" UUID,
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID,
  "entry_type" "AiCostLedgerEntryType" NOT NULL,
  "currency" VARCHAR(16) NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL,
  "internal_credits" INTEGER,
  "provider_cost_usd" DECIMAL(18,6),
  "list_price_credits" INTEGER,
  "margin_usd" DECIMAL(18,6),
  "pricing_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_accounts_provider_region_name_unique"
  ON "ai_provider_accounts"("provider", "site_region", "display_name");
CREATE INDEX "ai_provider_accounts_provider_region_idx"
  ON "ai_provider_accounts"("provider", "site_region", "status");
CREATE INDEX "ai_provider_accounts_status_health_idx"
  ON "ai_provider_accounts"("status", "health_status", "updated_at" DESC);

CREATE UNIQUE INDEX "ai_canonical_models_slug_unique"
  ON "ai_canonical_models"("slug");
CREATE INDEX "ai_canonical_models_catalog_idx"
  ON "ai_canonical_models"("modality", "status", "visibility");
CREATE INDEX "ai_canonical_models_family_idx"
  ON "ai_canonical_models"("family", "status");

CREATE UNIQUE INDEX "ai_provider_bindings_account_endpoint_unique"
  ON "ai_provider_model_bindings"("provider_account_id", "endpoint_id");
CREATE INDEX "ai_provider_bindings_model_route_idx"
  ON "ai_provider_model_bindings"("canonical_model_id", "status", "priority");
CREATE INDEX "ai_provider_bindings_provider_endpoint_idx"
  ON "ai_provider_model_bindings"("provider", "endpoint_id");
CREATE INDEX "ai_provider_bindings_modality_status_idx"
  ON "ai_provider_model_bindings"("modality", "status");

CREATE INDEX "ai_jobs_canonical_model_created_idx"
  ON "ai_jobs"("canonical_model_id", "created_at" DESC);
CREATE INDEX "ai_jobs_provider_binding_created_idx"
  ON "ai_jobs"("provider_binding_id", "created_at" DESC);

CREATE INDEX "ai_attempts_provider_request_id_idx"
  ON "ai_attempts"("provider_request_id");

CREATE UNIQUE INDEX "ai_cost_ledger_idempotency_key_unique"
  ON "ai_cost_ledger_entries"("idempotency_key");
CREATE INDEX "ai_cost_ledger_job_idx"
  ON "ai_cost_ledger_entries"("job_id", "created_at" ASC);
CREATE INDEX "ai_cost_ledger_user_recent_idx"
  ON "ai_cost_ledger_entries"("user_id", "created_at" DESC);
CREATE INDEX "ai_cost_ledger_provider_binding_idx"
  ON "ai_cost_ledger_entries"("provider_binding_id", "created_at" DESC);

ALTER TABLE "ai_provider_model_bindings"
  ADD CONSTRAINT "ai_provider_model_bindings_provider_account_id_fkey"
  FOREIGN KEY ("provider_account_id") REFERENCES "ai_provider_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_model_bindings"
  ADD CONSTRAINT "ai_provider_model_bindings_canonical_model_id_fkey"
  FOREIGN KEY ("canonical_model_id") REFERENCES "ai_canonical_models"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_canonical_model_id_fkey"
  FOREIGN KEY ("canonical_model_id") REFERENCES "ai_canonical_models"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_jobs"
  ADD CONSTRAINT "ai_jobs_provider_binding_id_fkey"
  FOREIGN KEY ("provider_binding_id") REFERENCES "ai_provider_model_bindings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_cost_ledger_entries"
  ADD CONSTRAINT "ai_cost_ledger_entries_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "ai_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_cost_ledger_entries"
  ADD CONSTRAINT "ai_cost_ledger_entries_attempt_id_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "ai_attempts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_cost_ledger_entries"
  ADD CONSTRAINT "ai_cost_ledger_entries_provider_binding_id_fkey"
  FOREIGN KEY ("provider_binding_id") REFERENCES "ai_provider_model_bindings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
