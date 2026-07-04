-- Milestone (阶梯) becomes REGISTRATION-based (老板 2026-07-04): a tier unlocks by
-- how many people registered with the referrer's code (counted lazily from Java
-- on dashboard view), NOT by qualified purchases. ANY registration counts (Java
-- OTP-verifies at signup). Reseeds the default ladder with the final cut values
-- (points + membership; membership is the draw). The (program_id,
-- invitee_threshold) unique is already partial-on-archived (migration
-- 20260704150000), so archived tiers don't block this reseed.

-- CreateTable: the invitee welcome-perk bundle (社区/算力积分, 会员, or cash).
CREATE TABLE "referral_invitee_benefit_items" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "payout_type" "ReferralPayoutType" NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_invitee_benefit_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "referral_invitee_benefit_item_program_idx" ON "referral_invitee_benefit_items"("program_id", "rank");
ALTER TABLE "referral_invitee_benefit_items" ADD CONSTRAINT "referral_invitee_benefit_items_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "referral_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: lift an existing cash invitee benefit (invitee_benefit_minor > 0)
-- into a one-item cash bundle so nothing is lost.
INSERT INTO "referral_invitee_benefit_items" ("id", "program_id", "payout_type", "amount_minor", "days", "rank")
SELECT gen_random_uuid(), p."id", 'cash'::"ReferralPayoutType", p."invitee_benefit_minor", 0, 0
FROM "referral_programs" p
WHERE p."invitee_benefit_minor" > 0;

-- Wipe the previous ladder outright (unreferenced hard-delete; referenced tiers
-- archived so accrued rewards keep their FK). Reward rows snapshot their bundle,
-- so a dangling milestone_id stays renderable.
DELETE FROM "referral_milestone_configs" m
USING "referral_programs" p
WHERE m."program_id" = p."id" AND p."key" = 'default'
  AND NOT EXISTS (
    SELECT 1 FROM "referral_rewards" r WHERE r."milestone_id" = m."id"
  );

UPDATE "referral_milestone_configs" m
SET "archived_at" = NOW(), "updated_at" = NOW()
FROM "referral_programs" p
WHERE m."program_id" = p."id" AND p."key" = 'default'
  AND m."archived_at" IS NULL;

-- New tiers. Legacy mirror columns = the primary item (community points).
INSERT INTO "referral_milestone_configs" (
    "id", "program_id", "invitee_threshold", "payout_type", "reward_minor",
    "payout_days", "title", "detail", "rank"
)
SELECT gen_random_uuid(), p."id", v.threshold,
       'points_community'::"ReferralPayoutType", v.points, 0, v.title, v.detail, v.rank
FROM "referral_programs" p
CROSS JOIN (VALUES
    (1,   100::bigint,  'Invite 1 friend',
     '100 community points + 50 compute points + 3 days of Studio membership', 1),
    (5,   300::bigint,  'Invite 5 friends',
     '300 community points + 100 compute points + 7 days of community membership', 2),
    (20,  1000::bigint, 'Invite 20 friends',
     '1,000 community points + 300 compute points + 15 days of Studio and community membership', 3),
    (50,  3000::bigint, 'Invite 50 friends',
     '3,000 community points + 800 compute points + 45 days of Studio and community membership', 4),
    (100, 8000::bigint, 'Invite 100 friends',
     '8,000 community points + 2,000 compute points + 180 days of Studio and community membership', 5)
) AS v(threshold, points, title, detail, rank)
WHERE p."key" = 'default'
ON CONFLICT ("program_id", "invitee_threshold") WHERE "archived_at" IS NULL DO NOTHING;

-- Bundle items per tier.
INSERT INTO "referral_reward_tier_items" (
    "id", "milestone_id", "payout_type", "amount_minor", "days", "rank"
)
SELECT gen_random_uuid(), m."id", v.ptype::"ReferralPayoutType", v.amount, v.days, v.rank
FROM "referral_milestone_configs" m
JOIN "referral_programs" p ON p."id" = m."program_id" AND p."key" = 'default'
CROSS JOIN (VALUES
    (1,   'points_community',    100::bigint,  0,   0),
    (1,   'points_compute',      50::bigint,   0,   1),
    (1,   'membership_compute',  0::bigint,    3,   2),
    (5,   'points_community',    300::bigint,  0,   0),
    (5,   'points_compute',      100::bigint,  0,   1),
    (5,   'membership_community', 0::bigint,   7,   2),
    (20,  'points_community',    1000::bigint, 0,   0),
    (20,  'points_compute',      300::bigint,  0,   1),
    (20,  'membership_compute',  0::bigint,    15,  2),
    (20,  'membership_community', 0::bigint,   15,  3),
    (50,  'points_community',    3000::bigint, 0,   0),
    (50,  'points_compute',      800::bigint,  0,   1),
    (50,  'membership_compute',  0::bigint,    45,  2),
    (50,  'membership_community', 0::bigint,   45,  3),
    (100, 'points_community',    8000::bigint, 0,   0),
    (100, 'points_compute',      2000::bigint, 0,   1),
    (100, 'membership_compute',  0::bigint,    180, 2),
    (100, 'membership_community', 0::bigint,   180, 3)
) AS v(threshold, ptype, amount, days, rank)
WHERE m."invitee_threshold" = v.threshold AND m."archived_at" IS NULL;
