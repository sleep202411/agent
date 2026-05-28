-- Billing / payments core.
--
-- The platform owns product catalog, order state, payment sessions,
-- provider webhooks, wallet fulfillment, and entitlement grants. Payment
-- providers are adapters. Airwallex is the first .com adapter; WeChat Pay
-- can later attach to the same order / webhook / ledger model.

CREATE TYPE "BillingSiteRegion" AS ENUM ('global', 'cn');

CREATE TYPE "BillingSubjectType" AS ENUM ('user', 'workspace');

CREATE TYPE "BillingProductType" AS ENUM (
  'bubble_pack',
  'community_point_pack',
  'membership_plan',
  'team_membership_plan',
  'custom'
);

CREATE TYPE "BillingPriceInterval" AS ENUM ('one_time', 'month', 'year');

CREATE TYPE "BillingOrderType" AS ENUM (
  'bubble_topup',
  'community_point_topup',
  'membership_purchase',
  'subscription_checkout',
  'manual_adjustment'
);

CREATE TYPE "BillingOrderStatus" AS ENUM (
  'draft',
  'pending_payment',
  'paid',
  'fulfilled',
  'canceled',
  'expired',
  'failed',
  'refunded',
  'partially_refunded'
);

CREATE TYPE "PaymentProvider" AS ENUM (
  'airwallex',
  'wechat_pay',
  'manual',
  'internal'
);

CREATE TYPE "PaymentIntentKind" AS ENUM (
  'hosted_checkout',
  'payment_intent',
  'external_redirect'
);

CREATE TYPE "PaymentIntentStatus" AS ENUM (
  'requires_action',
  'pending',
  'succeeded',
  'failed',
  'canceled',
  'expired'
);

CREATE TYPE "BillingSubscriptionStatus" AS ENUM (
  'incomplete',
  'active',
  'past_due',
  'canceled',
  'expired'
);

CREATE TYPE "PaymentProviderEventStatus" AS ENUM (
  'received',
  'processed',
  'ignored',
  'failed'
);

CREATE TYPE "EntitlementGrantStatus" AS ENUM (
  'pending',
  'active',
  'expired',
  'revoked'
);

CREATE TABLE "billing_catalog_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_region" "BillingSiteRegion" NOT NULL DEFAULT 'global',
  "product_type" "BillingProductType" NOT NULL,
  "code" VARCHAR(96) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_catalog_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_catalog_items_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "billing_catalog_items_name_nonempty" CHECK (btrim("name") <> '')
);

CREATE TABLE "billing_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "provider_price_id" VARCHAR(128),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "interval" "BillingPriceInterval" NOT NULL DEFAULT 'one_time',
  "subject_type" "BillingSubjectType" NOT NULL DEFAULT 'user',
  "grants_wallet_currency" "WalletCurrencyType",
  "grants_wallet_amount" BIGINT,
  "grants_plan_key" VARCHAR(64),
  "grant_duration_days" INTEGER,
  "provider_mode" VARCHAR(32),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_prices_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_prices_currency_upper" CHECK ("currency" = upper("currency")),
  CONSTRAINT "billing_prices_wallet_grant_pair"
    CHECK (
      ("grants_wallet_currency" IS NULL AND "grants_wallet_amount" IS NULL)
      OR ("grants_wallet_currency" IS NOT NULL AND "grants_wallet_amount" > 0)
    ),
  CONSTRAINT "billing_prices_duration_positive"
    CHECK ("grant_duration_days" IS NULL OR "grant_duration_days" > 0)
);

CREATE TABLE "billing_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_no" VARCHAR(64) NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID,
  "subject_type" "BillingSubjectType" NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "site_region" "BillingSiteRegion" NOT NULL DEFAULT 'global',
  "order_type" "BillingOrderType" NOT NULL,
  "status" "BillingOrderStatus" NOT NULL DEFAULT 'draft',
  "item_id" UUID NOT NULL,
  "price_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "description" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6),
  "paid_at" TIMESTAMPTZ(6),
  "fulfilled_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_orders_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_orders_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "billing_orders_currency_upper" CHECK ("currency" = upper("currency"))
);

CREATE TABLE "billing_payment_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "kind" "PaymentIntentKind" NOT NULL,
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'requires_action',
  "request_id" VARCHAR(64) NOT NULL,
  "provider_payment_intent_id" VARCHAR(128),
  "provider_checkout_id" VARCHAR(128),
  "provider_customer_id" VARCHAR(128),
  "provider_subscription_id" VARCHAR(128),
  "provider_invoice_id" VARCHAR(128),
  "checkout_url" VARCHAR(2048),
  "client_secret" VARCHAR(2048),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "provider_status" VARCHAR(64),
  "provider_payload" JSONB NOT NULL DEFAULT '{}',
  "expires_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_payment_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_payment_intents_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_payment_intents_currency_upper" CHECK ("currency" = upper("currency"))
);

