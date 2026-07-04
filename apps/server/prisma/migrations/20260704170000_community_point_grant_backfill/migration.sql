-- Make community_point/consumable credit-grant-backed (like compute_point) so
-- GIFTED community points can expire (referral rewards, 30d) while PAID recharge
-- credits never do. The runtime switch is isGrantBackedCurrencyKind() in
-- wallet-ledger.service.ts; this migration backfills EXISTING balances into
-- never-expiring `migration` grants so the FIFO spend engine has lots to consume
-- (an un-backfilled positive balance would throw INSUFFICIENT_UNEXPIRED_WALLET_GRANTS
-- on the next spend). Runs at pod start, BEFORE the new code serves traffic.
--
-- Existing balances are treated as paid/legitimate assets → expires_at = NULL.
-- WITHDRAWABLE community_point (the cash-out pool) is deliberately excluded — it
-- is not grant-backed. community held_balance is always 0 today. Idempotent via
-- the NOT EXISTS guard, so a re-run (or an account already backfilled by the
-- compute migration's pattern) inserts nothing.

INSERT INTO "wallet_credit_grants" (
  "id",
  "account_id",
  "transaction_id",
  "grant_type",
  "status",
  "total_amount",
  "available_amount",
  "held_amount",
  "consumed_amount",
  "expired_amount",
  "reversed_amount",
  "priority",
  "valid_from",
  "expires_at",
  "source_type",
  "source_id",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  wa."id",
  NULL,
  'migration',
  'active',
  wa."available_balance" + wa."held_balance",
  wa."available_balance",
  wa."held_balance",
  0,
  0,
  0,
  1000,
  wa."created_at",
  NULL,
  'wallet_balance_backfill',
  wa."id"::TEXT,
  jsonb_build_object(
    'reason', 'community_point_grant_backfill',
    'availableBalance', wa."available_balance"::TEXT,
    'heldBalance', wa."held_balance"::TEXT
  ),
  clock_timestamp(),
  clock_timestamp()
FROM "wallet_accounts" wa
WHERE wa."currency" = 'community_point'
  AND wa."balance_kind" = 'consumable'
  AND (wa."available_balance" > 0 OR wa."held_balance" > 0)
  AND NOT EXISTS (
    SELECT 1 FROM "wallet_credit_grants" g WHERE g."account_id" = wa."id"
  );

-- Reconciliation guard: after backfill, every grant-backed community consumable
-- account's denormalized available_balance MUST equal the sum of its active
-- grants' available_amount. Abort the migration loudly on any drift rather than
-- ship a wallet the spend engine can't reconcile.
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "wallet_accounts" wa
  WHERE wa."currency" = 'community_point'
    AND wa."balance_kind" = 'consumable'
    AND wa."available_balance" <> COALESCE((
      SELECT sum(g."available_amount")
      FROM "wallet_credit_grants" g
      WHERE g."account_id" = wa."id"
        AND g."status" = 'active'
    ), 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'community_point grant backfill reconciliation failed: % account(s) have available_balance != sum(active grants)', bad_count;
  END IF;
END $$;
