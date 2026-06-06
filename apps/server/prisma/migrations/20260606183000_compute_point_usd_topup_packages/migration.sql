-- USD-only compute-point top-up packages.
--
-- Compute points are anchored to USD cents:
--   1 compute_point = US$0.01
-- Airwallex may offer local payment methods / FX to the shopper, but the
-- FizzDragon order currency and wallet grant remain USD-cent exact.

WITH packages(code, name, description, amount_minor, points, sort_order) AS (
  VALUES
    (
      'COMPUTE_POINT_5000_USD_5000',
      '5,000 compute points',
      'USD 50.00 compute-point top-up. Grants 5,000 consumable compute points.',
      5000::BIGINT,
      5000::BIGINT,
      10
    ),
    (
      'COMPUTE_POINT_10000_USD_10000',
      '10,000 compute points',
      'USD 100.00 compute-point top-up. Grants 10,000 consumable compute points.',
      10000::BIGINT,
      10000::BIGINT,
      20
    ),
    (
      'COMPUTE_POINT_30000_USD_30000',
      '30,000 compute points',
      'USD 300.00 compute-point top-up. Grants 30,000 consumable compute points.',
      30000::BIGINT,
      30000::BIGINT,
      30
    )
)
INSERT INTO "billing_catalog_items"
  ("id", "product_type", "code", "name", "description", "is_active", "metadata")
SELECT
  gen_random_uuid(),
  'compute_point_pack',
  p.code,
  p.name,
  p.description,
  true,
  jsonb_build_object(
    'topupKind', 'compute_point',
    'fiatCurrency', 'USD',
    'sortOrder', p.sort_order,
    'exchangeRate', jsonb_build_object(
      'computePointsPerUsdCent', 1,
      'usdCentsPerComputePoint', 1
    )
  )
FROM packages p
WHERE NOT EXISTS (
  SELECT 1 FROM "billing_catalog_items" i WHERE i."code" = p.code
);

WITH packages(code, amount_minor, points, sort_order) AS (
  VALUES
    ('COMPUTE_POINT_5000_USD_5000', 5000::BIGINT, 5000::BIGINT, 10),
    ('COMPUTE_POINT_10000_USD_10000', 10000::BIGINT, 10000::BIGINT, 20),
    ('COMPUTE_POINT_30000_USD_30000', 30000::BIGINT, 30000::BIGINT, 30)
)
INSERT INTO "billing_prices"
  ("id", "item_id", "currency", "amount_minor", "interval", "subject_type",
   "grants_wallet_currency", "grants_wallet_balance_kind", "grants_wallet_amount",
   "is_active", "metadata")
SELECT
  gen_random_uuid(),
  i."id",
  'USD',
  p.amount_minor,
  'one_time',
  'user',
  'compute_point',
  'consumable',
  p.points,
  true,
  jsonb_build_object(
    'topupKind', 'compute_point',
    'sortOrder', p.sort_order,
    'exchangeRate', jsonb_build_object(
      'computePointsPerUsdCent', 1,
      'usdCentsPerComputePoint', 1
    )
  )
FROM packages p
JOIN "billing_catalog_items" i ON i."code" = p.code
WHERE NOT EXISTS (
  SELECT 1
  FROM "billing_prices" existing
  WHERE existing."item_id" = i."id"
    AND existing."currency" = 'USD'
    AND existing."amount_minor" = p.amount_minor
    AND existing."archived_at" IS NULL
);
