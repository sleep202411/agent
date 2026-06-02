-- Reopen the creator EARNING side of IP revenue (earning-only — no fiat payout,
-- no refund clawback yet): credit a configurable creator-pool share of each IP
-- sale to the contributors' WITHDRAWABLE community-point wallets, recorded in a
-- dedicated revenue ledger. The 20260528130000 originals were dropped in
-- 20260530131000 as "unclosed"; this re-introduces a lean, closed earning loop.
--
-- Additive + forward-only: only CREATE TYPE / CREATE TABLE / ADD COLUMN / seed.
-- No drops, no backfill of existing rows — safe to run on live .com.

-- Lean enum subset (drop the unused production_fee / referral_commission / platform_fee).
CREATE TYPE "IpRevenueLedgerEntryType" AS ENUM ('revenue_share', 'refund_reversal', 'manual_adjustment');
CREATE TYPE "IpRevenueLedgerStatus" AS ENUM ('pending', 'posted', 'voided');

-- Per-IP override of the platform-vs-creator split (NULL inherits the global default).
ALTER TABLE "ips" ADD COLUMN "creator_revenue_share_bps" INTEGER;
ALTER TABLE "ips" ADD CONSTRAINT "ips_creator_revenue_share_bps_range"
  CHECK ("creator_revenue_share_bps" IS NULL OR ("creator_revenue_share_bps" >= 0 AND "creator_revenue_share_bps" <= 10000));

-- Restore contributor revenue eligibility + add the per-contributor pool share.
ALTER TABLE "ip_contributors" ADD COLUMN "revenue_eligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ip_contributors" ADD COLUMN "revenue_share_bps" INTEGER;
ALTER TABLE "ip_contributors" ADD CONSTRAINT "ip_contributors_revenue_share_bps_range"
  CHECK ("revenue_share_bps" IS NULL OR ("revenue_share_bps" >= 0 AND "revenue_share_bps" <= 10000));

-- Creator revenue ledger — one posted row per beneficiary per order.
CREATE TABLE "ip_revenue_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" VARCHAR(64) NOT NULL,
  "ip_id" UUID NOT NULL,
  "episode_id" UUID,
  "order_id" UUID NOT NULL,
  "wallet_transaction_id" UUID,
  "entry_type" "IpRevenueLedgerEntryType" NOT NULL DEFAULT 'revenue_share',
  "status" "IpRevenueLedgerStatus" NOT NULL DEFAULT 'posted',
  "currency" "WalletCurrencyType" NOT NULL DEFAULT 'community_point',
  "balance_kind" "WalletBalanceKind" NOT NULL DEFAULT 'withdrawable',
  "amount" BIGINT NOT NULL,
  "source_amount" BIGINT,
  "share_bps" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_revenue_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_revenue_ledger_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "ip_revenue_ledger_withdrawable_community_point"
    CHECK ("currency" = 'community_point' AND "balance_kind" = 'withdrawable'),
  CONSTRAINT "ip_revenue_ledger_share_bps_range"
    CHECK ("share_bps" IS NULL OR ("share_bps" >= 0 AND "share_bps" <= 10000))
);

CREATE UNIQUE INDEX "ip_revenue_ledger_order_user_type_unique"
  ON "ip_revenue_ledger_entries" ("order_id", "user_id", "entry_type");
CREATE INDEX "ip_revenue_ledger_user_recent_idx"
  ON "ip_revenue_ledger_entries" ("user_id", "status", "created_at" DESC);
CREATE INDEX "ip_revenue_ledger_ip_recent_idx"
  ON "ip_revenue_ledger_entries" ("ip_id", "status", "created_at" DESC);
CREATE INDEX "ip_revenue_ledger_order_idx"
  ON "ip_revenue_ledger_entries" ("order_id");

ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_ip_id_fkey"
  FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ip_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Admin-editable IP-commerce settings + seed the default creator share (50%).
CREATE TABLE "ip_commerce_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(120) NOT NULL,
  "value_int" BIGINT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_commerce_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ip_commerce_settings_key_unique" ON "ip_commerce_settings" ("key");

INSERT INTO "ip_commerce_settings" ("id", "key", "value_int")
VALUES (gen_random_uuid(), 'ip.creator_revenue_share_bps', 5000)
ON CONFLICT ("key") DO NOTHING;
