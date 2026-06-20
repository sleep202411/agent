-- Redemption vouchers (兑换券 / gift codes / 卡密).
CREATE TYPE "VoucherStatus" AS ENUM ('active', 'redeemed', 'void', 'expired');
CREATE TYPE "VoucherGrantType" AS ENUM ('compute_credits');

CREATE TABLE "vouchers" (
  "id" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "batch_id" UUID,
  "grant_type" "VoucherGrantType" NOT NULL DEFAULT 'compute_credits',
  "compute_credit_amount" INTEGER,
  "status" "VoucherStatus" NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMPTZ(6),
  "redeemed_by_user_id" VARCHAR(64),
  "redeemed_workspace_id" UUID,
  "redeemed_at" TIMESTAMPTZ(6),
  "note" TEXT,
  "created_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vouchers_code_unique" ON "vouchers"("code");
CREATE INDEX "vouchers_batch_idx" ON "vouchers"("batch_id");
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status", "expires_at");
CREATE INDEX "vouchers_redeemer_idx" ON "vouchers"("redeemed_by_user_id");

-- A compute_credits voucher must carry a positive credit amount.
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_compute_amount_check"
  CHECK (
    "grant_type" <> 'compute_credits'
    OR ("compute_credit_amount" IS NOT NULL AND "compute_credit_amount" > 0)
  );
