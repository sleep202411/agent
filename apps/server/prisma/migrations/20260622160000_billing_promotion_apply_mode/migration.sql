-- Add an apply-mode to billing promotions so the SAME discount engine powers
-- both user-entered coupons (apply_mode='code') and no-code automatic sales /
-- 促销活动价 (apply_mode='automatic'). Automatic promotions carry no code and
-- are auto-applied to a scoped price at checkout (best-discount-wins).
--
-- `code` becomes nullable. The existing UNIQUE on (code) stays: Postgres
-- NULLS DISTINCT makes it effectively partial — many automatic rows (code NULL)
-- coexist while every non-null code remains unique. findUnique({code}) is
-- unaffected (it is only ever called with a non-null code).

-- 1. The enum type. Guarded so the migration is safe to re-run by hand.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingPromotionApplyMode') THEN
    CREATE TYPE "BillingPromotionApplyMode" AS ENUM ('code', 'automatic');
  END IF;
END
$$;

-- 2. apply_mode column (existing rows are coupons → default 'code').
ALTER TABLE "billing_promotions"
  ADD COLUMN IF NOT EXISTS "apply_mode" "BillingPromotionApplyMode" NOT NULL DEFAULT 'code';

-- 3. code is no longer required (automatic promotions have none).
ALTER TABLE "billing_promotions"
  ALTER COLUMN "code" DROP NOT NULL;

-- 4. Money-correctness invariants, enforced at the DB (fail loud, not in app only).

-- 4a. Mode/code coupling: a coupon must have a code; an automatic sale must not.
ALTER TABLE "billing_promotions"
  DROP CONSTRAINT IF EXISTS "billing_promotions_apply_mode_code_shape";
ALTER TABLE "billing_promotions"
  ADD CONSTRAINT "billing_promotions_apply_mode_code_shape"
  CHECK (
    ("apply_mode" = 'code' AND "code" IS NOT NULL)
    OR ("apply_mode" = 'automatic' AND "code" IS NULL)
  );

-- 4b. An automatic sale must be scoped (price / item / product type) so it can
--     never become a silent site-wide discount.
ALTER TABLE "billing_promotions"
  DROP CONSTRAINT IF EXISTS "billing_promotions_automatic_scoped";
ALTER TABLE "billing_promotions"
  ADD CONSTRAINT "billing_promotions_automatic_scoped"
  CHECK (
    "apply_mode" <> 'automatic'
    OR "applies_price_id" IS NOT NULL
    OR "applies_item_id" IS NOT NULL
    OR "applies_product_type" IS NOT NULL
  );

-- 4c. Per-user redemption limits are a code-mode concept (they key off the
--     redeeming user identity); an automatic sale applies to everyone, so the
--     per-user cap must be null for automatic.
ALTER TABLE "billing_promotions"
  DROP CONSTRAINT IF EXISTS "billing_promotions_automatic_no_per_user_limit";
ALTER TABLE "billing_promotions"
  ADD CONSTRAINT "billing_promotions_automatic_no_per_user_limit"
  CHECK (
    "apply_mode" <> 'automatic'
    OR "max_redemptions_per_user" IS NULL
  );

-- 5. Fast lookup for the automatic resolver (apply_mode + status + window).
CREATE INDEX IF NOT EXISTS "billing_promotions_automatic_idx"
  ON "billing_promotions" ("apply_mode", "status", "starts_at", "ends_at");
