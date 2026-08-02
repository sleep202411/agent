-- Crew compensation is points-native. Approval accrues withdrawable community
-- points; cash-out debits those points at the fixed launch quote
-- 100 points = USD 1. This branch has not shipped, so the incompatible
-- pre-points settlement rows are intentionally discarded instead of being
-- assigned a fabricated FX rate.

DELETE FROM "crew_settlement_items";

ALTER TABLE "crew_task_assignees"
  DROP CONSTRAINT "crew_task_assignees_reward_check",
  DROP COLUMN "reward_amount",
  DROP COLUMN "reward_currency",
  ADD COLUMN "reward_points" BIGINT;

ALTER TABLE "crew_task_assignees"
  ADD CONSTRAINT "crew_task_assignees_reward_points_check"
  CHECK ("reward_points" IS NULL OR "reward_points" > 0);

ALTER TABLE "crew_settlement_items"
  DROP CONSTRAINT "crew_settlement_items_amount_check",
  DROP COLUMN "amount",
  DROP COLUMN "currency",
  ADD COLUMN "points_amount" BIGINT NOT NULL,
  ADD COLUMN "points_per_usd" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "payout_amount_minor" BIGINT,
  ADD COLUMN "payout_currency" VARCHAR(3),
  ADD COLUMN "accrual_transaction_id" UUID NOT NULL,
  ADD COLUMN "cash_out_transaction_id" UUID;

ALTER TABLE "crew_settlement_items"
  ADD CONSTRAINT "crew_settlement_items_points_amount_check"
    CHECK ("points_amount" > 0),
  ADD CONSTRAINT "crew_settlement_items_points_per_usd_check"
    CHECK ("points_per_usd" = 100),
  ADD CONSTRAINT "crew_settlement_items_cash_out_shape_check"
    CHECK (
      (
        "status" = 'pending'
        AND "payout_amount_minor" IS NULL
        AND "payout_currency" IS NULL
        AND "cash_out_transaction_id" IS NULL
        AND "settled_at" IS NULL
        AND "settled_by_user_id" IS NULL
      )
      OR
      (
        "status" = 'settled'
        AND "payout_amount_minor" IS NOT NULL
        AND "payout_amount_minor" > 0
        AND "payout_currency" = 'USD'
        AND "cash_out_transaction_id" IS NOT NULL
        AND "settled_at" IS NOT NULL
        AND "settled_by_user_id" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX "crew_settlement_items_accrual_tx_unique"
  ON "crew_settlement_items"("accrual_transaction_id");

CREATE UNIQUE INDEX "crew_settlement_items_cash_out_tx_unique"
  ON "crew_settlement_items"("cash_out_transaction_id");

ALTER TABLE "crew_settlement_items"
  ADD CONSTRAINT "crew_settlement_items_accrual_transaction_id_fkey"
  FOREIGN KEY ("accrual_transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crew_settlement_items"
  ADD CONSTRAINT "crew_settlement_items_cash_out_transaction_id_fkey"
  FOREIGN KEY ("cash_out_transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
