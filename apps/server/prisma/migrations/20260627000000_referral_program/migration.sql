-- Referral / invite-reward program. Hand-placed (matches `prisma migrate diff`
-- output) so the seed can ride along idempotently. Money is BigInt minor units.

-- CreateEnum
CREATE TYPE "ReferralAttributionStatus" AS ENUM ('pending', 'qualified', 'reversed', 'voided');

-- CreateEnum
CREATE TYPE "ReferralRewardKind" AS ENUM ('referral', 'milestone', 'invitee');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('pending', 'qualified', 'accrued', 'reversed', 'voided', 'paid_out');

-- CreateTable
CREATE TABLE "referral_programs" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "reward_per_referral_minor" BIGINT NOT NULL DEFAULT 0,
    "qualify_event" VARCHAR(32) NOT NULL DEFAULT 'first_purchase',
    "hold_days" INTEGER NOT NULL DEFAULT 0,
    "max_rewarded_referees" INTEGER NOT NULL DEFAULT 0,
    "referee_max_account_age_hours" INTEGER NOT NULL DEFAULT 0,
    "invitee_benefit_title" VARCHAR(120),
    "invitee_benefit_detail" VARCHAR(400),
    "invitee_benefit_minor" BIGINT NOT NULL DEFAULT 0,
    "invitee_benefit_expires_in_days" INTEGER,
    "created_by_id" VARCHAR(64),
    "updated_by_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_milestone_configs" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "invitee_threshold" INTEGER NOT NULL,
    "reward_minor" BIGINT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "detail" VARCHAR(400) NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_milestone_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_invite_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "program_key" VARCHAR(64) NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" UUID NOT NULL,
    "program_key" VARCHAR(64) NOT NULL DEFAULT 'default',
    "referrer_user_id" VARCHAR(64) NOT NULL,
    "referee_user_id" VARCHAR(64) NOT NULL,
    "invite_code" VARCHAR(32) NOT NULL,
    "status" "ReferralAttributionStatus" NOT NULL DEFAULT 'pending',
    "qualified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" UUID NOT NULL,
    "program_key" VARCHAR(64) NOT NULL DEFAULT 'default',
    "user_id" VARCHAR(64) NOT NULL,
    "kind" "ReferralRewardKind" NOT NULL,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'pending',
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "subtitle" VARCHAR(200),
    "attribution_id" UUID,
    "milestone_id" UUID,
    "available_at" TIMESTAMPTZ(6),
    "paid_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_programs_key_key" ON "referral_programs"("key");

-- CreateIndex
CREATE INDEX "referral_milestone_program_rank_idx" ON "referral_milestone_configs"("program_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "referral_milestone_program_threshold_unique" ON "referral_milestone_configs"("program_id", "invitee_threshold");

-- CreateIndex
CREATE UNIQUE INDEX "referral_invite_codes_code_key" ON "referral_invite_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_code_user_program_unique" ON "referral_invite_codes"("user_id", "program_key");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attributions_referee_user_id_key" ON "referral_attributions"("referee_user_id");

-- CreateIndex
CREATE INDEX "referral_attribution_referrer_idx" ON "referral_attributions"("referrer_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_attribution_id_key" ON "referral_rewards"("attribution_id");

-- CreateIndex
CREATE INDEX "referral_reward_user_idx" ON "referral_rewards"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "referral_reward_user_milestone_unique" ON "referral_rewards"("user_id", "milestone_id");

-- AddForeignKey
ALTER TABLE "referral_milestone_configs" ADD CONSTRAINT "referral_milestone_configs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "referral_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the default program. Money amounts are PLACEHOLDERS (tune via admin);
-- Phase 1 grants no rewards, so enabling here only lights up the dashboard UI.
INSERT INTO "referral_programs" (
    "id", "key", "enabled", "currency", "reward_per_referral_minor",
    "qualify_event", "hold_days", "invitee_benefit_title",
    "invitee_benefit_detail", "invitee_benefit_minor",
    "invitee_benefit_expires_in_days"
) VALUES (
    gen_random_uuid(), 'default', true, 'USD', 500,
    'first_purchase', 7, 'Welcome bonus',
    'Bonus credits on your first top-up', 500, 30
) ON CONFLICT ("key") DO NOTHING;

-- Default milestone tiers (placeholders).
INSERT INTO "referral_milestone_configs" (
    "id", "program_id", "invitee_threshold", "reward_minor", "title", "detail", "rank"
)
SELECT gen_random_uuid(), p."id", v.threshold, v.reward, v.title, v.detail, v.rank
FROM "referral_programs" p
CROSS JOIN (VALUES
    (3, 1000, 'Invite 3 friends', 'Bonus when 3 invited friends qualify', 1),
    (10, 5000, 'Invite 10 friends', 'Bigger bonus at 10 qualified friends', 2),
    (25, 15000, 'Invite 25 friends', 'Top-tier bonus at 25 qualified friends', 3)
) AS v(threshold, reward, title, detail, rank)
WHERE p."key" = 'default'
ON CONFLICT ("program_id", "invitee_threshold") DO NOTHING;
