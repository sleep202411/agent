-- Models are open to everyone; usage is paid for in compute points, not by a
-- membership gate.
--
-- 20260810120000_unify_compute_membership_and_creator_seats rewrote every
-- canonical model's `requiredPlan` from 'vip' to 'basic', reasoning that legacy
-- VIP should become "the lowest paid canonical tier". What that missed is that
-- 'vip' was never a gate: EntitlementService.requiredPlan() normalises any
-- unknown-but-legacy value to null, and AuthzService.decideModelAccess()
-- early-returns `allowed: true` on null. So 'vip' meant OPEN, and 'basic' —
-- a real USD 27/month plan — closed all 31 models behind a paywall that only
-- three accounts in the entire database could pass.
--
-- null is the canonical "no membership required" value. ('free' normalises to
-- the same thing, but null skips the string path and states the intent
-- directly.) Scoped to rows the previous migration actually rewrote, so a model
-- deliberately gated at a higher tier later is not silently reopened.
UPDATE "ai_canonical_models"
SET "entitlement_policy" = jsonb_set(
  "entitlement_policy",
  '{requiredPlan}',
  'null'::jsonb,
  true
)
WHERE "entitlement_policy" ->> 'requiredPlan' = 'basic';
