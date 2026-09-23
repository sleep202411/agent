-- WeChat Pay charges the amount stored on the internal billing price directly.
-- It has no provider-side product/price catalog, so pending/failed sync states
-- can never complete and incorrectly hide otherwise valid China-site prices.
UPDATE "billing_provider_price_bindings" AS "binding"
SET
  "status" = 'active',
  "sync_error" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
FROM "billing_prices" AS "price"
WHERE
  "binding"."price_id" = "price"."id"
  AND "binding"."provider" = 'wechat_pay'
  AND "price"."currency" = 'CNY'
  AND "binding"."archived_at" IS NULL
  AND "binding"."status" IN ('sync_pending', 'sync_failed');
