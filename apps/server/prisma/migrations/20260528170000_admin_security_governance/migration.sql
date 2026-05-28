-- Admin account security governance.
--
-- Adds the durable state needed for enterprise admin controls:
-- MFA enrollment challenges, login risk tracking, account lockout, and
-- password-history checks.

CREATE TYPE "AdminLoginAttemptOutcome" AS ENUM ('success', 'failure', 'blocked');

ALTER TABLE "admin_users"
  ADD COLUMN "mfa_enabled_at" TIMESTAMPTZ(6),
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ(6);

CREATE TABLE "admin_password_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_password_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_mfa_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" VARCHAR(128) NOT NULL,
  "purpose" VARCHAR(32) NOT NULL,
  "secret_encrypted" VARCHAR(255),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_mfa_challenges_token_hash_key" UNIQUE ("token_hash"),
  CONSTRAINT "admin_mfa_challenges_purpose_nonempty" CHECK (btrim("purpose") <> '')
);

CREATE TABLE "admin_login_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(320) NOT NULL,
  "user_id" UUID,
  "outcome" "AdminLoginAttemptOutcome" NOT NULL,
  "reason" VARCHAR(255),
  "ip_address" VARCHAR(64),
  "user_agent" VARCHAR(512),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_login_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_login_attempts_email_normalized" CHECK ("email" = lower(btrim("email")))
);

CREATE INDEX "admin_users_locked_until_idx"
  ON "admin_users" ("locked_until");
CREATE INDEX "admin_password_history_user_recent_idx"
  ON "admin_password_history" ("user_id", "created_at" DESC);
CREATE INDEX "admin_mfa_challenges_user_idx"
  ON "admin_mfa_challenges" ("user_id", "consumed_at", "expires_at");
CREATE INDEX "admin_mfa_challenges_expiry_idx"
  ON "admin_mfa_challenges" ("expires_at", "consumed_at");
CREATE INDEX "admin_login_attempts_email_idx"
  ON "admin_login_attempts" ("email", "outcome", "created_at" DESC);
CREATE INDEX "admin_login_attempts_ip_idx"
  ON "admin_login_attempts" ("ip_address", "outcome", "created_at" DESC);
CREATE INDEX "admin_login_attempts_user_idx"
  ON "admin_login_attempts" ("user_id", "created_at" DESC);

ALTER TABLE "admin_password_history"
  ADD CONSTRAINT "admin_password_history_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_mfa_challenges"
  ADD CONSTRAINT "admin_mfa_challenges_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "admin_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_login_attempts"
  ADD CONSTRAINT "admin_login_attempts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "admin_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
