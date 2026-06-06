-- Remove the DB provider-credential layer. Provider API keys now come from env
-- (FAL_API_KEY / DASHSCOPE_API_KEY / AZURE_OPENAI_API_KEY, …); the DB no longer
-- stores secrets. Provider accounts are reconciled from the code ProviderRegistry
-- (one per registered adapter), so the uniqueness key collapses to (provider).

-- Drop the credential table + its enum (no incoming FKs; the only column using
-- the enum lives on this table).
DROP TABLE "ai_provider_credentials";
DROP TYPE "AiProviderCredentialStatus";

-- One account per provider (was [provider, display_name]).
DROP INDEX "ai_provider_accounts_provider_name_unique";
CREATE UNIQUE INDEX "ai_provider_accounts_provider_unique" ON "ai_provider_accounts"("provider");
