-- Referral program: config + per-user codes + relationships.
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded', 'void');

CREATE TABLE "referral_configs" (
  "id" UUID NOT NULL,
  "key" VARCHAR(255) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "referrer_reward" INTEGER NOT NULL DEFAULT 0,
  "referee_reward" INTEGER NOT NULL DEFAULT 0,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_configs_key_key" ON "referral_configs"("key");

CREATE TABLE "referral_codes" (
  "id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_codes_user_id_key" ON "referral_codes"("user_id");
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

CREATE TABLE "referrals" (
  "id" UUID NOT NULL,
  "referrer_user_id" VARCHAR(64) NOT NULL,
  "referee_user_id" VARCHAR(64) NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
  "referrer_reward" INTEGER NOT NULL DEFAULT 0,
  "referee_reward" INTEGER NOT NULL DEFAULT 0,
  "qualified_at" TIMESTAMPTZ(6),
  "rewarded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);
-- A user is referred at most once.
CREATE UNIQUE INDEX "referrals_referee_user_id_key" ON "referrals"("referee_user_id");
CREATE INDEX "referrals_referrer_idx" ON "referrals"("referrer_user_id");
CREATE INDEX "referrals_status_idx" ON "referrals"("status");
