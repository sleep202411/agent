-- Promote IP from "content title" to the root creative nucleus.
--
-- This keeps old Java/project concepts out of the new IP contract:
--   * ip_titles -> ips
--   * title_id -> ip_id for every new IP-domain child table
--   * content_type -> ip_type, with course/collection removed
--   * target enum value title -> ip
-- New extension tables model world bible, user experiences, and investor/
-- fundraising lifecycle without coupling the IP root to future studio,
-- crew, project, or gig tables.

ALTER TABLE "ip_price_rules"
  DROP CONSTRAINT IF EXISTS "ip_price_rules_target_consistency";
ALTER TABLE "ip_purchase_orders"
  DROP CONSTRAINT IF EXISTS "ip_purchase_orders_target_consistency";
ALTER TABLE "ip_content_entitlements"
  DROP CONSTRAINT IF EXISTS "ip_entitlements_target_consistency";
ALTER TABLE "ip_collection_items"
  DROP CONSTRAINT IF EXISTS "ip_collection_items_target_consistency";
ALTER TABLE "ip_rights_declarations"
  DROP CONSTRAINT IF EXISTS "ip_rights_declarations_target_consistency";

ALTER TYPE "IpTargetType" RENAME TO "IpTargetType_old";
CREATE TYPE "IpTargetType" AS ENUM ('ip', 'episode');
ALTER TABLE "ip_price_rules"
  ALTER COLUMN "target_type" TYPE "IpTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpTargetType";
ALTER TABLE "ip_purchase_orders"
  ALTER COLUMN "target_type" TYPE "IpTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpTargetType";
ALTER TABLE "ip_content_entitlements"
  ALTER COLUMN "target_type" TYPE "IpTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpTargetType";
ALTER TABLE "ip_collection_items"
  ALTER COLUMN "target_type" TYPE "IpTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpTargetType";
DROP TYPE "IpTargetType_old";

ALTER TYPE "IpTranslationTargetType" RENAME TO "IpTranslationTargetType_old";
CREATE TYPE "IpTranslationTargetType" AS ENUM (
  'ip',
  'episode',
  'story_node',
  'story_choice',
  'campaign',
  'media_text_track'
);
ALTER TABLE "ip_translation_jobs"
  ALTER COLUMN "target_type" TYPE "IpTranslationTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpTranslationTargetType";
DROP TYPE "IpTranslationTargetType_old";

ALTER TYPE "IpReviewTargetType" RENAME TO "IpReviewTargetType_old";
CREATE TYPE "IpReviewTargetType" AS ENUM ('ip', 'episode', 'price_rule', 'revenue_rule', 'campaign');
ALTER TABLE "ip_review_submissions"
  ALTER COLUMN "target_type" TYPE "IpReviewTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpReviewTargetType";
DROP TYPE "IpReviewTargetType_old";

ALTER TYPE "IpRightsTargetType" RENAME TO "IpRightsTargetType_old";
CREATE TYPE "IpRightsTargetType" AS ENUM ('ip', 'episode');
ALTER TABLE "ip_rights_declarations"
  ALTER COLUMN "target_type" TYPE "IpRightsTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpRightsTargetType";
DROP TYPE "IpRightsTargetType_old";

ALTER TYPE "IpModerationTargetType" RENAME TO "IpModerationTargetType_old";
CREATE TYPE "IpModerationTargetType" AS ENUM ('ip', 'episode', 'review_submission', 'report');
ALTER TABLE "ip_content_reports"
  ALTER COLUMN "target_type" TYPE "IpModerationTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpModerationTargetType";
ALTER TABLE "ip_moderation_actions"
  ALTER COLUMN "target_type" TYPE "IpModerationTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpModerationTargetType";
DROP TYPE "IpModerationTargetType_old";

ALTER TYPE "IpUserBlockTargetType" RENAME TO "IpUserBlockTargetType_old";
CREATE TYPE "IpUserBlockTargetType" AS ENUM ('ip', 'creator');
ALTER TABLE "ip_user_content_blocks"
  ALTER COLUMN "target_type" TYPE "IpUserBlockTargetType"
  USING (CASE "target_type"::TEXT WHEN 'title' THEN 'ip' ELSE "target_type"::TEXT END)::"IpUserBlockTargetType";
DROP TYPE "IpUserBlockTargetType_old";

CREATE TYPE "IpType" AS ENUM (
  'story_world',
  'character_ip',
  'series',
  'interactive_story',
  'film_short',
  'gamified_experience',
  'other'
);

