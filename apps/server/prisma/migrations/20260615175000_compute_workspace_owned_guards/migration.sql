-- Guards + backfill that finish the compute_point → workspace-owned re-key
-- (migration 20260615170000). Kept as a separate, idempotent step so it is also
-- the recovery path: if the prior re-key left funds behind because a user had no
-- personal workspace, an operator can create the missing workspaces and re-deploy
-- — this migration then heals and asserts before the column is dropped (180000).

-- 1) Self-heal: re-key any user-owned compute account whose owner has a personal
--    workspace now (idempotent — matches 0 rows when 170000 already covered all).
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

UPDATE "wallet_accounts" ua
SET "owner_type" = 'workspace', "owner_id" = w."id"::text, "updated_at" = now()
FROM "workspaces" w
WHERE ua."owner_type" = 'user'
  AND ua."currency" = 'compute_point'
  AND ua."balance_kind" = 'consumable'
  AND w."owner_user_id" = ua."owner_id"
  AND w."type" = 'personal'
  AND w."deleted_at" IS NULL;

-- 2) Fail loud: a user-owned compute account that still exists means its owner has
--    no personal workspace — its funds (and any future credit) would be stranded
--    in an invisible, unspendable pot once the resolvers go workspace-only. Abort
--    so the operator backfills those users' personal workspaces and re-deploys.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "wallet_accounts"
    WHERE "owner_type" = 'user'
      AND "currency" = 'compute_point'
      AND "balance_kind" = 'consumable'
  ) THEN
    RAISE EXCEPTION 'compute_point migration incomplete: user-owned compute accounts remain (owners without a personal workspace). Backfill personal workspaces for these users and re-deploy.';
  END IF;
END $$;

-- 3) Backfill historical compute_point orders from user-subject to the owner's
--    personal workspace, so refunds + reporting resolve to the re-keyed account
--    (matches the runtime redirect in resolveOrderWalletOwnerTx).
UPDATE "billing_orders" o
SET "subject_type" = 'workspace',
    "subject_id" = w."id"::text,
    "workspace_id" = w."id",
    "updated_at" = now()
FROM "workspaces" w
WHERE o."subject_type" = 'user'
  AND o."grants_wallet_currency" = 'compute_point'
  AND o."subject_id" = w."owner_user_id"
  AND w."type" = 'personal'
  AND w."deleted_at" IS NULL;
