-- `quotaTier` was removed from the MembershipBenefits schema when the Java
-- userLevel vocabulary (Free/VIP1/VIP2/VIP3) was retired. That schema is strict, so
-- it now REJECTS the key rather than ignoring it: every request that resolved a
-- member's benefits threw InvalidMembershipBenefitsError and returned 500 until the
-- stored rows were cleaned. Prod was fixed by hand; this migration is what carries
-- the same fix to .cn and to every developer database, which are still poisoned.
--
-- Idempotent by construction (`benefits - key` on a row without the key is a no-op),
-- so re-running is harmless and a partially-cleaned database converges.
--
-- LOCKING: a single UPDATE over billing_membership_plans, which holds one row per
-- plan (11 in prod). Row-level locks only, and the table is read through a 20s
-- in-process cache rather than on every request, so contention is not a concern at
-- this size.
UPDATE "billing_membership_plans"
SET "benefits" = "benefits" - 'quotaTier'
WHERE "benefits" ? 'quotaTier';
