-- Production billing ledger.
--
-- Wallet ledger tracks virtual balances. This ledger tracks money:
-- provider receivables, customer clearing, wallet-credit liabilities,
-- deferred subscription revenue, recognized revenue, fees, refunds,
-- settlements, and reconciliation exceptions.

CREATE TYPE "BillingLedgerAllocationTarget" AS ENUM (
  'wallet_credit_liability',
  'subscription_deferred_revenue',
  'immediate_revenue'
);

CREATE TYPE "BillingLedgerAccountType" AS ENUM (
  'asset',
  'liability',
  'revenue',
  'expense',
  'equity',
  'clearing'
);

CREATE TYPE "BillingLedgerNormalBalance" AS ENUM ('debit', 'credit');

CREATE TYPE "BillingLedgerAccountStatus" AS ENUM ('active', 'archived');

CREATE TYPE "BillingLedgerJournalType" AS ENUM (
  'payment_capture',
  'fulfillment_allocation',
  'settlement',
  'refund',
  'chargeback',
  'revenue_recognition',
  'provider_fee',
  'manual_adjustment',
  'reversal'
);

CREATE TYPE "BillingLedgerJournalStatus" AS ENUM (
  'posted',
  'reversed',
  'voided'
);

CREATE TYPE "BillingLedgerEntryDirection" AS ENUM ('debit', 'credit');

CREATE TYPE "BillingSettlementStatus" AS ENUM (
  'pending',
  'reconciled',
  'partially_reconciled',
  'failed'
);

CREATE TYPE "BillingReconciliationStatus" AS ENUM (
  'running',
  'completed',
  'failed'
);

CREATE TYPE "BillingReconciliationItemStatus" AS ENUM (
  'matched',
  'mismatch',
  'missing_internal',
  'missing_provider',
  'ignored'
);

CREATE TABLE "billing_price_ledger_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "price_id" UUID NOT NULL,
  "target" "BillingLedgerAllocationTarget" NOT NULL,
  "allocation_bps" INTEGER,
  "amount_minor" BIGINT,
  "wallet_currency" "WalletCurrencyType",
  "wallet_balance_kind" "WalletBalanceKind",
  "plan_key" VARCHAR(64),
  "revenue_category" VARCHAR(80),
  "priority" INTEGER NOT NULL DEFAULT 100,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_price_ledger_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_price_ledger_allocations_amount_or_bps"
    CHECK (
      ("allocation_bps" IS NOT NULL AND "amount_minor" IS NULL)
      OR ("allocation_bps" IS NULL AND "amount_minor" IS NOT NULL)
    ),
  CONSTRAINT "billing_price_ledger_allocations_bps_range"
    CHECK ("allocation_bps" IS NULL OR ("allocation_bps" > 0 AND "allocation_bps" <= 10000)),
  CONSTRAINT "billing_price_ledger_allocations_amount_positive"
    CHECK ("amount_minor" IS NULL OR "amount_minor" > 0),
  CONSTRAINT "billing_price_ledger_allocations_target_fields"
    CHECK (
      (
        "target" <> 'wallet_credit_liability'
        OR (
          "wallet_currency" IS NOT NULL
          AND "wallet_balance_kind" = 'consumable'
        )
      )
      AND ("target" <> 'subscription_deferred_revenue' OR "plan_key" IS NOT NULL)
    )
);

CREATE TABLE "billing_ledger_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "account_type" "BillingLedgerAccountType" NOT NULL,
  "normal_balance" "BillingLedgerNormalBalance" NOT NULL,
  "status" "BillingLedgerAccountStatus" NOT NULL DEFAULT 'active',
  "currency" CHAR(3) NOT NULL,
  "provider" "PaymentProvider",
  "posted_debit_minor" BIGINT NOT NULL DEFAULT 0,
  "posted_credit_minor" BIGINT NOT NULL DEFAULT 0,
  "balance_minor" BIGINT NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_ledger_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_ledger_accounts_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "billing_ledger_accounts_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "billing_ledger_accounts_currency_upper" CHECK ("currency" = upper("currency"))
);

CREATE TABLE "billing_settlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL,
  "provider_settlement_id" VARCHAR(160) NOT NULL,
  "status" "BillingSettlementStatus" NOT NULL DEFAULT 'pending',
  "currency" CHAR(3) NOT NULL,
  "gross_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "fee_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "net_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "provider_payload" JSONB NOT NULL DEFAULT '{}',
  "settled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_settlements_currency_upper" CHECK ("currency" = upper("currency")),
  CONSTRAINT "billing_settlements_amounts_nonnegative"
    CHECK ("gross_amount_minor" >= 0 AND "fee_amount_minor" >= 0 AND "net_amount_minor" >= 0)
);

CREATE TABLE "billing_ledger_journals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "journal_no" VARCHAR(64) NOT NULL,
  "journal_type" "BillingLedgerJournalType" NOT NULL,
  "status" "BillingLedgerJournalStatus" NOT NULL DEFAULT 'posted',
  "source_type" VARCHAR(80) NOT NULL,
  "source_id" VARCHAR(128),
  "idempotency_key" VARCHAR(180) NOT NULL,
  "provider" "PaymentProvider",
  "currency" CHAR(3) NOT NULL,
  "order_id" UUID,
  "payment_intent_id" UUID,
  "provider_event_id" UUID,
  "settlement_id" UUID,
  "reversal_of_id" UUID,
  "total_debit_minor" BIGINT NOT NULL,
  "total_credit_minor" BIGINT NOT NULL,
  "description" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_ledger_journals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_ledger_journals_no_nonempty" CHECK (btrim("journal_no") <> ''),
  CONSTRAINT "billing_ledger_journals_idempotency_nonempty" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "billing_ledger_journals_currency_upper" CHECK ("currency" = upper("currency")),
  CONSTRAINT "billing_ledger_journals_balanced"
    CHECK ("total_debit_minor" = "total_credit_minor" AND "total_debit_minor" > 0)
);

