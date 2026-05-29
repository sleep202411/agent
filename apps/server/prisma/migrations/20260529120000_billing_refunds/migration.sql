-- Billing refunds.
--
-- Refunds are internal business events first and provider calls second. The
-- refund row is the idempotency anchor; refund events capture state changes;
-- ledger journals post only after provider acceptance/settlement.

CREATE TYPE "BillingRefundStatus" AS ENUM (
  'requested',
  'provider_pending',
  'succeeded',
  'failed',
  'canceled'
);

ALTER TABLE "billing_orders"
  ADD COLUMN "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_refunded_amount_valid"
    CHECK (
      "refunded_amount_minor" >= 0
      AND "refunded_amount_minor" <= "amount_minor"
    );

CREATE TABLE "billing_refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "refund_no" VARCHAR(64) NOT NULL,
  "order_id" UUID NOT NULL,
  "payment_intent_id" UUID,
  "provider" "PaymentProvider" NOT NULL,
  "status" "BillingRefundStatus" NOT NULL DEFAULT 'requested',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "request_id" VARCHAR(64) NOT NULL,
  "provider_refund_id" VARCHAR(128),
  "provider_payment_intent_id" VARCHAR(128),
  "provider_status" VARCHAR(64),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "reason_code" VARCHAR(64) NOT NULL,
  "operator_note" TEXT,
  "wallet_reversal_currency" "WalletCurrencyType",
  "wallet_reversal_amount" BIGINT,
  "wallet_transaction_id" UUID,
  "entitlement_grant_id" UUID,
  "failure_code" VARCHAR(80),
  "failure_message" TEXT,
  "provider_payload" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "requested_by_id" VARCHAR(64) NOT NULL,
  "submitted_at" TIMESTAMPTZ(6),
  "succeeded_at" TIMESTAMPTZ(6),
  "failed_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_refunds_no_nonempty" CHECK (btrim("refund_no") <> ''),
  CONSTRAINT "billing_refunds_idempotency_nonempty" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "billing_refunds_request_id_nonempty" CHECK (btrim("request_id") <> ''),
  CONSTRAINT "billing_refunds_currency_upper" CHECK ("currency" = upper("currency")),
  CONSTRAINT "billing_refunds_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_refunds_wallet_reversal_valid"
    CHECK (
      (
        "wallet_reversal_currency" IS NULL
        AND "wallet_reversal_amount" IS NULL
        AND "wallet_transaction_id" IS NULL
      )
      OR (
        "wallet_reversal_currency" IS NOT NULL
        AND "wallet_reversal_amount" IS NOT NULL
        AND "wallet_reversal_amount" > 0
      )
    ),
  CONSTRAINT "billing_refunds_status_timestamps_valid"
    CHECK (
      ("status" <> 'succeeded' OR "succeeded_at" IS NOT NULL)
      AND ("status" <> 'failed' OR "failed_at" IS NOT NULL)
      AND ("status" <> 'canceled' OR "canceled_at" IS NOT NULL)
    )
);

CREATE TABLE "billing_refund_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "refund_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "from_status" "BillingRefundStatus",
  "to_status" "BillingRefundStatus",
  "provider_status" VARCHAR(64),
  "provider_event_id" UUID,
  "actor_admin_id" VARCHAR(64),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_refund_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_refund_events_type_nonempty" CHECK (btrim("event_type") <> '')
);

ALTER TABLE "billing_payment_provider_events"
  ADD COLUMN "refund_id" UUID;

ALTER TABLE "billing_ledger_journals"
  ADD COLUMN "refund_id" UUID;

ALTER TABLE "billing_refunds"
  ADD CONSTRAINT "billing_refunds_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_refunds"
  ADD CONSTRAINT "billing_refunds_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "billing_payment_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_refunds"
  ADD CONSTRAINT "billing_refunds_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_refunds"
  ADD CONSTRAINT "billing_refunds_entitlement_grant_id_fkey"
  FOREIGN KEY ("entitlement_grant_id") REFERENCES "entitlement_grants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_refund_events"
  ADD CONSTRAINT "billing_refund_events_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "billing_refunds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_payment_provider_events"
  ADD CONSTRAINT "billing_payment_provider_events_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "billing_refunds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_ledger_journals"
  ADD CONSTRAINT "billing_ledger_journals_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "billing_refunds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_refunds_no_unique"
  ON "billing_refunds" ("refund_no");

CREATE UNIQUE INDEX "billing_refunds_idempotency_unique"
  ON "billing_refunds" ("idempotency_key");

CREATE UNIQUE INDEX "billing_refunds_request_id_unique"
  ON "billing_refunds" ("request_id");

CREATE UNIQUE INDEX "billing_refunds_provider_refund_unique"
  ON "billing_refunds" ("provider", "provider_refund_id")
  WHERE "provider_refund_id" IS NOT NULL;

CREATE INDEX "billing_refunds_order_recent_idx"
  ON "billing_refunds" ("order_id", "created_at" DESC);

CREATE INDEX "billing_refunds_intent_recent_idx"
  ON "billing_refunds" ("payment_intent_id", "created_at" DESC);

CREATE INDEX "billing_refunds_wallet_transaction_idx"
  ON "billing_refunds" ("wallet_transaction_id");

CREATE INDEX "billing_refunds_entitlement_grant_idx"
  ON "billing_refunds" ("entitlement_grant_id");

CREATE INDEX "billing_refunds_provider_refund_idx"
  ON "billing_refunds" ("provider", "provider_refund_id");

CREATE INDEX "billing_refunds_status_recent_idx"
  ON "billing_refunds" ("status", "updated_at" DESC);

CREATE INDEX "billing_refund_events_refund_recent_idx"
  ON "billing_refund_events" ("refund_id", "created_at" DESC);

CREATE INDEX "billing_refund_events_type_recent_idx"
  ON "billing_refund_events" ("event_type", "created_at" DESC);

CREATE INDEX "billing_provider_events_refund_recent_idx"
  ON "billing_payment_provider_events" ("refund_id", "received_at" DESC);

CREATE INDEX "billing_ledger_journals_refund_recent_idx"
  ON "billing_ledger_journals" ("refund_id", "posted_at" DESC);
