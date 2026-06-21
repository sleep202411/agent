-- Community membership (社区会员): member-free IP viewing + member IP discount +
-- monthly subscription-revenue creator pool. Design: docs/community-membership.md.
-- Hand-written (no `migrate dev`). DDL core matches `prisma migrate diff`; the
-- partial-unique + settings seeds are appended (Prisma can't express WHERE/seed).

-- CreateEnum
CREATE TYPE "IpAccessMode" AS ENUM ('points_priced', 'member_free');

-- CreateEnum
CREATE TYPE "IpRevenueSourceType" AS ENUM ('ip_sale', 'member_pool', 'licensing');

-- CreateEnum
CREATE TYPE "MemberPoolBatchStatus" AS ENUM ('computing', 'posted', 'voided');

-- AlterEnum
-- Added but NOT used in this migration (Phase 0 seeds the plan in a later tx),
-- so it is transaction-safe on PostgreSQL 12+.
ALTER TYPE "BillingProductType" ADD VALUE 'community_membership_plan';

-- AlterTable
ALTER TABLE "ips" ADD COLUMN     "access_mode" "IpAccessMode" NOT NULL DEFAULT 'points_priced',
ADD COLUMN     "member_free_bps" INTEGER;

-- AlterTable
ALTER TABLE "ip_price_rules" ADD COLUMN     "member_discount_bps" INTEGER;

-- AlterTable
ALTER TABLE "ip_revenue_ledger_entries" ADD COLUMN     "settlement_batch_id" UUID,
ADD COLUMN     "source_type" "IpRevenueSourceType" NOT NULL DEFAULT 'ip_sale',
ALTER COLUMN "order_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "member_view_events" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "ip_id" UUID NOT NULL,
    "episode_id" UUID NOT NULL,
    "owner_user_id" VARCHAR(64) NOT NULL,
    "entitlement_id" UUID,
    "settlement_period" VARCHAR(7) NOT NULL,
    "settled_batch_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "viewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_view_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_pool_settlement_batches" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "pool_amount" BIGINT NOT NULL,
    "total_weight" BIGINT NOT NULL DEFAULT 0,
    "beneficiary_count" INTEGER NOT NULL DEFAULT 0,
    "status" "MemberPoolBatchStatus" NOT NULL DEFAULT 'computing',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMPTZ(6),

    CONSTRAINT "member_pool_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_view_events_period_settled_idx" ON "member_view_events"("settlement_period", "settled_batch_id");

-- CreateIndex
CREATE INDEX "member_view_events_owner_period_idx" ON "member_view_events"("owner_user_id", "settlement_period");

-- CreateIndex
CREATE UNIQUE INDEX "member_view_events_user_episode_period_unique" ON "member_view_events"("user_id", "episode_id", "settlement_period");

-- CreateIndex
CREATE INDEX "member_pool_settlement_batches_status_idx" ON "member_pool_settlement_batches"("status", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "member_pool_settlement_batches_period_unique" ON "member_pool_settlement_batches"("period");

-- CreateIndex
CREATE INDEX "ip_revenue_ledger_source_idx" ON "ip_revenue_ledger_entries"("source_type", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ip_revenue_ledger_settlement_batch_idx" ON "ip_revenue_ledger_entries"("settlement_batch_id");

-- Partial-unique for pool/licensing credits (no order_id, so the sales unique
-- (order_id,user_id,entry_type) cannot dedupe them). One credit per beneficiary
-- per settlement batch. Lives in raw SQL only — migrations are hand-written.
CREATE UNIQUE INDEX "ip_revenue_ledger_batch_user_unique"
  ON "ip_revenue_ledger_entries" ("settlement_batch_id", "user_id")
  WHERE "settlement_batch_id" IS NOT NULL;

-- Seed admin-editable defaults (idempotent on key). gen_random_uuid() is core
-- since PostgreSQL 13 (no pgcrypto). bps = basis points (10000 = 100%).
INSERT INTO "ip_commerce_settings" ("id", "key", "value_int", "metadata", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'ip.member_discount_bps', 2000, '{"note":"default member discount on points-priced IPs (bps)"}', now(), now()),
  (gen_random_uuid(), 'ip.member_free_bps', 10000, '{"note":"default creator pool weight for member-free IPs (bps)"}', now(), now()),
  (gen_random_uuid(), 'ip.member_pool_platform_share_bps', 0, '{"note":"platform retention on the monthly member pool (bps)"}', now(), now())
ON CONFLICT ("key") DO NOTHING;