ALTER TABLE "ip_titles"
  ADD COLUMN "ip_type" "IpType" NOT NULL DEFAULT 'story_world';

UPDATE "ip_titles"
SET "ip_type" =
  CASE "content_type"::TEXT
    WHEN 'series' THEN 'series'::"IpType"
    WHEN 'interactive_film' THEN 'interactive_story'::"IpType"
    WHEN 'film' THEN 'film_short'::"IpType"
    WHEN 'other' THEN 'other'::"IpType"
    ELSE 'story_world'::"IpType"
  END;

DROP INDEX IF EXISTS "ip_titles_type_feed_idx";
ALTER TABLE "ip_titles" DROP COLUMN "content_type";
DROP TYPE "IpContentType";

ALTER TABLE "ip_episodes" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_campaigns" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_price_rules" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_purchase_orders" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_content_entitlements" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_collection_items" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_contributors" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_revenue_rules" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_revenue_ledger_entries" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_referral_links" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_referral_attributions" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_review_submissions" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_rights_declarations" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_content_reports" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_user_content_blocks" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_media_text_tracks" RENAME COLUMN "title_id" TO "ip_id";
ALTER TABLE "ip_title_localizations" RENAME COLUMN "title_id" TO "ip_id";

ALTER TABLE "ip_titles" RENAME TO "ips";
ALTER TABLE "ip_title_localizations" RENAME TO "ip_localizations";

ALTER INDEX IF EXISTS "ip_titles_id_workspace_unique" RENAME TO "ips_id_workspace_unique";
ALTER INDEX IF EXISTS "ip_titles_workspace_recent_idx" RENAME TO "ips_workspace_recent_idx";
ALTER INDEX IF EXISTS "ip_titles_public_feed_idx" RENAME TO "ips_public_feed_idx";
ALTER INDEX IF EXISTS "ip_episodes_title_number_unique" RENAME TO "ip_episodes_ip_number_unique";
ALTER INDEX IF EXISTS "ip_episodes_id_title_unique" RENAME TO "ip_episodes_id_ip_unique";
ALTER INDEX IF EXISTS "ip_episodes_title_status_order_idx" RENAME TO "ip_episodes_ip_status_order_idx";
ALTER INDEX IF EXISTS "ip_campaigns_title_code_unique" RENAME TO "ip_campaigns_ip_code_unique";
ALTER INDEX IF EXISTS "ip_campaigns_title_status_idx" RENAME TO "ip_campaigns_ip_status_idx";
ALTER INDEX IF EXISTS "ip_title_localizations_title_locale_unique" RENAME TO "ip_localizations_ip_locale_unique";
ALTER INDEX IF EXISTS "ip_title_localizations_public_slug_unique" RENAME TO "ip_localizations_public_slug_unique";
ALTER INDEX IF EXISTS "ip_title_localizations_public_locale_idx" RENAME TO "ip_localizations_public_locale_idx";
ALTER INDEX IF EXISTS "ip_title_localizations_status_recent_idx" RENAME TO "ip_localizations_status_recent_idx";
ALTER INDEX IF EXISTS "ip_media_text_tracks_title_locale_idx" RENAME TO "ip_media_text_tracks_ip_locale_idx";
ALTER INDEX IF EXISTS "ip_price_rules_title_target_idx" RENAME TO "ip_price_rules_ip_target_idx";
ALTER INDEX IF EXISTS "ip_purchase_orders_title_status_idx" RENAME TO "ip_purchase_orders_ip_status_idx";
ALTER INDEX IF EXISTS "ip_entitlements_title_target_idx" RENAME TO "ip_entitlements_ip_target_idx";
ALTER INDEX IF EXISTS "ip_collection_items_title_idx" RENAME TO "ip_collection_items_ip_idx";
ALTER INDEX IF EXISTS "ip_contributors_title_order_idx" RENAME TO "ip_contributors_ip_order_idx";
ALTER INDEX IF EXISTS "ip_revenue_rules_title_status_idx" RENAME TO "ip_revenue_rules_ip_status_idx";
ALTER INDEX IF EXISTS "ip_revenue_entries_title_recent_idx" RENAME TO "ip_revenue_entries_ip_recent_idx";
ALTER INDEX IF EXISTS "ip_referral_links_title_status_idx" RENAME TO "ip_referral_links_ip_status_idx";
ALTER INDEX IF EXISTS "ip_review_submissions_title_idx" RENAME TO "ip_review_submissions_ip_idx";
ALTER INDEX IF EXISTS "ip_rights_declarations_title_idx" RENAME TO "ip_rights_declarations_ip_idx";