CREATE TABLE "billing_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "journal_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "direction" "BillingLedgerEntryDirection" NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "balance_after_minor" BIGINT NOT NULL,
  "description" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_ledger_entries_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_ledger_entries_currency_upper" CHECK ("currency" = upper("currency"))
);

CREATE TABLE "billing_reconciliation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL,
  "status" "BillingReconciliationStatus" NOT NULL DEFAULT 'running',
  "currency" CHAR(3),
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6) NOT NULL,
  "checked_at" TIMESTAMPTZ(6),
  "matched_count" INTEGER NOT NULL DEFAULT 0,
  "mismatch_count" INTEGER NOT NULL DEFAULT 0,
  "missing_internal_count" INTEGER NOT NULL DEFAULT 0,
  "missing_provider_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_reconciliation_runs_period_valid" CHECK ("period_end" > "period_start"),
  CONSTRAINT "billing_reconciliation_runs_currency_upper" CHECK ("currency" IS NULL OR "currency" = upper("currency"))
);

CREATE TABLE "billing_reconciliation_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "status" "BillingReconciliationItemStatus" NOT NULL,
  "issue_type" VARCHAR(80),
  "order_id" UUID,
  "payment_intent_id" UUID,
  "provider_event_id" UUID,
  "settlement_id" UUID,
  "provider_reference" VARCHAR(160),
  "currency" CHAR(3) NOT NULL,
  "provider_amount_minor" BIGINT,
  "internal_amount_minor" BIGINT,
  "difference_minor" BIGINT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_reconciliation_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_reconciliation_items_currency_upper" CHECK ("currency" = upper("currency"))
);

ALTER TABLE "billing_price_ledger_allocations"
  ADD CONSTRAINT "billing_price_ledger_allocations_price_id_fkey"
  FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "billing_payment_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_provider_event_id_fkey"
  FOREIGN KEY ("provider_event_id") REFERENCES "billing_payment_provider_events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "billing_settlements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_reversal_of_id_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "billing_ledger_journals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_entries"
  ADD CONSTRAINT "billing_ledger_entries_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "billing_ledger_journals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_entries"
  ADD CONSTRAINT "billing_ledger_entries_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "billing_ledger_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_reconciliation_items"
  ADD CONSTRAINT "billing_reconciliation_items_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "billing_reconciliation_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_reconciliation_items"
  ADD CONSTRAINT "billing_reconciliation_items_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "billing_settlements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_ledger_accounts_code_unique"
  ON "billing_ledger_accounts" ("code");

CREATE UNIQUE INDEX "billing_ledger_journals_no_unique"
  ON "billing_ledger_journals" ("journal_no");

CREATE UNIQUE INDEX "billing_ledger_journals_idempotency_unique"
  ON "billing_ledger_journals" ("idempotency_key");

CREATE UNIQUE INDEX "billing_settlements_provider_unique"
  ON "billing_settlements" ("provider", "provider_settlement_id");

CREATE INDEX "billing_price_ledger_allocations_price_idx"
  ON "billing_price_ledger_allocations" ("price_id", "archived_at", "priority");

CREATE INDEX "billing_ledger_accounts_type_currency_idx"
  ON "billing_ledger_accounts" ("account_type", "currency", "status");

CREATE INDEX "billing_ledger_accounts_provider_currency_idx"
  ON "billing_ledger_accounts" ("provider", "currency", "status");

CREATE INDEX "billing_ledger_journals_type_recent_idx"
  ON "billing_ledger_journals" ("journal_type", "posted_at" DESC);

CREATE INDEX "billing_ledger_journals_source_idx"
  ON "billing_ledger_journals" ("source_type", "source_id");

CREATE INDEX "billing_ledger_journals_order_recent_idx"
  ON "billing_ledger_journals" ("order_id", "posted_at" DESC);

CREATE INDEX "billing_ledger_journals_provider_recent_idx"
  ON "billing_ledger_journals" ("provider", "posted_at" DESC);

CREATE INDEX "billing_ledger_journals_settlement_idx"
  ON "billing_ledger_journals" ("settlement_id");

CREATE INDEX "billing_ledger_entries_account_recent_idx"
  ON "billing_ledger_entries" ("account_id", "created_at" DESC);

CREATE INDEX "billing_ledger_entries_journal_idx"
  ON "billing_ledger_entries" ("journal_id");

CREATE INDEX "billing_settlements_provider_status_idx"
  ON "billing_settlements" ("provider", "status", "settled_at" DESC);

CREATE INDEX "billing_reconciliation_runs_provider_idx"
  ON "billing_reconciliation_runs" ("provider", "status", "created_at" DESC);

CREATE INDEX "billing_reconciliation_items_run_status_idx"
  ON "billing_reconciliation_items" ("run_id", "status");

CREATE INDEX "billing_reconciliation_items_order_idx"
  ON "billing_reconciliation_items" ("order_id");

CREATE INDEX "billing_reconciliation_items_provider_ref_idx"
  ON "billing_reconciliation_items" ("provider_reference");
