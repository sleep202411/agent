-- compute_point becomes uniformly WORKSPACE-owned.
--
-- Re-keys each user-owned compute_point/consumable wallet account to that user's
-- PERSONAL workspace, so every workspace (personal included) holds its own compute
-- pot and spend/read/fund resolve to the active workspace uniformly. The account id
-- is PRESERVED, so all grant lots, allocations, holds, and ledger history follow
-- automatically — no child rewrites, no balance change, so total compute points are
-- conserved by construction. community_point stays user-owned and is untouched.
--
-- SAFETY: must run drained — no compute_point job may hold funds during the re-key
-- (a held team / member_pays job would settle against the wrong owner afterward).
-- Step 1 asserts this and aborts loudly if any user-owned compute account has holds.
--
-- PROD PRE-STEP: a user with a compute balance but NO personal workspace is left
-- user-owned (and would be orphaned by the resolver change). Ensure every such user
-- has a personal workspace before deploy. (Locally all active users do; this
-- migration ships with the resolver change that makes compute workspace-owned.)

-- 1) Drain assertion: refuse to migrate while compute funds are held in-flight.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "wallet_accounts"
    WHERE "owner_type" = 'user'
      AND "currency" = 'compute_point'
      AND "balance_kind" = 'consumable'
      AND "held_balance" <> 0
  ) THEN
    RAISE EXCEPTION 'compute_point migration aborted: user-owned compute accounts have in-flight holds. Drain AI jobs and retry.';
  END IF;
END $$;

-- 2) Remove the empty placeholder personal-workspace compute account that
--    ensureDefaultAccounts pre-provisioned, so the re-key target slot is free.
--    Only deletes placeholders that are zero-balance, child-less, AND whose owning
--    user actually has a user-owned compute account to take the slot.
DELETE FROM "wallet_accounts" ph
USING "workspaces" w
WHERE ph."owner_type" = 'workspace'
  AND ph."currency" = 'compute_point'
  AND ph."balance_kind" = 'consumable'
  AND ph."owner_id" = w."id"::text
  AND w."type" = 'personal'
  AND w."deleted_at" IS NULL
  AND ph."available_balance" = 0
  AND ph."held_balance" = 0
  AND NOT EXISTS (SELECT 1 FROM "wallet_ledger_entries" le WHERE le."account_id" = ph."id")
  AND NOT EXISTS (SELECT 1 FROM "wallet_credit_grants" g WHERE g."account_id" = ph."id")
  AND EXISTS (
    SELECT 1 FROM "wallet_accounts" ua
    WHERE ua."owner_type" = 'user'
      AND ua."owner_id" = w."owner_user_id"
      AND ua."currency" = 'compute_point'
      AND ua."balance_kind" = 'consumable'
  );

-- 3) Re-key user-owned compute accounts to their personal workspace (same row id,
--    so every grant / allocation / hold / ledger entry stays linked). Any collision
--    here means a non-empty placeholder survived step 2 — that aborts the migration,
--    which is the correct, loud failure.
UPDATE "wallet_accounts" ua
SET "owner_type" = 'workspace',
    "owner_id" = w."id"::text,
    "updated_at" = now()
FROM "workspaces" w
WHERE ua."owner_type" = 'user'
  AND ua."currency" = 'compute_point'
  AND ua."balance_kind" = 'consumable'
  AND w."owner_user_id" = ua."owner_id"
  AND w."type" = 'personal'
  AND w."deleted_at" IS NULL;
