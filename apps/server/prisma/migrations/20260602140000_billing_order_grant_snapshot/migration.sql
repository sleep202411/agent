-- Order-level wallet-grant snapshot.
--
-- Freezes the wallet grant on the order at checkout time instead of reading it
-- live from the price at fulfillment/refund. This (a) lets an ad-hoc custom-amount
-- recharge carry a per-order grant the catalog price cannot express, and (b) makes
-- fulfillment + refund authoritative off a single frozen figure so the grant can
-- never drift if a price's grant is ever edited. All three columns are nullable and
-- additive: existing/in-flight orders keep NULL and fall back to the price grant, so
-- there is no behavioural change and no backfill.
ALTER TABLE "billing_orders"
  ADD COLUMN "grants_wallet_amount" BIGINT,
  ADD COLUMN "grants_wallet_currency" "WalletCurrencyType",
  ADD COLUMN "grants_wallet_balance_kind" "WalletBalanceKind";

-- Hidden anchor SKU for arbitrary-amount community-point recharge.
--
-- Carries only the points-per-unit ratio (grants_wallet_amount = points per US$1)
-- and the wallet currency for ledger routing; the real fiat amount + grant live on
-- each order via the snapshot columns above and order.amountMinor. It has NO provider
-- price binding, so it never surfaces in the public price listing (listPrices requires
-- an active binding) and is reachable only by the dedicated /billing/recharge-custom
-- endpoint. It carries NO ledger allocations, so fulfillment uses the inferred
-- wallet_credit_liability path which balances off order.amountMinor for any amount.
-- Idempotent: guarded by NOT EXISTS so re-applying / multi-env deploys are safe.
INSERT INTO "billing_catalog_items"
  ("id", "product_type", "code", "name", "description", "is_active")
SELECT
  gen_random_uuid(),
  'community_point_pack',
  'COMMUNITY_POINT_CUSTOM_RECHARGE',
  'Community points (custom amount)',
  'Ad-hoc community point top-up billed in whole US dollars at 100 points per US$1.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "billing_catalog_items"
  WHERE "code" = 'COMMUNITY_POINT_CUSTOM_RECHARGE'
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
  'community_point',
  'consumable',
  100,            -- points granted per US$1 (the ratio; order snapshot = ratio * dollars)
  true,
  '{"customRecharge": {"pointsPerDollar": 100, "minDollars": 10, "maxDollars": 5000}}'::jsonb
FROM "billing_catalog_items" i
WHERE i."code" = 'COMMUNITY_POINT_CUSTOM_RECHARGE'
  AND NOT EXISTS (
    SELECT 1 FROM "billing_prices" p WHERE p."item_id" = i."id"
  );
