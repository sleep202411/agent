-- Store provider credentials as encrypted, versioned database records.
--
-- Provider accounts remain the routing/account boundary. Credentials are
-- rotated and audited separately, and plaintext is never returned by APIs.

CREATE TYPE "AiProviderCredentialStatus" AS ENUM (
  'active',
  'disabled',
  'archived'
);

CREATE TABLE "ai_provider_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_account_id" UUID NOT NULL,
  "label" VARCHAR(120) NOT NULL DEFAULT 'default',
  "secret_kind" VARCHAR(64) NOT NULL DEFAULT 'api_key',
  "status" "AiProviderCredentialStatus" NOT NULL DEFAULT 'active',
  "algorithm" VARCHAR(48) NOT NULL DEFAULT 'aes-256-gcm',
  "key_version" VARCHAR(80) NOT NULL,
  "encrypted_secret" TEXT NOT NULL,
  "iv" VARCHAR(64) NOT NULL,
  "auth_tag" VARCHAR(64) NOT NULL,
  "fingerprint" VARCHAR(96) NOT NULL,
  "masked_value" VARCHAR(160) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_used_at" TIMESTAMPTZ(6),
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "rotated_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_provider_credentials_account_status_idx"
  ON "ai_provider_credentials"("provider_account_id", "status", "updated_at" DESC);
CREATE INDEX "ai_provider_credentials_fingerprint_idx"
  ON "ai_provider_credentials"("fingerprint");

ALTER TABLE "ai_provider_credentials"
  ADD CONSTRAINT "ai_provider_credentials_provider_account_fkey"
  FOREIGN KEY ("provider_account_id")
  REFERENCES "ai_provider_accounts"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ai_provider_accounts"
  DROP COLUMN IF EXISTS "credential_ref";
