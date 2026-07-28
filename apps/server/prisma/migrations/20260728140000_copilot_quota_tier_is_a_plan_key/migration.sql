-- The copilot quota attempt's `tier` is a PLAN KEY, and plan keys are data.
--
-- This constraint was written when a tier was one of four labels inherited from
-- the Java membership service: 'Free', 'VIP1', 'VIP2', 'VIP3'. That vocabulary
-- is gone. `CopilotQuotaService` now records `snapshot.planKey`
-- (`entitlement.service.ts` — `tier: snapshot.planKey`), and a plan key is
-- deliberately open: `EntitlementPlanKey = string`, resolved from
-- `billing_membership_plans` rows, so a new plan is added by inserting a row and
-- never by editing code.
--
-- Every charged copilot turn has therefore been failing in production with
--   new row for relation "copilot_quota_charge_attempts" violates check
--   constraint "copilot_quota_charge_attempts_tier"
-- which Nest surfaces as a 500 — the panel shows
-- {"statusCode":500,"message":"Internal server error"} and the creator cannot
-- chat at all. Observed on all three server pods.
--
-- The fix is not a newer list. A closed list in the database is the bug: it
-- asserts ownership of a vocabulary the database does not own, so it breaks
-- again the day someone adds a plan. What this constraint is actually FOR is
-- the second clause — a charge that has been taken must record which tier it
-- was taken at, or the ledger cannot be audited or refunded. That invariant is
-- real and stays. The vocabulary check goes.
--
-- `VARCHAR(16)` is the same mistake in another form: `enterprise_annual` is
-- seventeen characters and would fail exactly as loudly. Widened to a bound
-- that is a sanity limit rather than a guess about the naming scheme.

ALTER TABLE "copilot_quota_charge_attempts"
  DROP CONSTRAINT "copilot_quota_charge_attempts_tier";

ALTER TABLE "copilot_quota_charge_attempts"
  ALTER COLUMN "tier" TYPE VARCHAR(64);

ALTER TABLE "copilot_quota_charge_attempts"
  ADD CONSTRAINT "copilot_quota_charge_attempts_tier" CHECK (
    -- Shape, not vocabulary: a tier that is present must say something.
    ("tier" IS NULL OR length(btrim("tier")) > 0) AND
    -- The invariant this constraint exists for: money moved, so the ledger has
    -- to say at which tier.
    ("status" NOT IN ('charged', 'settle_pending', 'settled') OR "tier" IS NOT NULL)
  );
