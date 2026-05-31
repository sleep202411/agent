-- Keep IP commerce user-owned for the current product boundary and narrow
-- campaigns to explicit price activity types.

ALTER TABLE "ip_campaigns"
  ALTER COLUMN "campaign_type" DROP DEFAULT;

UPDATE "ip_campaigns"
SET "campaign_type" = 'event'
WHERE "campaign_type" IN ('custom', 'referral');

CREATE TYPE "IpCampaignType_new" AS ENUM (
  'presale',
  'early_bird',
  'limited_time_discount',
  'launch',
  'event'
);

ALTER TABLE "ip_campaigns"
  ALTER COLUMN "campaign_type" TYPE "IpCampaignType_new"
  USING ("campaign_type"::text::"IpCampaignType_new");

DROP TYPE "IpCampaignType";

ALTER TYPE "IpCampaignType_new" RENAME TO "IpCampaignType";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ip_purchase_orders"
    WHERE "subject_type" <> 'user'
       OR "subject_id" <> "user_id"
  ) THEN
    RAISE EXCEPTION 'ip_purchase_orders contains non-user subject data; refusing to drop subject columns';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ip_content_entitlements"
    WHERE "subject_type" <> 'user'
  ) THEN
    RAISE EXCEPTION 'ip_content_entitlements contains non-user subject data; refusing to convert to user_id';
  END IF;
END $$;

DROP INDEX IF EXISTS "ip_purchase_orders_subject_recent_idx";

ALTER TABLE "ip_purchase_orders"
  DROP COLUMN "subject_type",
  DROP COLUMN "subject_id";

ALTER TABLE "ip_content_entitlements"
  ADD COLUMN "user_id" VARCHAR(64);

UPDATE "ip_content_entitlements"
SET "user_id" = "subject_id";

ALTER TABLE "ip_content_entitlements"
  ALTER COLUMN "user_id" SET NOT NULL;

DROP INDEX IF EXISTS "ip_entitlements_subject_status_idx";

ALTER TABLE "ip_content_entitlements"
  DROP COLUMN "subject_type",
  DROP COLUMN "subject_id";

CREATE INDEX "ip_entitlements_user_status_idx"
  ON "ip_content_entitlements" ("user_id", "status", "starts_at");

ALTER TABLE "ip_referral_links"
  DROP CONSTRAINT IF EXISTS "ip_referral_links_poster_asset_id_fkey";

ALTER TABLE "ip_referral_links"
  DROP CONSTRAINT IF EXISTS "ip_referral_links_qr_asset_id_fkey";

ALTER TABLE "ip_referral_links"
  DROP COLUMN IF EXISTS "poster_asset_id",
  DROP COLUMN IF EXISTS "qr_asset_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ip_content_reports"
    WHERE "target_type"::text NOT IN ('ip', 'episode')
  ) THEN
    RAISE EXCEPTION 'ip_content_reports contains non-content targets; refusing to narrow target_type';
  END IF;
END $$;

ALTER TABLE "ip_content_reports"
  ALTER COLUMN "target_type" TYPE "IpTargetType"
  USING ("target_type"::text::"IpTargetType");

ALTER TABLE "ip_review_submissions"
  DROP CONSTRAINT IF EXISTS "ip_review_submissions_target_consistency";

ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_target_consistency"
  CHECK (
    (
      "target_type" = 'ip'
      AND "episode_id" IS NULL
      AND "campaign_id" IS NULL
      AND "price_rule_id" IS NULL
      AND ("ip_id" IS NULL OR "target_id" = "ip_id"::text)
    )
    OR (
      "target_type" = 'episode'
      AND "campaign_id" IS NULL
      AND "price_rule_id" IS NULL
      AND ("episode_id" IS NULL OR "target_id" = "episode_id"::text)
    )
    OR (
      "target_type" = 'campaign'
      AND "ip_id" IS NULL
      AND "episode_id" IS NULL
      AND "price_rule_id" IS NULL
      AND ("campaign_id" IS NULL OR "target_id" = "campaign_id"::text)
    )
    OR (
      "target_type" = 'price_rule'
      AND "ip_id" IS NULL
      AND "episode_id" IS NULL
      AND "campaign_id" IS NULL
      AND ("price_rule_id" IS NULL OR "target_id" = "price_rule_id"::text)
    )
  );

ALTER TABLE "ip_content_reports"
  DROP CONSTRAINT IF EXISTS "ip_content_reports_target_consistency";

ALTER TABLE "ip_content_reports"
  ADD CONSTRAINT "ip_content_reports_target_consistency"
  CHECK (
    (
      "target_type" = 'ip'
      AND "episode_id" IS NULL
      AND ("ip_id" IS NULL OR "target_id" = "ip_id"::text)
    )
    OR (
      "target_type" = 'episode'
      AND ("episode_id" IS NULL OR "target_id" = "episode_id"::text)
    )
  );

ALTER TABLE "ip_user_content_blocks"
  DROP CONSTRAINT IF EXISTS "ip_user_content_blocks_target_consistency";

ALTER TABLE "ip_user_content_blocks"
  ADD CONSTRAINT "ip_user_content_blocks_target_consistency"
  CHECK (
    (
      "target_type" = 'ip'
      AND ("ip_id" IS NULL OR "target_id" = "ip_id"::text)
    )
    OR (
      "target_type" = 'creator'
      AND "ip_id" IS NULL
    )
  );
