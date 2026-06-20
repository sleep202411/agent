-- Fixed-amount ($X off) promotions.
-- percent_off_bps becomes optional; add a mutually-exclusive fixed-amount discount.
ALTER TABLE "billing_promotions" ALTER COLUMN "percent_off_bps" DROP NOT NULL;
ALTER TABLE "billing_promotions" ADD COLUMN "amount_off_minor" INTEGER;
ALTER TABLE "billing_promotions" ADD COLUMN "amount_off_currency" VARCHAR(3);

-- Exactly one discount kind must be set, and a fixed-amount discount must carry a
-- currency (it only applies to orders in that currency). Existing rows all have
-- percent_off_bps set, so they satisfy this (1 + 0 = 1).
ALTER TABLE "billing_promotions" ADD CONSTRAINT "billing_promotions_discount_kind_check"
  CHECK (
    (("percent_off_bps" IS NOT NULL)::int + ("amount_off_minor" IS NOT NULL)::int) = 1
    AND ("amount_off_minor" IS NULL OR "amount_off_currency" IS NOT NULL)
  );
