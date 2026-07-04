-- Consumption commission (消费返佣): a referrer earns a per-user-configurable
-- % (bps) of each referee order's ACTUAL-PAID amount, accrued per order into
-- the existing reward/claim pipeline. Default rate lives on the program
-- (0 = off → whitelist-only mode); per-user rates override.

-- AlterEnum: the per-order commission reward kind. (Not referenced elsewhere
-- in this migration — a PG12+ tx may add but not use a new enum value.)
ALTER TYPE "ReferralRewardKind" ADD VALUE 'commission';

-- AlterTable: program-level default rate.
ALTER TABLE "referral_programs"
  ADD COLUMN "commission_bps" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "referral_program_commission_bps_range"
    CHECK ("commission_bps" >= 0 AND "commission_bps" <= 10000);

-- AlterTable: commission rewards point at their source order and snapshot the
-- applied rate + source amount for audit / future pro-rated clawback.
ALTER TABLE "referral_rewards"
  ADD COLUMN "order_id" UUID,
  ADD COLUMN "commission_bps" INTEGER,
  ADD COLUMN "source_amount_minor" BIGINT;

-- Per-order idempotency: at most one commission reward per order. (NULL
-- order_id rows — all other kinds — are unaffected; PG treats NULLs as
-- distinct in unique indexes.)
CREATE UNIQUE INDEX "referral_reward_order_kind_unique"
  ON "referral_rewards"("order_id", "kind");

-- CreateTable: per-referrer rate whitelist (KOL rates). A row overrides the
-- program default (0 = explicitly disabled for that user).
CREATE TABLE "referral_commission_rates" (
    "id" UUID NOT NULL,
    "program_key" VARCHAR(64) NOT NULL DEFAULT 'default',
    "user_id" VARCHAR(64) NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "note" VARCHAR(200),
    "created_by_id" VARCHAR(64),
    "updated_by_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_commission_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referral_commission_rate_bps_range"
      CHECK ("commission_bps" >= 0 AND "commission_bps" <= 10000)
);

CREATE UNIQUE INDEX "referral_commission_rate_program_user_unique"
  ON "referral_commission_rates"("program_key", "user_id");
