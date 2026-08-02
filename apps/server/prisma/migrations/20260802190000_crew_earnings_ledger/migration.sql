-- Crew finance separates immutable point compensation from audited cash payouts.
-- This crew feature has not shipped with production data, so the incorrect
-- task-only settlement model is removed rather than migrated into fabricated
-- financial history.

BEGIN;

DROP TABLE IF EXISTS "crew_settlement_items";
DROP TYPE IF EXISTS "CrewSettlementStatus";

CREATE TYPE "CrewEarningStatus" AS ENUM (
  'pending',
  'posted',
  'rejected',
  'reversed'
);

CREATE TYPE "CrewEarningSourceType" AS ENUM (
  'task_reward',
  'contract_compensation',
  'milestone_bonus',
  'revenue_share',
  'discretionary_bonus',
  'adjustment'
);

CREATE TYPE "CrewPayoutStatus" AS ENUM (
  'pending',
  'paid',
  'voided'
);

CREATE TYPE "CrewPayoutMethod" AS ENUM (
  'bank_transfer',
  'alipay',
  'wechat_pay',
  'paypal',
  'other'
);

CREATE TABLE "crew_earning_entries" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "crew_member_id" TEXT NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "source_type" "CrewEarningSourceType" NOT NULL,
  "task_id" UUID,
  "agreement_id" UUID,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "points_amount" BIGINT NOT NULL,
  "status" "CrewEarningStatus" NOT NULL DEFAULT 'pending',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "approved_by_user_id" VARCHAR(64),
  "rejected_by_user_id" VARCHAR(64),
  "reversed_by_user_id" VARCHAR(64),
  "posted_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "reversed_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "reversal_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_earning_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_earning_entries_amount_check" CHECK (
    "points_amount" > 0
  ),
  CONSTRAINT "crew_earning_entries_status_shape_check" CHECK (
    (
      "status" = 'pending'
      AND "approved_by_user_id" IS NULL
      AND "posted_at" IS NULL
      AND "rejected_by_user_id" IS NULL
      AND "rejected_at" IS NULL
      AND "rejection_reason" IS NULL
      AND "reversed_by_user_id" IS NULL
      AND "reversed_at" IS NULL
      AND "reversal_reason" IS NULL
    ) OR (
      "status" = 'posted'
      AND "approved_by_user_id" IS NOT NULL
      AND "posted_at" IS NOT NULL
      AND "rejected_by_user_id" IS NULL
      AND "rejected_at" IS NULL
      AND "rejection_reason" IS NULL
      AND "reversed_by_user_id" IS NULL
      AND "reversed_at" IS NULL
      AND "reversal_reason" IS NULL
    ) OR (
      "status" = 'rejected'
      AND "approved_by_user_id" IS NULL
      AND "posted_at" IS NULL
      AND "rejected_by_user_id" IS NOT NULL
      AND "rejected_at" IS NOT NULL
      AND length(trim("rejection_reason")) > 0
      AND "reversed_by_user_id" IS NULL
      AND "reversed_at" IS NULL
      AND "reversal_reason" IS NULL
    ) OR (
      "status" = 'reversed'
      AND "approved_by_user_id" IS NOT NULL
      AND "posted_at" IS NOT NULL
      AND "rejected_by_user_id" IS NULL
      AND "rejected_at" IS NULL
      AND "rejection_reason" IS NULL
      AND "reversed_by_user_id" IS NOT NULL
      AND "reversed_at" IS NOT NULL
      AND length(trim("reversal_reason")) > 0
    )
  )
);

CREATE UNIQUE INDEX "crew_earning_entries_idempotency_unique"
  ON "crew_earning_entries"("idempotency_key");
CREATE UNIQUE INDEX "crew_earning_entries_task_user_source_unique"
  ON "crew_earning_entries"("task_id", "user_id", "source_type");
