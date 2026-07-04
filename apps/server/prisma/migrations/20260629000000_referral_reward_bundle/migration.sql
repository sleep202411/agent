-- Referral reward BUNDLES: a tier (阶梯奖励) can grant MULTIPLE rewards. The
-- legacy single-reward columns on referral_milestone_configs / referral_rewards
-- stay (mirrored from the primary item) so the shipped mobile keeps working.
-- Bundle items live in two child tables: tier config items + accrued snapshots.

-- CreateTable: per-tier configured bundle (admin-edited).
CREATE TABLE "referral_reward_tier_items" (
    "id" UUID NOT NULL,
    "milestone_id" UUID NOT NULL,
    "payout_type" "ReferralPayoutType" NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_reward_tier_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: accrued reward bundle snapshot (frozen at accrual; granted_at =
-- per-item idempotency for a multi-item claim).
CREATE TABLE "referral_reward_items" (
    "id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "payout_type" "ReferralPayoutType" NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3),
    "rank" INTEGER NOT NULL DEFAULT 0,
    "granted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_reward_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_reward_tier_item_milestone_idx" ON "referral_reward_tier_items"("milestone_id", "rank");
CREATE INDEX "referral_reward_item_reward_idx" ON "referral_reward_items"("reward_id", "rank");

-- AddForeignKey
ALTER TABLE "referral_reward_tier_items" ADD CONSTRAINT "referral_reward_tier_items_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "referral_milestone_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_reward_items" ADD CONSTRAINT "referral_reward_items_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "referral_rewards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill tier config items from existing milestones ────────────────────
-- Non-"both" tiers → one item mirroring the legacy columns.
INSERT INTO "referral_reward_tier_items" ("id", "milestone_id", "payout_type", "amount_minor", "days", "rank")
SELECT gen_random_uuid(), m."id", m."payout_type",
       CASE WHEN m."payout_type"::text LIKE 'membership%' THEN 0 ELSE m."reward_minor" END,
       CASE WHEN m."payout_type"::text LIKE 'membership%' THEN m."payout_days" ELSE 0 END,
       0
FROM "referral_milestone_configs" m
WHERE m."payout_type" <> 'membership_both';

-- membership_both tiers → two items (compute + community).
INSERT INTO "referral_reward_tier_items" ("id", "milestone_id", "payout_type", "amount_minor", "days", "rank")
SELECT gen_random_uuid(), m."id", v.ptype::"ReferralPayoutType", 0, m."payout_days", v.rank
FROM "referral_milestone_configs" m
CROSS JOIN (VALUES ('membership_compute', 0), ('membership_community', 1)) AS v(ptype, rank)
WHERE m."payout_type" = 'membership_both';

-- ─── Backfill accrued reward snapshots from existing rewards ────────────────
-- Already paid_out rewards get granted_at = paid_out_at so a stray re-grant is
-- a no-op; still-accrued/pending rewards keep granted_at NULL (claimable).
INSERT INTO "referral_reward_items" ("id", "reward_id", "payout_type", "amount_minor", "days", "currency", "rank", "granted_at")
SELECT gen_random_uuid(), r."id", r."payout_type",
       CASE WHEN r."payout_type"::text LIKE 'membership%' THEN 0 ELSE r."amount_minor" END,
       CASE WHEN r."payout_type"::text LIKE 'membership%' THEN r."days" ELSE 0 END,
       CASE WHEN r."payout_type" = 'cash' THEN r."currency" ELSE NULL END,
       0,
       CASE WHEN r."status" = 'paid_out' THEN r."paid_out_at" ELSE NULL END
FROM "referral_rewards" r
WHERE r."payout_type" <> 'membership_both';

INSERT INTO "referral_reward_items" ("id", "reward_id", "payout_type", "amount_minor", "days", "currency", "rank", "granted_at")
SELECT gen_random_uuid(), r."id", v.ptype::"ReferralPayoutType", 0, r."days", NULL, v.rank,
       CASE WHEN r."status" = 'paid_out' THEN r."paid_out_at" ELSE NULL END
FROM "referral_rewards" r
CROSS JOIN (VALUES ('membership_compute', 0), ('membership_community', 1)) AS v(ptype, rank)
WHERE r."payout_type" = 'membership_both';