CREATE TABLE "billing_payment_provider_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL,
  "provider_event_id" VARCHAR(160) NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "status" "PaymentProviderEventStatus" NOT NULL DEFAULT 'received',
  "order_id" UUID,
  "payment_intent_id" UUID,
  "payload" JSONB NOT NULL,
  "error" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_payment_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID,
  "subject_type" "BillingSubjectType" NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "provider_subscription_id" VARCHAR(128),
  "status" "BillingSubscriptionStatus" NOT NULL DEFAULT 'incomplete',
  "price_id" UUID NOT NULL,
  "plan_key" VARCHAR(64),
  "current_period_start" TIMESTAMPTZ(6),
  "current_period_end" TIMESTAMPTZ(6),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "canceled_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entitlement_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_type" "BillingSubjectType" NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "plan_key" VARCHAR(64) NOT NULL,
  "status" "EntitlementGrantStatus" NOT NULL DEFAULT 'pending',
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" VARCHAR(128) NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),

  CONSTRAINT "entitlement_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_grants_plan_key_nonempty" CHECK (btrim("plan_key") <> '')
);

ALTER TABLE "billing_prices"
  ADD CONSTRAINT "billing_prices_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "billing_catalog_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "billing_catalog_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_orders"
  ADD CONSTRAINT "billing_orders_price_id_fkey"
  FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_payment_intents"
  ADD CONSTRAINT "billing_payment_intents_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_payment_provider_events"
  ADD CONSTRAINT "billing_payment_provider_events_payment_intent_id_fkey"
  FOREIGN KEY ("payment_intent_id") REFERENCES "billing_payment_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_subscriptions"
  ADD CONSTRAINT "billing_subscriptions_price_id_fkey"
  FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "billing_catalog_items_region_code_unique"
  ON "billing_catalog_items" ("site_region", "code");

CREATE UNIQUE INDEX "billing_prices_active_provider_price_unique"
  ON "billing_prices" ("provider", "provider_price_id")
  WHERE "provider_price_id" IS NOT NULL AND "archived_at" IS NULL;

CREATE UNIQUE INDEX "billing_orders_order_no_unique"
  ON "billing_orders" ("order_no");

CREATE UNIQUE INDEX "billing_payment_intents_request_id_unique"
  ON "billing_payment_intents" ("request_id");

CREATE UNIQUE INDEX "billing_provider_events_provider_event_unique"
  ON "billing_payment_provider_events" ("provider", "provider_event_id");

CREATE UNIQUE INDEX "billing_subscriptions_provider_subscription_unique"
  ON "billing_subscriptions" ("provider", "provider_subscription_id")
  WHERE "provider_subscription_id" IS NOT NULL;

CREATE UNIQUE INDEX "entitlement_grants_source_unique"
  ON "entitlement_grants" ("source_type", "source_id");

CREATE INDEX "billing_catalog_items_region_type_idx"
  ON "billing_catalog_items" ("site_region", "product_type", "is_active");

CREATE INDEX "billing_prices_item_active_idx"
  ON "billing_prices" ("item_id", "is_active");

CREATE INDEX "billing_prices_provider_price_idx"
  ON "billing_prices" ("provider", "provider_price_id");

CREATE INDEX "billing_prices_currency_amount_idx"
  ON "billing_prices" ("currency", "amount_minor");

CREATE INDEX "billing_orders_user_recent_idx"
  ON "billing_orders" ("user_id", "created_at" DESC);

CREATE INDEX "billing_orders_workspace_recent_idx"
  ON "billing_orders" ("workspace_id", "created_at" DESC);

CREATE INDEX "billing_orders_status_recent_idx"
  ON "billing_orders" ("status", "updated_at" DESC);

CREATE INDEX "billing_orders_subject_recent_idx"
  ON "billing_orders" ("subject_type", "subject_id", "created_at" DESC);

CREATE INDEX "billing_payment_intents_order_idx"
  ON "billing_payment_intents" ("order_id", "created_at" DESC);

CREATE INDEX "billing_payment_intents_provider_checkout_idx"
  ON "billing_payment_intents" ("provider", "provider_checkout_id");

CREATE INDEX "billing_payment_intents_provider_pi_idx"
  ON "billing_payment_intents" ("provider", "provider_payment_intent_id");

CREATE INDEX "billing_payment_intents_status_idx"
  ON "billing_payment_intents" ("status", "updated_at" DESC);

CREATE INDEX "billing_provider_events_status_recent_idx"
  ON "billing_payment_provider_events" ("status", "received_at" DESC);

CREATE INDEX "billing_provider_events_order_recent_idx"
  ON "billing_payment_provider_events" ("order_id", "received_at" DESC);

CREATE INDEX "billing_provider_events_intent_recent_idx"
  ON "billing_payment_provider_events" ("payment_intent_id", "received_at" DESC);

CREATE INDEX "billing_subscriptions_subject_status_idx"
  ON "billing_subscriptions" ("subject_type", "subject_id", "status");

CREATE INDEX "billing_subscriptions_user_status_idx"
  ON "billing_subscriptions" ("user_id", "status", "updated_at" DESC);

CREATE INDEX "entitlement_grants_subject_status_idx"
  ON "entitlement_grants" ("subject_type", "subject_id", "status", "ends_at");
