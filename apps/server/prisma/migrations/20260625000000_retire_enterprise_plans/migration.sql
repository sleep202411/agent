-- Retire the sales-only Enterprise + Enterprise Team membership plans: they were
-- pulled from the lineup (see prisma/seed/membership-plans.ts retiredPlanKeys) and
-- this archives the live rows so they stop showing on the studio pricing surface.
--
-- Archive, never delete — mirrors the seed's retireRemovedPlans() so historical
-- rows stay for audit/refunds. Idempotent: the `archived_at IS NULL` guard makes a
-- re-run a no-op. These two plans are sales-only (no seeded price / provider
-- binding), so only the plan rows need archiving.
UPDATE "billing_membership_plans"
SET "status" = 'archived',
    "archived_at" = NOW()
WHERE "plan_key" IN ('enterprise', 'team_enterprise')
  AND "archived_at" IS NULL;
