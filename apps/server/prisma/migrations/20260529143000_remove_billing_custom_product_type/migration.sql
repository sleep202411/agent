-- Remove the catch-all billing product type from the production contract.
-- Every sellable package must now map to a concrete fulfillment path:
-- AI compute credits, consumable community points, individual membership, or
-- team membership. If historical data used `custom`, stop here so it can be
-- migrated intentionally instead of silently reclassified.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "billing_catalog_items"
    WHERE "product_type" = 'custom'
  ) THEN
    RAISE EXCEPTION 'Cannot remove BillingProductType.custom while billing_catalog_items rows still use it.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "billing_promotions"
    WHERE "applies_product_type" = 'custom'
  ) THEN
    RAISE EXCEPTION 'Cannot remove BillingProductType.custom while billing_promotions rows still reference it.';
  END IF;
END $$;

CREATE TYPE "BillingProductType_new" AS ENUM (
  'bubble_pack',
  'community_point_pack',
  'membership_plan',
  'team_membership_plan'
);

ALTER TABLE "billing_catalog_items"
  ALTER COLUMN "product_type"
  TYPE "BillingProductType_new"
  USING ("product_type"::text::"BillingProductType_new");

ALTER TABLE "billing_promotions"
  ALTER COLUMN "applies_product_type"
  TYPE "BillingProductType_new"
  USING ("applies_product_type"::text::"BillingProductType_new");

DROP TYPE "BillingProductType";

ALTER TYPE "BillingProductType_new" RENAME TO "BillingProductType";

COMMIT;