ALTER TABLE "ips" RENAME CONSTRAINT "ip_titles_pkey" TO "ips_pkey";
ALTER TABLE "ips" RENAME CONSTRAINT "ip_titles_workspace_id_fkey" TO "ips_workspace_id_fkey";
ALTER TABLE "ips" RENAME CONSTRAINT "ip_titles_cover_asset_id_fkey" TO "ips_cover_asset_id_fkey";
ALTER TABLE "ips" RENAME CONSTRAINT "ip_titles_hero_asset_id_fkey" TO "ips_hero_asset_id_fkey";
ALTER TABLE "ips" RENAME CONSTRAINT "ip_titles_trailer_asset_id_fkey" TO "ips_trailer_asset_id_fkey";
ALTER TABLE "ip_localizations" RENAME CONSTRAINT "ip_title_localizations_pkey" TO "ip_localizations_pkey";
ALTER TABLE "ip_localizations" RENAME CONSTRAINT "ip_title_localizations_title_id_fkey" TO "ip_localizations_ip_id_fkey";
ALTER TABLE "ip_localizations" RENAME CONSTRAINT "ip_title_localizations_title_nonempty" TO "ip_localizations_title_nonempty";
ALTER TABLE "ip_localizations" RENAME CONSTRAINT "ip_title_localizations_summary_nonempty" TO "ip_localizations_summary_nonempty";
ALTER TABLE "ip_localizations" RENAME CONSTRAINT "ip_title_localizations_slug_nonempty" TO "ip_localizations_slug_nonempty";
ALTER TABLE "ip_episodes" RENAME CONSTRAINT "ip_episodes_title_id_fkey" TO "ip_episodes_ip_id_fkey";
ALTER TABLE "ip_campaigns" RENAME CONSTRAINT "ip_campaigns_title_id_fkey" TO "ip_campaigns_ip_id_fkey";
ALTER TABLE "ip_price_rules" RENAME CONSTRAINT "ip_price_rules_title_id_fkey" TO "ip_price_rules_ip_id_fkey";
ALTER TABLE "ip_referral_links" RENAME CONSTRAINT "ip_referral_links_title_id_fkey" TO "ip_referral_links_ip_id_fkey";
ALTER TABLE "ip_purchase_orders" RENAME CONSTRAINT "ip_purchase_orders_title_id_fkey" TO "ip_purchase_orders_ip_id_fkey";
ALTER TABLE "ip_content_entitlements" RENAME CONSTRAINT "ip_content_entitlements_title_id_fkey" TO "ip_content_entitlements_ip_id_fkey";
ALTER TABLE "ip_collection_items" RENAME CONSTRAINT "ip_collection_items_title_id_fkey" TO "ip_collection_items_ip_id_fkey";
ALTER TABLE "ip_contributors" RENAME CONSTRAINT "ip_contributors_title_id_fkey" TO "ip_contributors_ip_id_fkey";
ALTER TABLE "ip_revenue_rules" RENAME CONSTRAINT "ip_revenue_rules_title_id_fkey" TO "ip_revenue_rules_ip_id_fkey";
ALTER TABLE "ip_revenue_ledger_entries" RENAME CONSTRAINT "ip_revenue_ledger_entries_title_id_fkey" TO "ip_revenue_ledger_entries_ip_id_fkey";
ALTER TABLE "ip_referral_attributions" RENAME CONSTRAINT "ip_referral_attributions_title_id_fkey" TO "ip_referral_attributions_ip_id_fkey";
ALTER TABLE "ip_review_submissions" RENAME CONSTRAINT "ip_review_submissions_title_id_fkey" TO "ip_review_submissions_ip_id_fkey";
ALTER TABLE "ip_rights_declarations" RENAME CONSTRAINT "ip_rights_declarations_title_id_fkey" TO "ip_rights_declarations_ip_id_fkey";
ALTER TABLE "ip_content_reports" RENAME CONSTRAINT "ip_content_reports_title_id_fkey" TO "ip_content_reports_ip_id_fkey";
ALTER TABLE "ip_user_content_blocks" RENAME CONSTRAINT "ip_user_content_blocks_title_id_fkey" TO "ip_user_content_blocks_ip_id_fkey";
ALTER TABLE "ip_media_text_tracks" RENAME CONSTRAINT "ip_media_text_tracks_title_id_fkey" TO "ip_media_text_tracks_ip_id_fkey";

