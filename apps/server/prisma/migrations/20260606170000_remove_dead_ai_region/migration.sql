-- Remove dead AI-generation region/geo logic.
-- Rationale: the deployment-level global/cn split is handled by separate
-- deployments + databases; these app-level region columns were never consumed
-- by routing (geo gating was a verified no-op — regionPolicy was always empty).

-- Provider account: drop site_region; rework keys to (provider, display_name).
DROP INDEX "ai_provider_accounts_provider_region_name_unique";
DROP INDEX "ai_provider_accounts_provider_region_idx";
ALTER TABLE "ai_provider_accounts" DROP COLUMN "site_region";
CREATE UNIQUE INDEX "ai_provider_accounts_provider_name_unique" ON "ai_provider_accounts"("provider", "display_name");
CREATE INDEX "ai_provider_accounts_provider_status_idx" ON "ai_provider_accounts"("provider", "status");

-- Provider model binding: drop the never-populated region_policy.
ALTER TABLE "ai_provider_model_bindings" DROP COLUMN "region_policy";

-- AiJob: drop the audit-only site_region column + its dead index.
DROP INDEX "ai_jobs_site_region_created_idx";
ALTER TABLE "ai_jobs" DROP COLUMN "site_region";
