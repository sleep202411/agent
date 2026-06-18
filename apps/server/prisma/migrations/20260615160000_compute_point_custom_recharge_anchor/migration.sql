-- Hidden anchor SKU for arbitrary-amount COMPUTE-point recharge.
--
-- Mirrors the community-point custom-recharge anchor (migration
-- 20260602140000_billing_order_grant_snapshot) but funds the compute_point
-- (AI-generation) wallet. Carries only the points-per-unit ratio
-- (grants_wallet_amount = points per US$1) + the wallet currency for ledger
-- routing; the real fiat amount + grant live on each order via the order grant
-- snapshot columns and order.amountMinor. It has NO provider price binding, so it
-- never surfaces in the public price listing or the compute-topup-packages listing
-- (both require an active binding) and is reachable only by the dedicated
-- /billing/recharge-custom endpoint when currency=compute_point. The pack endpoint
-- cannot misuse it either: assertComputePointTopupPrice requires metadata.topupKind
-- = 'compute_point', which this anchor deliberately omits.
--
-- compute_point is anchored 1 point = 1 US cent, so US$1 = 100 compute points.
-- Idempotent: guarded by NOT EXISTS so re-applying / multi-env deploys are safe.
INSERT INTO "billing_catalog_items"
  ("id", "product_type", "code", "name", "description", "is_active")
SELECT
  gen_random_uuid(),
  'compute_point_pack',
  'COMPUTE_POINT_CUSTOM_RECHARGE',
  'Compute points (custom amount)',
  'Ad-hoc compute point top-up billed in whole US dollars at 100 points per US$1.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "billing_catalog_items"
  WHERE "code" = 'COMPUTE_POINT_CUSTOM_RECHARGE'
);

INSERT INTO "billing_prices"
  ("id", "item_id", "currency", "amount_minor", "interval", "subject_type",
   "grants_wallet_currency", "grants_wallet_balance_kind", "grants_wallet_amount",
   "is_active", "metadata")
SELECT
  gen_random_uuid(),
  i."id",
  'USD',
  100,            -- $1 placeholder; the real fiat amount lives on each order
  'one_time',
  'user',
  'compute_point',
  'consumable',
  100,            -- points granted per US$1 (the ratio; order snapshot = ratio * dollars)
  true,
  '{"customRecharge": {"pointsPerDollar": 100, "minDollars": 10, "maxDollars": 5000}}'::jsonb
FROM "billing_catalog_items" i
WHERE i."code" = 'COMPUTE_POINT_CUSTOM_RECHARGE'
  AND NOT EXISTS (
    SELECT 1 FROM "billing_prices" p WHERE p."item_id" = i."id"
  );
