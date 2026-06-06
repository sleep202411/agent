-- Parameterized pricing economics.
-- COST lives per-binding (provider-specific, nano-USD integer, sub-cent precise);
-- MARKUP lives per-canonical-model (basis points). 1 积分 = $0.01 = 1e7 nanoUSD.
-- Sell price is computed (estimator), not stored: sell = ceil(cost / (1 - marginBps/10000)).

CREATE TYPE "AiGenUnitType" AS ENUM ('per_image', 'per_megapixel', 'per_unit');

ALTER TABLE "ai_provider_model_bindings"
  ADD COLUMN "unit_price_nano_usd" BIGINT DEFAULT 0,
  ADD COLUMN "unit_type" "AiGenUnitType" NOT NULL DEFAULT 'per_image';

ALTER TABLE "ai_canonical_models"
  ADD COLUMN "margin_bps" INTEGER NOT NULL DEFAULT 7000;
