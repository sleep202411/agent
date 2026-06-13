-- Production-grade membership plans and subscription-cycle fulfillment.
--
-- billing_membership_plans is the plan-policy source of truth. billing_prices
-- remains the sellable price/version plus provider binding. Every subscription
-- period gets an auditable billing_subscription_cycles row that links the
-- provider-paid order, entitlement grant, and included compute-credit grant.

CREATE TYPE "BillingMembershipPlanStatus" AS ENUM (
  'draft',
  'active',
  'paused',
  'archived'
);

CREATE TYPE "BillingSubscriptionCycleStatus" AS ENUM (
  'pending',
  'fulfilled',
  'voided'
);

CREATE TABLE "billing_membership_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_key" VARCHAR(64) NOT NULL,
  "product_type" "BillingProductType" NOT NULL,
  "subject_type" "BillingSubjectType" NOT NULL,
  "status" "BillingMembershipPlanStatus" NOT NULL DEFAULT 'draft',
  "rank" INTEGER NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "included_compute_credits" BIGINT NOT NULL DEFAULT 0,
  "included_seats" INTEGER NOT NULL DEFAULT 1,
  "max_seats" INTEGER,
  "seat_overage_allowed" BOOLEAN NOT NULL DEFAULT false,
  "topup_discount_bps" INTEGER NOT NULL DEFAULT 0,
  "billing_interval_default" "BillingPriceInterval",
  "feature_flags" JSONB NOT NULL DEFAULT '{}',
  "limits" JSONB NOT NULL DEFAULT '{}',
  "marketing" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64),
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_membership_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_membership_plans_key_format"
    CHECK ("plan_key" ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT "billing_membership_plans_name_nonempty"
    CHECK (btrim("name") <> ''),
  CONSTRAINT "billing_membership_plans_rank_nonnegative"
    CHECK ("rank" >= 0),
  CONSTRAINT "billing_membership_plans_credits_nonnegative"
    CHECK ("included_compute_credits" >= 0),
  CONSTRAINT "billing_membership_plans_seats_positive"
    CHECK ("included_seats" > 0 AND ("max_seats" IS NULL OR "max_seats" >= "included_seats")),
  CONSTRAINT "billing_membership_plans_topup_discount_range"
    CHECK ("topup_discount_bps" >= 0 AND "topup_discount_bps" <= 10000),
  CONSTRAINT "billing_membership_plans_product_subject_shape"
    CHECK (
      ("product_type" = 'membership_plan' AND "subject_type" = 'user')
      OR ("product_type" = 'team_membership_plan' AND "subject_type" = 'workspace')
    )
);

CREATE UNIQUE INDEX "billing_membership_plans_plan_key_unique"
  ON "billing_membership_plans" ("plan_key");
CREATE INDEX "billing_membership_plans_product_status_rank_idx"
  ON "billing_membership_plans" ("product_type", "status", "rank");
CREATE INDEX "billing_membership_plans_subject_status_rank_idx"
  ON "billing_membership_plans" ("subject_type", "status", "rank");

ALTER TABLE "billing_subscriptions"
  ADD COLUMN "provider_customer_id" VARCHAR(128),
  ADD COLUMN "latest_order_id" UUID,
  ADD COLUMN "started_at" TIMESTAMPTZ(6),
  ADD COLUMN "ended_at" TIMESTAMPTZ(6),
  ADD COLUMN "plan_policy_snapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

UPDATE "billing_subscriptions"
SET "started_at" = COALESCE("current_period_start", "created_at")
WHERE "started_at" IS NULL
  AND "status" IN ('active', 'past_due');

CREATE INDEX "billing_subscriptions_provider_customer_idx"
  ON "billing_subscriptions" ("provider", "provider_customer_id");
CREATE INDEX "billing_subscriptions_latest_order_idx"
  ON "billing_subscriptions" ("latest_order_id");

CREATE UNIQUE INDEX "billing_subscriptions_subject_live_unique"
  ON "billing_subscriptions" ("subject_type", "subject_id")
  WHERE "status" IN ('incomplete', 'active', 'past_due');

CREATE TABLE "billing_subscription_cycles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subscription_id" UUID NOT NULL,
  "order_id" UUID,
  "entitlement_grant_id" UUID,
  "wallet_transaction_id" UUID,
  "cycle_no" INTEGER NOT NULL,
  "status" "BillingSubscriptionCycleStatus" NOT NULL DEFAULT 'pending',
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6),
  "included_compute_credits" BIGINT NOT NULL DEFAULT 0,
  "credit_grant_expires_at" TIMESTAMPTZ(6),
  "idempotency_key" VARCHAR(180) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilled_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),

  CONSTRAINT "billing_subscription_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_subscription_cycles_cycle_positive"
    CHECK ("cycle_no" > 0),
  CONSTRAINT "billing_subscription_cycles_credits_nonnegative"
    CHECK ("included_compute_credits" >= 0),
  CONSTRAINT "billing_subscription_cycles_period_order"
    CHECK ("period_end" IS NULL OR "period_end" > "period_start"),
  CONSTRAINT "billing_subscription_cycles_grant_expiry_order"
    CHECK ("credit_grant_expires_at" IS NULL OR "credit_grant_expires_at" > "period_start")
);

ALTER TABLE "billing_subscription_cycles"
  ADD CONSTRAINT "billing_subscription_cycles_subscription_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "billing_subscription_cycles_order_fk"
    FOREIGN KEY ("order_id") REFERENCES "billing_orders"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "billing_subscription_cycles_entitlement_fk"
    FOREIGN KEY ("entitlement_grant_id") REFERENCES "entitlement_grants"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "billing_subscription_cycles_wallet_tx_fk"
    FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "billing_subscription_cycles_idempotency_unique"
  ON "billing_subscription_cycles" ("idempotency_key");
CREATE UNIQUE INDEX "billing_subscription_cycles_subscription_cycle_unique"
  ON "billing_subscription_cycles" ("subscription_id", "cycle_no");
CREATE INDEX "billing_subscription_cycles_subscription_status_idx"
  ON "billing_subscription_cycles" ("subscription_id", "status", "period_start");
CREATE INDEX "billing_subscription_cycles_order_idx"
  ON "billing_subscription_cycles" ("order_id");
CREATE INDEX "billing_subscription_cycles_entitlement_idx"
  ON "billing_subscription_cycles" ("entitlement_grant_id");
CREATE INDEX "billing_subscription_cycles_wallet_tx_idx"
  ON "billing_subscription_cycles" ("wallet_transaction_id");
