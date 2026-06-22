-- Automatic (no-code) promotions produce redemption rows with no code to
-- snapshot. Make code_snapshot nullable; it stays populated for coupon
-- redemptions and is NULL for automatic-sale redemptions.
ALTER TABLE "billing_promotion_redemptions"
  ALTER COLUMN "code_snapshot" DROP NOT NULL;
