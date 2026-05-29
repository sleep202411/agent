-- Billing catalog operations and promotion governance.
--
-- Internal catalog/promotion records are the source of truth. Provider
-- product, price, and coupon ids are bindings to external payment rails.

CREATE TYPE "BillingPromotionStatus" AS ENUM (
  'draft',
  'active',
  'paused',
  'archived'
);

CREATE TYPE "BillingPromotionDurationType" AS ENUM (
  'once',
  'forever',
  'repeating'
);

CREATE TYPE "BillingPromotionRedemptionStatus" AS ENUM (
  'reserved',
  'applied',
  'voided',
  'refunded'
);

ALTER TABLE "billing_orders"
  ADD COLUMN "subtotal_amount_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount_minor" BIGINT NOT NULL DEFAULT 0;

UPDATE "billing_orders"
SET "subtotal_amount_minor" = "amount_minor"
WHERE "subtotal_amount_minor" = 0;

ALTER TABLE "billing_orders"
  DROP CONSTRAINT "billing_orders_amount_positive";

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_amounts_valid"
    CHECK (
      "subtotal_amount_minor" >= 0
      AND "discount_amount_minor" >= 0
      AND "amount_minor" >= 0
      AND "subtotal_amount_minor" = "amount_minor" + "discount_amount_minor"
    );

CREATE TABLE "billing_promotions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "status" "BillingPromotionStatus" NOT NULL DEFAULT 'draft',
  "percent_off_bps" INTEGER NOT NULL,
  "duration_type" "BillingPromotionDurationType" NOT NULL DEFAULT 'once',
  "duration_count" INTEGER,
  "duration_unit" VARCHAR(16),
  "applies_product_type" "BillingProductType",
  "applies_item_id" UUID,
  "applies_price_id" UUID,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "max_redemptions" INTEGER,
  "max_redemptions_per_user" INTEGER,
  "redemption_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_promotions_code_format"
    CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  CONSTRAINT "billing_promotions_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "billing_promotions_percent_off_range"
    CHECK ("percent_off_bps" > 0 AND "percent_off_bps" <= 10000),
  CONSTRAINT "billing_promotions_duration_shape"
    CHECK (
      (
        "duration_type" <> 'repeating'
        AND "duration_count" IS NULL
        AND "duration_unit" IS NULL
      )
      OR (
        "duration_type" = 'repeating'
        AND "duration_count" IS NOT NULL
        AND "duration_count" > 0
        AND "duration_unit" IN ('day', 'week', 'month', 'year')
      )
    ),
  CONSTRAINT "billing_promotions_time_window"
    CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "billing_promotions_limits_positive"
    CHECK (
      ("max_redemptions" IS NULL OR "max_redemptions" > 0)
      AND ("max_redemptions_per_user" IS NULL OR "max_redemptions_per_user" > 0)
      AND "redemption_count" >= 0
    )
);

CREATE TABLE "billing_promotion_provider_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "promotion_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "provider_coupon_id" VARCHAR(128),
  "status" "BillingProviderBindingStatus" NOT NULL DEFAULT 'active',
  "sync_error" TEXT,
  "provider_payload" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "last_synced_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_promotion_provider_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_promotion_redemptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "promotion_id" UUID NOT NULL,
  "order_id" UUID,
  "user_id" VARCHAR(64) NOT NULL,
  "code_snapshot" VARCHAR(64) NOT NULL,
  "provider" "PaymentProvider",
  "provider_discount_id" VARCHAR(128),
  "status" "BillingPromotionRedemptionStatus" NOT NULL DEFAULT 'reserved',
  "currency" CHAR(3) NOT NULL,
  "subtotal_amount_minor" BIGINT NOT NULL,
  "discount_amount_minor" BIGINT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_promotion_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_promotion_redemptions_code_format"
    CHECK ("code_snapshot" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  CONSTRAINT "billing_promotion_redemptions_currency_upper"
    CHECK ("currency" = upper("currency")),
  CONSTRAINT "billing_promotion_redemptions_amounts_valid"
    CHECK (
      "subtotal_amount_minor" >= 0
      AND "discount_amount_minor" > 0
      AND "discount_amount_minor" <= "subtotal_amount_minor"
    )
);

ALTER TABLE "billing_promotions"
  ADD CONSTRAINT "billing_promotions_applies_item_id_fkey"
  FOREIGN KEY ("applies_item_id") REFERENCES "billing_catalog_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_promotions"
  ADD CONSTRAINT "billing_promotions_applies_price_id_fkey"
  FOREIGN KEY ("applies_price_id") REFERENCES "billing_prices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_promotion_provider_bindings"
  ADD CONSTRAINT "billing_promotion_provider_bindings_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "billing_promotions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_promotion_redemptions"
  ADD CONSTRAINT "billing_promotion_redemptions_promotion_id_fkey"
  FOREIGN KEY ("promotion_id") REFERENCES "billing_promotions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_promotion_redemptions"
  ADD CONSTRAINT "billing_promotion_redemptions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_promotions_code_unique"
  ON "billing_promotions" ("code");

CREATE UNIQUE INDEX "billing_promotion_bindings_promotion_provider_active_unique"
  ON "billing_promotion_provider_bindings" ("promotion_id", "provider")
  WHERE "archived_at" IS NULL;

CREATE UNIQUE INDEX "billing_promotion_bindings_provider_coupon_unique"
  ON "billing_promotion_provider_bindings" ("provider", "provider_coupon_id")
  WHERE "provider_coupon_id" IS NOT NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "billing_promotion_redemptions_order_unique"
  ON "billing_promotion_redemptions" ("order_id")
  WHERE "order_id" IS NOT NULL;

CREATE INDEX "billing_promotions_effective_idx"
  ON "billing_promotions" ("status", "starts_at", "ends_at");

CREATE INDEX "billing_promotions_product_type_idx"
  ON "billing_promotions" ("applies_product_type", "status");

CREATE INDEX "billing_promotions_item_idx"
  ON "billing_promotions" ("applies_item_id", "status");

CREATE INDEX "billing_promotions_price_idx"
  ON "billing_promotions" ("applies_price_id", "status");

CREATE INDEX "billing_promotion_bindings_promotion_idx"
  ON "billing_promotion_provider_bindings" ("promotion_id", "status");

CREATE INDEX "billing_promotion_bindings_provider_idx"
  ON "billing_promotion_provider_bindings" ("provider", "status");

CREATE INDEX "billing_promotion_bindings_provider_coupon_idx"
  ON "billing_promotion_provider_bindings" ("provider", "provider_coupon_id");

CREATE INDEX "billing_promotion_redemptions_promotion_idx"
  ON "billing_promotion_redemptions" ("promotion_id", "status");

CREATE INDEX "billing_promotion_redemptions_user_idx"
  ON "billing_promotion_redemptions" ("user_id", "created_at" DESC);

CREATE INDEX "billing_promotion_redemptions_order_idx"
  ON "billing_promotion_redemptions" ("order_id");
