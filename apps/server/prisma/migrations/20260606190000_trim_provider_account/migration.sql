-- Trim AiProviderAccount to a minimal code-reconciled stub.
-- Keep: id, provider, status, rateLimitPolicy, quotaPolicy (queue-throttle / spend-cap
-- home — consumed when provider-aware queue dispatch is built), + audit + relations.
-- Drop the unwired / env-owned / derivable columns.

DROP INDEX IF EXISTS "ai_provider_accounts_provider_status_idx";

ALTER TABLE "ai_provider_accounts"
  DROP COLUMN "display_name",
  DROP COLUMN "health_status",
  DROP COLUMN "api_base_url",
  DROP COLUMN "queue_base_url",
  DROP COLUMN "alert_policy",
  DROP COLUMN "health_snapshot",
  DROP COLUMN "metadata",
  DROP COLUMN "last_health_check_at",
  DROP COLUMN "last_catalog_synced_at";

-- health_status's index (ai_provider_accounts_status_health_idx) auto-drops with the column.
CREATE INDEX "ai_provider_accounts_status_updated_idx" ON "ai_provider_accounts"("status", "updated_at" DESC);
