-- Referral reward TYPES: cash / points / membership-days. Reshapes the default
-- program into a milestone-only ladder (compute/community/both membership +
-- cash top tier). Money/days are PLACEHOLDERS — tune via admin.

-- CreateEnum
CREATE TYPE "ReferralPayoutType" AS ENUM ('cash', 'points_compute', 'points_community', 'membership_compute', 'membership_community', 'membership_both');

-- AlterTable
ALTER TABLE "referral_milestone_configs"
  ADD COLUMN "payout_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payout_type" "ReferralPayoutType" NOT NULL DEFAULT 'cash';

-- AlterTable
ALTER TABLE "referral_rewards"
  ADD COLUMN "days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payout_type" "ReferralPayoutType" NOT NULL DEFAULT 'cash',
  ALTER COLUMN "currency" DROP NOT NULL;

-- Reshape the default program: milestone-only rewards (no per-referral reward,
-- no invitee perk for now).
UPDATE "referral_programs"
SET "reward_per_referral_minor" = 0,
    "invitee_benefit_minor" = 0,
    "updated_at" = NOW()
WHERE "key" = 'default';

-- Replace the old cash tiers with the membership/cash ladder.
DELETE FROM "referral_milestone_configs"
WHERE "program_id" IN (SELECT "id" FROM "referral_programs" WHERE "key" = 'default');

INSERT INTO "referral_milestone_configs" (
    "id", "program_id", "invitee_threshold", "payout_type", "reward_minor",
    "payout_days", "title", "detail", "rank"
)
SELECT gen_random_uuid(), p."id", v.threshold, v.ptype::"ReferralPayoutType",
       v.minor, v.days, v.title, v.detail, v.rank
FROM "referral_programs" p
CROSS JOIN (VALUES
    (1, 'membership_compute', 0::bigint, 7, 'Invite 1 friend', '7 days of compute membership once your friend makes a purchase', 1),
    (3, 'membership_community', 0::bigint, 7, 'Invite 3 friends', '7 days of community membership', 2),
    (8, 'membership_both', 0::bigint, 30, 'Invite 8 friends', '30 days of both compute + community membership', 3),
    (20, 'cash', 5000::bigint, 0, 'Invite 20 friends', 'Cash reward', 4)
) AS v(threshold, ptype, minor, days, title, detail, rank)
WHERE p."key" = 'default'
ON CONFLICT ("program_id", "invitee_threshold") DO NOTHING;
