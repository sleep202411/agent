-- Claimable free-credits campaigns (date-windowed giveaway).
CREATE TYPE "CreditCampaignStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

CREATE TABLE "credit_campaigns" (
  "id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "compute_credit_amount" INTEGER NOT NULL,
  "status" "CreditCampaignStatus" NOT NULL DEFAULT 'draft',
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "max_claims" INTEGER,
  "claim_count" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_by_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_campaigns_amount_check" CHECK ("compute_credit_amount" > 0)
);

CREATE INDEX "credit_campaigns_effective_idx" ON "credit_campaigns"("status", "starts_at", "ends_at");

CREATE TABLE "credit_campaign_claims" (
  "id" UUID NOT NULL,
  "campaign_id" UUID NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_campaign_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_campaign_claims_campaign_id_fkey" FOREIGN KEY ("campaign_id")
    REFERENCES "credit_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One claim per user per campaign (atomic idempotency for the claim).
CREATE UNIQUE INDEX "credit_campaign_claims_user_unique" ON "credit_campaign_claims"("campaign_id", "user_id");
CREATE INDEX "credit_campaign_claims_user_idx" ON "credit_campaign_claims"("user_id");
