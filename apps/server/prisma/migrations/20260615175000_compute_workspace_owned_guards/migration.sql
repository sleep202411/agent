-- Guards + backfill that finish the compute_point → workspace-owned re-key
-- (migration 20260615170000). Kept as a separate, idempotent recovery step: if
-- the prior re-key left funds behind because a user had no personal workspace,
-- this migration creates the missing personal workspace/member, heals the wallet
-- owner, and asserts before the column is dropped (180000).

-- 1) Self-heal: ensure every user-owned compute account has a personal workspace
--    and active owner membership. This mirrors WorkspacesService bootstrap, but
--    runs in SQL so deploy recovery does not require manual prod data surgery.
WITH missing_personal_workspace AS (
  SELECT DISTINCT ua."owner_id"
  FROM "wallet_accounts" ua
  WHERE ua."owner_type" = 'user'
    AND ua."currency" = 'compute_point'
    AND ua."balance_kind" = 'consumable'
    AND NOT EXISTS (
      SELECT 1 FROM "workspaces" w
      WHERE w."owner_user_id" = ua."owner_id"
        AND w."type" = 'personal'
        AND w."deleted_at" IS NULL
    )
)
INSERT INTO "workspaces" (
  "type",
  "status",
  "name",
  "owner_user_id",
  "created_by_id",
  "created_at",
  "updated_at"
)
SELECT
  'personal',
  'active',
  missing."owner_id" || '''s Workspace',
  missing."owner_id",
  missing."owner_id",
  now(),
  now()
FROM missing_personal_workspace missing
ON CONFLICT DO NOTHING;

INSERT INTO "workspace_members" (
  "workspace_id",
  "user_id",
  "role",
  "status",
  "seat_assigned",
  "joined_at",
  "created_at",
  "updated_at"
)
SELECT
  w."id",
  w."owner_user_id",
  'owner',
  'active',
  true,
  now(),
  now(),
  now()
FROM "workspaces" w
WHERE w."type" = 'personal'
  AND w."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "wallet_accounts" ua
    WHERE ua."owner_type" = 'user'
      AND ua."owner_id" = w."owner_user_id"
      AND ua."currency" = 'compute_point'
      AND ua."balance_kind" = 'consumable'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_members" m
    WHERE m."workspace_id" = w."id"
      AND m."user_id" = w."owner_user_id"
      AND m."removed_at" IS NULL
  )
ON CONFLICT DO NOTHING;

-- 2) Self-heal: merge any already-created personal workspace compute account into
--    the user-owned account before re-keying. Some production users opened the
--    studio after workspace wallets existed, so the target slot may hold balance
--    or child rows instead of being a disposable empty placeholder. Keep the
--    user account id, move the target account children into it, add aggregate
--    balances, then remove the conflicting target account.
WITH duplicate_compute_accounts AS (
  SELECT
    ua."id" AS user_account_id,
    wa."id" AS workspace_account_id
  FROM "wallet_accounts" ua
  JOIN "workspaces" w
    ON w."owner_user_id" = ua."owner_id"
   AND w."type" = 'personal'
   AND w."deleted_at" IS NULL
  JOIN "wallet_accounts" wa
    ON wa."owner_type" = 'workspace'
   AND wa."owner_id" = w."id"::text
   AND wa."currency" = ua."currency"
   AND wa."balance_kind" = ua."balance_kind"
  WHERE ua."owner_type" = 'user'
    AND ua."currency" = 'compute_point'
    AND ua."balance_kind" = 'consumable'
)
UPDATE "wallet_ledger_entries" le
SET "account_id" = d."user_account_id"
FROM duplicate_compute_accounts d
WHERE le."account_id" = d."workspace_account_id";

WITH duplicate_compute_accounts AS (
  SELECT
    ua."id" AS user_account_id,
    wa."id" AS workspace_account_id
  FROM "wallet_accounts" ua
  JOIN "workspaces" w
    ON w."owner_user_id" = ua."owner_id"
   AND w."type" = 'personal'
   AND w."deleted_at" IS NULL
  JOIN "wallet_accounts" wa
    ON wa."owner_type" = 'workspace'
   AND wa."owner_id" = w."id"::text
   AND wa."currency" = ua."currency"
   AND wa."balance_kind" = ua."balance_kind"
  WHERE ua."owner_type" = 'user'
    AND ua."currency" = 'compute_point'
    AND ua."balance_kind" = 'consumable'
)
UPDATE "wallet_credit_grants" g
SET "account_id" = d."user_account_id"
FROM duplicate_compute_accounts d
WHERE g."account_id" = d."workspace_account_id";

WITH duplicate_compute_accounts AS (
  SELECT
    ua."id" AS user_account_id,
    wa."id" AS workspace_account_id,
    wa."available_balance",
    wa."held_balance"
  FROM "wallet_accounts" ua
  JOIN "workspaces" w
    ON w."owner_user_id" = ua."owner_id"
   AND w."type" = 'personal'
   AND w."deleted_at" IS NULL
  JOIN "wallet_accounts" wa
    ON wa."owner_type" = 'workspace'
   AND wa."owner_id" = w."id"::text
   AND wa."currency" = ua."currency"
   AND wa."balance_kind" = ua."balance_kind"
  WHERE ua."owner_type" = 'user'
    AND ua."currency" = 'compute_point'
    AND ua."balance_kind" = 'consumable'
)
UPDATE "wallet_accounts" ua
SET "available_balance" = ua."available_balance" + d."available_balance",
    "held_balance" = ua."held_balance" + d."held_balance",
    "version" = ua."version" + 1,
    "updated_at" = now()
FROM duplicate_compute_accounts d
WHERE ua."id" = d."user_account_id";

WITH duplicate_compute_accounts AS (
  SELECT wa."id" AS workspace_account_id
  FROM "wallet_accounts" ua
  JOIN "workspaces" w
    ON w."owner_user_id" = ua."owner_id"
   AND w."type" = 'personal'
   AND w."deleted_at" IS NULL
  JOIN "wallet_accounts" wa
    ON wa."owner_type" = 'workspace'
   AND wa."owner_id" = w."id"::text
   AND wa."currency" = ua."currency"
   AND wa."balance_kind" = ua."balance_kind"
  WHERE ua."owner_type" = 'user'
    AND ua."currency" = 'compute_point'
    AND ua."balance_kind" = 'consumable'
)
DELETE FROM "wallet_accounts" wa
USING duplicate_compute_accounts d
WHERE wa."id" = d."workspace_account_id";

-- 3) Self-heal: re-key any user-owned compute account whose owner has a personal
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

-- 4) Fail loud: a user-owned compute account that still exists means the
--    backfill/re-key could not safely move it. Its funds (and any future credit)
--    would be stranded in an invisible, unspendable pot once the resolvers go
--    workspace-only.
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

-- 5) Backfill historical compute_point orders from user-subject to the owner's
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
