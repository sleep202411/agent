CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "WorkspaceBillingMode" AS ENUM (
  'member_pays',
  'workspace_pool'
);

ALTER TABLE "workspaces"
  ADD COLUMN "billing_mode" "WorkspaceBillingMode" NOT NULL DEFAULT 'member_pays';

ALTER TYPE "WalletLedgerEntryType" ADD VALUE IF NOT EXISTS 'expire';

CREATE TYPE "WalletCreditGrantType" AS ENUM (
  'purchase_topup',
  'membership_included',
  'check_in_reward',
  'campaign_reward',
  'admin_adjustment',
  'refund_return',
  'migration',
  'system_grant',
  'other'
);

CREATE TYPE "WalletCreditGrantStatus" AS ENUM (
  'active',
  'exhausted',
  'expired',
  'reversed',
  'voided'
);

CREATE TABLE "wallet_credit_grants" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "transaction_id" UUID,
  "grant_type" "WalletCreditGrantType" NOT NULL,
  "status" "WalletCreditGrantStatus" NOT NULL DEFAULT 'active',
  "total_amount" BIGINT NOT NULL,
  "available_amount" BIGINT NOT NULL DEFAULT 0,
  "held_amount" BIGINT NOT NULL DEFAULT 0,
  "consumed_amount" BIGINT NOT NULL DEFAULT 0,
  "expired_amount" BIGINT NOT NULL DEFAULT 0,
  "reversed_amount" BIGINT NOT NULL DEFAULT 0,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6),
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" VARCHAR(128),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_credit_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_credit_grants_amount_nonnegative"
    CHECK (
      "total_amount" >= 0
      AND "available_amount" >= 0
      AND "held_amount" >= 0
      AND "consumed_amount" >= 0
      AND "expired_amount" >= 0
      AND "reversed_amount" >= 0
    ),
  CONSTRAINT "wallet_credit_grants_amount_conservation"
    CHECK (
      "available_amount"
      + "held_amount"
      + "consumed_amount"
      + "expired_amount"
      + "reversed_amount"
      = "total_amount"
    ),
  CONSTRAINT "wallet_credit_grants_time_window"
    CHECK ("expires_at" IS NULL OR "expires_at" > "valid_from")
);

CREATE TABLE "wallet_credit_allocations" (
  "id" UUID NOT NULL,
  "grant_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  "amount" BIGINT NOT NULL,
  "available_delta" BIGINT NOT NULL DEFAULT 0,
  "held_delta" BIGINT NOT NULL DEFAULT 0,
  "consumed_delta" BIGINT NOT NULL DEFAULT 0,
  "expired_delta" BIGINT NOT NULL DEFAULT 0,
  "reversed_delta" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_credit_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_credit_allocations_amount_positive" CHECK ("amount" > 0)
);

ALTER TABLE "wallet_credit_grants"
  ADD CONSTRAINT "wallet_credit_grants_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_credit_grants"
  ADD CONSTRAINT "wallet_credit_grants_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_credit_allocations"
  ADD CONSTRAINT "wallet_credit_allocations_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "wallet_credit_grants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_credit_allocations"
  ADD CONSTRAINT "wallet_credit_allocations_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_credit_allocations"
  ADD CONSTRAINT "wallet_credit_allocations_ledger_entry_id_fkey"
  FOREIGN KEY ("ledger_entry_id") REFERENCES "wallet_ledger_entries"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "wallet_credit_grants_account_spend_idx"
  ON "wallet_credit_grants" ("account_id", "status", "expires_at", "priority", "created_at");

CREATE INDEX "wallet_credit_grants_source_idx"
  ON "wallet_credit_grants" ("source_type", "source_id");

CREATE INDEX "wallet_credit_grants_transaction_idx"
  ON "wallet_credit_grants" ("transaction_id");

CREATE INDEX "wallet_credit_allocations_grant_recent_idx"
  ON "wallet_credit_allocations" ("grant_id", "created_at" DESC);

CREATE INDEX "wallet_credit_allocations_transaction_idx"
  ON "wallet_credit_allocations" ("transaction_id");

CREATE INDEX "wallet_credit_allocations_ledger_entry_idx"
  ON "wallet_credit_allocations" ("ledger_entry_id");

-- Backfill pre-existing aggregate wallet balances into a single migration grant
-- per account. This keeps dev/preprod data consumable after the new grant-level
-- spend engine becomes authoritative for compute-point consumable balances.
INSERT INTO "wallet_credit_grants" (
  "id",
  "account_id",
  "transaction_id",
  "grant_type",
  "status",
  "total_amount",
  "available_amount",
  "held_amount",
  "consumed_amount",
  "expired_amount",
  "reversed_amount",
  "priority",
  "valid_from",
  "expires_at",
  "source_type",
  "source_id",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  "id",
  NULL,
  'migration',
  'active',
  "available_balance" + "held_balance",
  "available_balance",
  "held_balance",
  0,
  0,
  0,
  1000,
  "created_at",
  NULL,
  'wallet_balance_backfill',
  "id"::TEXT,
  jsonb_build_object(
    'reason', 'wallet_credit_grants_migration',
    'availableBalance', "available_balance"::TEXT,
    'heldBalance', "held_balance"::TEXT
  ),
  clock_timestamp(),
  clock_timestamp()
FROM "wallet_accounts"
WHERE "currency" = 'compute_point'
  AND "balance_kind" = 'consumable'
  AND ("available_balance" > 0 OR "held_balance" > 0);