ALTER TABLE "ip_price_rules"
  ADD CONSTRAINT "ip_price_rules_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND "episode_id" IS NULL)
    OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
  );
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND "episode_id" IS NULL)
    OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
  );
ALTER TABLE "ip_content_entitlements"
  ADD CONSTRAINT "ip_entitlements_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND "episode_id" IS NULL)
    OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
  );
ALTER TABLE "ip_collection_items"
  ADD CONSTRAINT "ip_collection_items_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND "episode_id" IS NULL)
    OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
  );
ALTER TABLE "ip_rights_declarations"
  ADD CONSTRAINT "ip_rights_declarations_target_consistency"
  CHECK (
    ("target_type" = 'ip' AND "episode_id" IS NULL)
    OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
  );

CREATE INDEX "ips_ip_type_feed_idx"
  ON "ips" ("ip_type", "status", "published_at" DESC);

CREATE TYPE "IpExperienceKind" AS ENUM (
  'story_overview',
  'video_series',
  'interactive_story',
  'roleplay_chat',
  'game_scene',
  'community_hub',
  'investor_pitch'
);

CREATE TYPE "IpExperienceStatus" AS ENUM (
  'draft',
  'active',
  'hidden',
  'archived'
);

CREATE TYPE "IpWorldEntityKind" AS ENUM (
  'character',
  'location',
  'faction',
  'rule',
  'item',
  'event',
  'lore',
  'other'
);

CREATE TYPE "IpFundraisingStatus" AS ENUM (
  'draft',
  'collecting_interest',
  'active',
  'paused',
  'completed',
  'canceled',
  'archived'
);

CREATE TABLE "ip_experiences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "kind" "IpExperienceKind" NOT NULL,
  "status" "IpExperienceStatus" NOT NULL DEFAULT 'draft',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_experiences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ip_world_entities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "kind" "IpWorldEntityKind" NOT NULL,
  "code" VARCHAR(80),
  "name" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500),
  "description" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_world_entities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_world_entities_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "ip_world_entities_code_nonempty" CHECK ("code" IS NULL OR btrim("code") <> '')
);

CREATE TABLE "ip_fundraising_campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "status" "IpFundraisingStatus" NOT NULL DEFAULT 'draft',
  "currency" VARCHAR(8),
  "goal_amount_minor" BIGINT,
  "min_commitment_minor" BIGINT,
  "pitch_summary" VARCHAR(500),
  "risk_disclosure" JSONB NOT NULL DEFAULT '{}',
  "milestones" JSONB NOT NULL DEFAULT '[]',
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_fundraising_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_fundraising_goal_positive" CHECK ("goal_amount_minor" IS NULL OR "goal_amount_minor" > 0),
  CONSTRAINT "ip_fundraising_min_commitment_positive" CHECK ("min_commitment_minor" IS NULL OR "min_commitment_minor" > 0),
  CONSTRAINT "ip_fundraising_window_valid" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at")
);

ALTER TABLE "ip_experiences"
  ADD CONSTRAINT "ip_experiences_ip_id_fkey"
  FOREIGN KEY ("ip_id") REFERENCES "ips"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_world_entities"
  ADD CONSTRAINT "ip_world_entities_ip_id_fkey"
  FOREIGN KEY ("ip_id") REFERENCES "ips"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_fundraising_campaigns"
  ADD CONSTRAINT "ip_fundraising_campaigns_ip_id_fkey"
  FOREIGN KEY ("ip_id") REFERENCES "ips"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ip_experiences_ip_status_order_idx"
  ON "ip_experiences" ("ip_id", "status", "sort_order");
CREATE INDEX "ip_experiences_kind_status_idx"
  ON "ip_experiences" ("kind", "status");

CREATE UNIQUE INDEX "ip_world_entities_ip_code_unique"
  ON "ip_world_entities" ("ip_id", "code");
CREATE INDEX "ip_world_entities_ip_kind_idx"
  ON "ip_world_entities" ("ip_id", "kind", "deleted_at");

CREATE INDEX "ip_fundraising_ip_status_idx"
  ON "ip_fundraising_campaigns" ("ip_id", "status", "starts_at");
CREATE INDEX "ip_fundraising_status_idx"
  ON "ip_fundraising_campaigns" ("status", "starts_at");