CREATE INDEX "crew_earning_entries_crew_status_created_idx"
  ON "crew_earning_entries"("crew_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_earning_entries_crew_source_created_idx"
  ON "crew_earning_entries"("crew_id", "source_type", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_earning_entries_user_status_created_idx"
  ON "crew_earning_entries"("user_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_earning_entries_member_created_idx"
  ON "crew_earning_entries"("crew_member_id", "created_at" DESC);
CREATE INDEX "crew_earning_entries_agreement_idx"
  ON "crew_earning_entries"("agreement_id");

ALTER TABLE "crew_earning_entries"
  ADD CONSTRAINT "crew_earning_entries_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_entries"
  ADD CONSTRAINT "crew_earning_entries_member_id_fkey"
  FOREIGN KEY ("crew_member_id") REFERENCES "crew_members"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_entries"
  ADD CONSTRAINT "crew_earning_entries_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "crew_tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_entries"
  ADD CONSTRAINT "crew_earning_entries_agreement_id_fkey"
  FOREIGN KEY ("agreement_id") REFERENCES "crew_agreements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_payouts" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "crew_member_id" TEXT NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "points_amount" BIGINT NOT NULL,
  "withholding_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "net_amount_minor" BIGINT NOT NULL,
  "status" "CrewPayoutStatus" NOT NULL DEFAULT 'pending',
  "payment_method" "CrewPayoutMethod",
  "payment_reference" VARCHAR(180),
  "payment_proof_url" VARCHAR(1024),
  "note" TEXT,
  "void_reason" TEXT,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by_user_id" VARCHAR(64) NOT NULL,
  "paid_by_user_id" VARCHAR(64),
  "voided_by_user_id" VARCHAR(64),
  "paid_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_payouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_payouts_amount_check" CHECK (
    "points_amount" > 0
    AND "withholding_amount_minor" >= 0
    AND "net_amount_minor" > 0
    AND "net_amount_minor" = "points_amount" - "withholding_amount_minor"
  ),
  CONSTRAINT "crew_payouts_status_shape_check" CHECK (
    (
      "status" = 'pending'
      AND "paid_by_user_id" IS NULL AND "paid_at" IS NULL
      AND "voided_by_user_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL
      AND "payment_method" IS NULL AND "payment_reference" IS NULL AND "payment_proof_url" IS NULL
    ) OR (
      "status" = 'paid'
      AND "paid_by_user_id" IS NOT NULL AND "paid_at" IS NOT NULL
      AND "payment_method" IS NOT NULL AND length(trim("payment_reference")) > 0
      AND "voided_by_user_id" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL
    ) OR (
      "status" = 'voided'
      AND "voided_by_user_id" IS NOT NULL AND "voided_at" IS NOT NULL AND length(trim("void_reason")) > 0
      AND "paid_by_user_id" IS NULL AND "paid_at" IS NULL
      AND "payment_method" IS NULL AND "payment_reference" IS NULL AND "payment_proof_url" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "crew_payouts_idempotency_unique" ON "crew_payouts"("idempotency_key");
CREATE INDEX "crew_payouts_crew_status_created_idx" ON "crew_payouts"("crew_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_payouts_user_status_created_idx" ON "crew_payouts"("user_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "crew_payouts_member_created_idx" ON "crew_payouts"("crew_member_id", "created_at" DESC);

ALTER TABLE "crew_payouts" ADD CONSTRAINT "crew_payouts_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payouts" ADD CONSTRAINT "crew_payouts_member_id_fkey"
  FOREIGN KEY ("crew_member_id") REFERENCES "crew_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_payout_allocations" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "payout_id" UUID NOT NULL,
  "earning_id" UUID NOT NULL,
  "points_amount" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_payout_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crew_payout_allocations_points_check" CHECK ("points_amount" > 0)
);
CREATE UNIQUE INDEX "crew_payout_allocations_payout_earning_unique" ON "crew_payout_allocations"("payout_id", "earning_id");
CREATE INDEX "crew_payout_allocations_earning_idx" ON "crew_payout_allocations"("earning_id");
ALTER TABLE "crew_payout_allocations" ADD CONSTRAINT "crew_payout_allocations_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_allocations" ADD CONSTRAINT "crew_payout_allocations_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "crew_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_allocations" ADD CONSTRAINT "crew_payout_allocations_earning_id_fkey"
  FOREIGN KEY ("earning_id") REFERENCES "crew_earning_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_payout_events" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "payout_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_payout_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crew_payout_events_payout_idx" ON "crew_payout_events"("payout_id", "created_at", "id");
CREATE INDEX "crew_payout_events_crew_idx" ON "crew_payout_events"("crew_id", "created_at" DESC, "id" DESC);
ALTER TABLE "crew_payout_events" ADD CONSTRAINT "crew_payout_events_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_payout_events" ADD CONSTRAINT "crew_payout_events_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "crew_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "crew_earning_events" (
  "id" UUID NOT NULL,
  "crew_id" TEXT NOT NULL,
  "earning_id" UUID NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crew_earning_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crew_earning_events_entry_idx"
  ON "crew_earning_events"("earning_id", "created_at", "id");
CREATE INDEX "crew_earning_events_crew_idx"
  ON "crew_earning_events"("crew_id", "created_at" DESC, "id" DESC);

ALTER TABLE "crew_earning_events"
  ADD CONSTRAINT "crew_earning_events_crew_id_fkey"
  FOREIGN KEY ("crew_id") REFERENCES "crews"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crew_earning_events"
  ADD CONSTRAINT "crew_earning_events_earning_id_fkey"
  FOREIGN KEY ("earning_id") REFERENCES "crew_earning_entries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
