-- Default milestone ladder v3: NO cash tiers — community points forward with a
-- small compute-point sweetener in every tier, membership days on top (老板拍板:
-- 阶梯只发积分/会员, 社区积分为主+少量算力, 现金走消费返佣). Amounts are launch
-- DEFAULTS — admin-tunable.
--
-- Replaces ALL existing tiers of the 'default' program OUTRIGHT (user decision
-- 2026-07-04: 清理覆盖线上已有配置, 不兜底不保留). Reward rows snapshot their
-- bundle at accrual, so dangling milestone_id references stay renderable.

-- The threshold unique must ignore ARCHIVED tiers — a full unique lets a tier
-- archived via the admin panel block re-creating one at the same threshold
-- (admin create 500s on P2002). Recreate it as a partial unique over active
-- tiers only. (Prisma schema mirrors this as a comment; partial uniques
-- aren't expressible there.)
DROP INDEX "referral_milestone_program_threshold_unique";
CREATE UNIQUE INDEX "referral_milestone_program_threshold_unique"
  ON "referral_milestone_configs"("program_id", "invitee_threshold")
  WHERE "archived_at" IS NULL;

-- Wipe the previous ladder (cascades tier items).
DELETE FROM "referral_milestone_configs" m
USING "referral_programs" p
WHERE m."program_id" = p."id" AND p."key" = 'default';

-- New tiers. Legacy single-reward mirror columns = the primary item (the
-- community-point grant), matching legacyColumnsFromItems in the service.
INSERT INTO "referral_milestone_configs" (
    "id", "program_id", "invitee_threshold", "payout_type", "reward_minor",
    "payout_days", "title", "detail", "rank"
)
SELECT gen_random_uuid(), p."id", v.threshold,
       'points_community'::"ReferralPayoutType", v.points, 0, v.title, v.detail, v.rank
FROM "referral_programs" p
CROSS JOIN (VALUES
    (1,  188::bigint,   'Invite 1 friend',
     '188 community points + 88 compute points + 7 days of Studio membership', 1),
    (3,  588::bigint,   'Invite 3 friends',
     '588 community points + 188 compute points + 14 days of community membership', 2),
    (8,  1888::bigint,  'Invite 8 friends',
     '1,888 community points + 388 compute points + 30 days of Studio and community membership', 3),
    (20, 5888::bigint,  'Invite 20 friends',
     '5,888 community points + 888 compute points + 90 days of Studio and community membership', 4),
    (50, 18888::bigint, 'Invite 50 friends',
     '18,888 community points + 1,888 compute points + a full year of Studio and community membership', 5)
) AS v(threshold, points, title, detail, rank)
WHERE p."key" = 'default';

-- Bundle items per tier (rank orders the display).
INSERT INTO "referral_reward_tier_items" (
    "id", "milestone_id", "payout_type", "amount_minor", "days", "rank"
)
SELECT gen_random_uuid(), m."id", v.ptype::"ReferralPayoutType", v.amount, v.days, v.rank
FROM "referral_milestone_configs" m
JOIN "referral_programs" p ON p."id" = m."program_id" AND p."key" = 'default'
CROSS JOIN (VALUES
    (1,  'points_community',     188::bigint,   0,   0),
    (1,  'points_compute',       88::bigint,    0,   1),
    (1,  'membership_compute',   0::bigint,     7,   2),
    (3,  'points_community',     588::bigint,   0,   0),
    (3,  'points_compute',       188::bigint,   0,   1),
    (3,  'membership_community', 0::bigint,     14,  2),
    (8,  'points_community',     1888::bigint,  0,   0),
    (8,  'points_compute',       388::bigint,   0,   1),
    (8,  'membership_compute',   0::bigint,     30,  2),
    (8,  'membership_community', 0::bigint,     30,  3),
    (20, 'points_community',     5888::bigint,  0,   0),
    (20, 'points_compute',       888::bigint,   0,   1),
    (20, 'membership_compute',   0::bigint,     90,  2),
    (20, 'membership_community', 0::bigint,     90,  3),
    (50, 'points_community',     18888::bigint, 0,   0),
    (50, 'points_compute',       1888::bigint,  0,   1),
    (50, 'membership_compute',   0::bigint,     365, 2),
    (50, 'membership_community', 0::bigint,     365, 3)
) AS v(threshold, ptype, amount, days, rank)
WHERE m."invitee_threshold" = v.threshold AND m."archived_at" IS NULL;
