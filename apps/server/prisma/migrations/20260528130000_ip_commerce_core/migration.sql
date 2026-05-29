-- IP commerce core.
--
-- This domain owns public IP titles, episodes, presale campaigns,
-- community-point content purchases, access entitlements, collections,
-- creator revenue, referral attribution, review, rights declarations,
-- reports, and moderation. It intentionally models public commercial
-- objects separately from PlatformProject, which remains the internal
-- production/workspace container.

CREATE TYPE "IpContentType" AS ENUM ('series', 'interactive_film', 'film', 'course', 'collection', 'other');
CREATE TYPE "IpPublicationStatus" AS ENUM ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'hidden', 'suspended', 'archived');
CREATE TYPE "IpListingVisibility" AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE "IpAgeRating" AS ENUM ('general', 'teen', 'mature', 'restricted');
CREATE TYPE "IpStoryNodeType" AS ENUM ('linear', 'branch', 'ending', 'bonus');
CREATE TYPE "IpCampaignType" AS ENUM ('presale', 'early_bird', 'launch', 'event', 'referral', 'custom');
CREATE TYPE "IpCampaignStatus" AS ENUM ('draft', 'scheduled', 'active', 'ended', 'canceled');
CREATE TYPE "IpTargetType" AS ENUM ('title', 'episode');
CREATE TYPE "IpPriceRuleStatus" AS ENUM ('draft', 'active', 'disabled', 'archived');
CREATE TYPE "IpPurchaseOrderStatus" AS ENUM ('pending', 'paid', 'fulfilled', 'canceled', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE "IpEntitlementStatus" AS ENUM ('active', 'expired', 'revoked', 'refunded');
CREATE TYPE "IpCollectionItemStatus" AS ENUM ('active', 'removed');
CREATE TYPE "IpContributorRole" AS ENUM ('owner', 'producer', 'director', 'writer', 'artist', 'editor', 'performer', 'investor', 'referrer', 'other');
CREATE TYPE "IpRevenueRuleType" AS ENUM ('production_fee', 'revenue_share', 'referral_commission', 'platform_fee', 'manual');
CREATE TYPE "IpRevenueRuleStatus" AS ENUM ('draft', 'active', 'disabled', 'archived');
CREATE TYPE "IpRevenueLedgerEntryType" AS ENUM ('production_fee', 'revenue_share', 'referral_commission', 'platform_fee', 'refund_reversal', 'manual_adjustment');
CREATE TYPE "IpRevenueLedgerStatus" AS ENUM ('pending', 'posted', 'voided');
CREATE TYPE "IpReferralLinkStatus" AS ENUM ('active', 'disabled', 'expired');
CREATE TYPE "IpReviewTargetType" AS ENUM ('title', 'episode', 'price_rule', 'revenue_rule', 'campaign');
CREATE TYPE "IpReviewStatus" AS ENUM ('submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'canceled');
CREATE TYPE "IpReviewEventType" AS ENUM ('submitted', 'assigned', 'comment', 'changes_requested', 'approved', 'rejected', 'canceled');
CREATE TYPE "IpRightsTargetType" AS ENUM ('title', 'episode');
CREATE TYPE "IpRightsOwnershipType" AS ENUM ('original', 'licensed', 'public_domain', 'ai_generated', 'mixed', 'unknown');
CREATE TYPE "IpRightsDeclarationStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');
CREATE TYPE "IpModerationTargetType" AS ENUM ('title', 'episode', 'review_submission', 'report');
CREATE TYPE "IpModerationActionType" AS ENUM ('hide', 'suspend_sales', 'takedown', 'region_block', 'age_gate', 'restore', 'reject', 'approve');
CREATE TYPE "IpReportReason" AS ENUM ('copyright', 'unsafe_content', 'fraud', 'misleading', 'privacy', 'harassment', 'other');
CREATE TYPE "IpReportStatus" AS ENUM ('submitted', 'triaged', 'actioned', 'dismissed');
CREATE TYPE "IpUserBlockTargetType" AS ENUM ('title', 'creator');

CREATE TABLE "ip_titles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "source_project_id" UUID,
  "slug" VARCHAR(120),
  "content_type" "IpContentType" NOT NULL DEFAULT 'series',
  "status" "IpPublicationStatus" NOT NULL DEFAULT 'draft',
  "listing_visibility" "IpListingVisibility" NOT NULL DEFAULT 'private',
  "age_rating" "IpAgeRating" NOT NULL DEFAULT 'general',
  "title" VARCHAR(160) NOT NULL,
  "subtitle" VARCHAR(160),
  "summary" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "language" VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "copyright_owner" VARCHAR(160),
  "rights_summary" JSONB NOT NULL DEFAULT '{}',
  "ai_disclosure" JSONB NOT NULL DEFAULT '{}',
  "cover_asset_id" UUID,
  "hero_asset_id" UUID,
  "trailer_asset_id" UUID,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_titles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_titles_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "ip_titles_summary_nonempty" CHECK (btrim("summary") <> ''),
  CONSTRAINT "ip_titles_slug_nonempty" CHECK ("slug" IS NULL OR btrim("slug") <> '')
);

CREATE TABLE "ip_episodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "source_project_id" UUID,
  "episode_no" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "IpPublicationStatus" NOT NULL DEFAULT 'draft',
  "title" VARCHAR(160) NOT NULL,
  "subtitle" VARCHAR(160),
  "summary" VARCHAR(500),
  "description" TEXT,
  "duration_seconds" INTEGER,
  "is_free_preview" BOOLEAN NOT NULL DEFAULT false,
  "cover_asset_id" UUID,
  "media_asset_id" UUID,
  "trailer_asset_id" UUID,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6),
  "suspended_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_episodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_episodes_number_positive" CHECK ("episode_no" > 0),
  CONSTRAINT "ip_episodes_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "ip_episodes_duration_positive" CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0)
);

CREATE TABLE "ip_story_nodes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "episode_id" UUID NOT NULL,
  "node_type" "IpStoryNodeType" NOT NULL DEFAULT 'linear',
  "code" VARCHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500),
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "media_asset_id" UUID,
  "is_free_preview" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_story_nodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_story_nodes_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "ip_story_nodes_title_nonempty" CHECK (btrim("title") <> '')
);

CREATE TABLE "ip_story_choices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "from_node_id" UUID NOT NULL,
  "to_node_id" UUID NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_story_choices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_story_choices_label_nonempty" CHECK (btrim("label") <> ''),
  CONSTRAINT "ip_story_choices_no_self_loop" CHECK ("from_node_id" <> "to_node_id")
);

CREATE TABLE "ip_campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "campaign_type" "IpCampaignType" NOT NULL DEFAULT 'custom',
  "status" "IpCampaignStatus" NOT NULL DEFAULT 'draft',
  "code" VARCHAR(96) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "unlocks_at" TIMESTAMPTZ(6),
  "tracking_config" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_campaigns_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "ip_campaigns_name_nonempty" CHECK (btrim("name") <> ''),
  CONSTRAINT "ip_campaigns_time_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE TABLE "ip_price_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "campaign_id" UUID,
  "target_type" "IpTargetType" NOT NULL,
  "status" "IpPriceRuleStatus" NOT NULL DEFAULT 'draft',
  "currency" "WalletCurrencyType" NOT NULL DEFAULT 'community_point',
  "amount" BIGINT NOT NULL,
  "original_amount" BIGINT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "unlocks_at" TIMESTAMPTZ(6),
  "max_per_user" INTEGER,
  "refund_policy_key" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_price_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_price_rules_amount_nonnegative" CHECK ("amount" >= 0),
  CONSTRAINT "ip_price_rules_original_nonnegative" CHECK ("original_amount" IS NULL OR "original_amount" >= 0),
  CONSTRAINT "ip_price_rules_max_per_user_positive" CHECK ("max_per_user" IS NULL OR "max_per_user" > 0),
  CONSTRAINT "ip_price_rules_time_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "ip_price_rules_target_consistency"
    CHECK (
      ("target_type" = 'title' AND "episode_id" IS NULL)
      OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
    )
);

CREATE TABLE "ip_referral_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "user_id" VARCHAR(64) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "status" "IpReferralLinkStatus" NOT NULL DEFAULT 'active',
  "commission_bps" INTEGER NOT NULL DEFAULT 1000,
  "landing_path" VARCHAR(512),
  "poster_asset_id" UUID,
  "qr_asset_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabled_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_referral_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_referral_links_code_nonempty" CHECK (btrim("code") <> ''),
  CONSTRAINT "ip_referral_links_commission_bps_range" CHECK ("commission_bps" >= 0 AND "commission_bps" <= 10000),
  CONSTRAINT "ip_referral_links_time_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE TABLE "ip_purchase_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_no" VARCHAR(64) NOT NULL,
  "user_id" VARCHAR(64) NOT NULL,
  "workspace_id" UUID,
  "subject_type" "BillingSubjectType" NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "target_type" "IpTargetType" NOT NULL,
  "status" "IpPurchaseOrderStatus" NOT NULL DEFAULT 'pending',
  "price_rule_id" UUID,
  "campaign_id" UUID,
  "referral_link_id" UUID,
  "wallet_transaction_id" UUID,
  "currency" "WalletCurrencyType" NOT NULL DEFAULT 'community_point',
  "price_amount" BIGINT NOT NULL,
  "discount_amount" BIGINT NOT NULL DEFAULT 0,
  "total_amount" BIGINT NOT NULL,
  "price_snapshot" JSONB NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "paid_at" TIMESTAMPTZ(6),
  "fulfilled_at" TIMESTAMPTZ(6),
  "refunded_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),
  "refund_reason" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_purchase_orders_order_no_nonempty" CHECK (btrim("order_no") <> ''),
  CONSTRAINT "ip_purchase_orders_amounts_valid" CHECK ("price_amount" >= 0 AND "discount_amount" >= 0 AND "total_amount" >= 0 AND "discount_amount" <= "price_amount"),
  CONSTRAINT "ip_purchase_orders_target_consistency"
    CHECK (
      ("target_type" = 'title' AND "episode_id" IS NULL)
      OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
    )
);

CREATE TABLE "ip_content_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_type" "BillingSubjectType" NOT NULL,
  "subject_id" VARCHAR(64) NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "target_type" "IpTargetType" NOT NULL,
  "status" "IpEntitlementStatus" NOT NULL DEFAULT 'active',
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" VARCHAR(128) NOT NULL,
  "source_order_id" UUID,
  "starts_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_content_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_entitlements_source_nonempty" CHECK (btrim("source_type") <> '' AND btrim("source_id") <> ''),
  CONSTRAINT "ip_entitlements_time_window" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "ip_entitlements_target_consistency"
    CHECK (
      ("target_type" = 'title' AND "episode_id" IS NULL)
      OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
    )
);

CREATE TABLE "ip_collection_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" VARCHAR(64) NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "entitlement_id" UUID,
  "target_type" "IpTargetType" NOT NULL,
  "status" "IpCollectionItemStatus" NOT NULL DEFAULT 'active',
  "progress" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_viewed_at" TIMESTAMPTZ(6),
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_collection_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_collection_items_target_consistency"
    CHECK (
      ("target_type" = 'title' AND "episode_id" IS NULL)
      OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
    )
);

CREATE TABLE "ip_contributors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "user_id" VARCHAR(64),
  "display_name" VARCHAR(120) NOT NULL,
  "role" "IpContributorRole" NOT NULL,
  "custom_role" VARCHAR(80),
  "is_public" BOOLEAN NOT NULL DEFAULT true,
  "revenue_eligible" BOOLEAN NOT NULL DEFAULT false,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_contributors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_contributors_display_name_nonempty" CHECK (btrim("display_name") <> '')
);

CREATE TABLE "ip_revenue_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "contributor_id" UUID,
  "beneficiary_user_id" VARCHAR(64),
  "rule_type" "IpRevenueRuleType" NOT NULL,
  "status" "IpRevenueRuleStatus" NOT NULL DEFAULT 'draft',
  "currency" "WalletCurrencyType" NOT NULL DEFAULT 'community_point',
  "balance_kind" "WalletBalanceKind" NOT NULL DEFAULT 'withdrawable',
  "share_bps" INTEGER,
  "fixed_amount" BIGINT,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "contract_snapshot" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_revenue_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_revenue_rules_share_bps_range" CHECK ("share_bps" IS NULL OR ("share_bps" >= 0 AND "share_bps" <= 10000)),
  CONSTRAINT "ip_revenue_rules_fixed_nonnegative" CHECK ("fixed_amount" IS NULL OR "fixed_amount" >= 0),
  CONSTRAINT "ip_revenue_rules_has_beneficiary" CHECK ("contributor_id" IS NOT NULL OR "beneficiary_user_id" IS NOT NULL),
  CONSTRAINT "ip_revenue_rules_withdrawable_community_point"
    CHECK ("currency" = 'community_point' AND "balance_kind" = 'withdrawable'),
  CONSTRAINT "ip_revenue_rules_time_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE TABLE "ip_revenue_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" VARCHAR(64) NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "order_id" UUID,
  "rule_id" UUID,
  "referral_link_id" UUID,
  "wallet_transaction_id" UUID,
  "entry_type" "IpRevenueLedgerEntryType" NOT NULL,
  "status" "IpRevenueLedgerStatus" NOT NULL DEFAULT 'pending',
  "currency" "WalletCurrencyType" NOT NULL DEFAULT 'community_point',
  "balance_kind" "WalletBalanceKind" NOT NULL DEFAULT 'withdrawable',
  "amount" BIGINT NOT NULL,
  "source_amount" BIGINT,
  "share_bps" INTEGER,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_revenue_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_revenue_entries_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "ip_revenue_entries_withdrawable_community_point"
    CHECK ("currency" = 'community_point' AND "balance_kind" = 'withdrawable'),
  CONSTRAINT "ip_revenue_entries_share_bps_range" CHECK ("share_bps" IS NULL OR ("share_bps" >= 0 AND "share_bps" <= 10000))
);

CREATE TABLE "ip_referral_attributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "referral_link_id" UUID NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "order_id" UUID,
  "buyer_user_id" VARCHAR(64),
  "anonymous_id" VARCHAR(128),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "attributed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_referral_attributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_referral_attr_has_actor" CHECK ("buyer_user_id" IS NOT NULL OR "anonymous_id" IS NOT NULL)
);

CREATE TABLE "ip_review_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_type" "IpReviewTargetType" NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "title_id" UUID,
  "episode_id" UUID,
  "campaign_id" UUID,
  "price_rule_id" UUID,
  "revenue_rule_id" UUID,
  "status" "IpReviewStatus" NOT NULL DEFAULT 'submitted',
  "snapshot" JSONB NOT NULL,
  "change_summary" TEXT,
  "submitted_by_id" VARCHAR(64) NOT NULL,
  "reviewer_id" VARCHAR(64),
  "decision_reason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "canceled_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_review_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_review_submissions_target_nonempty" CHECK (btrim("target_id") <> '')
);

CREATE TABLE "ip_review_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "event_type" "IpReviewEventType" NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_review_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ip_rights_declarations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_type" "IpRightsTargetType" NOT NULL,
  "title_id" UUID NOT NULL,
  "episode_id" UUID,
  "status" "IpRightsDeclarationStatus" NOT NULL DEFAULT 'draft',
  "ownership_type" "IpRightsOwnershipType" NOT NULL,
  "ai_generated" BOOLEAN NOT NULL DEFAULT false,
  "copyright_owner" VARCHAR(160),
  "source_summary" TEXT,
  "license_summary" TEXT,
  "risk_notes" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "declared_by_id" VARCHAR(64) NOT NULL,
  "reviewed_by_id" VARCHAR(64),
  "submitted_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_rights_declarations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_rights_declarations_target_consistency"
    CHECK (
      ("target_type" = 'title' AND "episode_id" IS NULL)
      OR ("target_type" = 'episode' AND "episode_id" IS NOT NULL)
    )
);

CREATE TABLE "ip_content_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_type" "IpModerationTargetType" NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "title_id" UUID,
  "episode_id" UUID,
  "reporter_user_id" VARCHAR(64),
  "reason" "IpReportReason" NOT NULL,
  "status" "IpReportStatus" NOT NULL DEFAULT 'submitted',
  "description" TEXT,
  "evidence_asset_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "resolved_by_id" VARCHAR(64),
  "resolution_note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_content_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_content_reports_target_nonempty" CHECK (btrim("target_id") <> '')
);

CREATE TABLE "ip_moderation_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_type" "IpModerationTargetType" NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "action_type" "IpModerationActionType" NOT NULL,
  "actor_user_id" VARCHAR(64) NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_moderation_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_moderation_actions_target_nonempty" CHECK (btrim("target_id") <> ''),
  CONSTRAINT "ip_moderation_actions_reason_nonempty" CHECK (btrim("reason") <> ''),
  CONSTRAINT "ip_moderation_actions_time_window" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at")
);

CREATE TABLE "ip_user_content_blocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" VARCHAR(64) NOT NULL,
  "target_type" "IpUserBlockTargetType" NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "title_id" UUID,
  "reason" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unblocked_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_user_content_blocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_user_content_blocks_target_nonempty" CHECK (btrim("target_id") <> '')
);

CREATE UNIQUE INDEX "ip_titles_id_workspace_unique"
  ON "ip_titles" ("id", "workspace_id");
CREATE UNIQUE INDEX "ip_titles_active_slug_unique"
  ON "ip_titles" ("slug")
  WHERE "slug" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "ip_titles_workspace_recent_idx"
  ON "ip_titles" ("workspace_id", "status", "updated_at" DESC);
CREATE INDEX "ip_titles_public_feed_idx"
  ON "ip_titles" ("status", "listing_visibility", "published_at" DESC);
CREATE INDEX "ip_titles_type_feed_idx"
  ON "ip_titles" ("content_type", "status", "published_at" DESC);

CREATE UNIQUE INDEX "ip_episodes_title_number_unique"
  ON "ip_episodes" ("title_id", "episode_no");
CREATE UNIQUE INDEX "ip_episodes_id_title_unique"
  ON "ip_episodes" ("id", "title_id");
CREATE INDEX "ip_episodes_title_status_order_idx"
  ON "ip_episodes" ("title_id", "status", "sort_order");

CREATE UNIQUE INDEX "ip_story_nodes_episode_code_unique"
  ON "ip_story_nodes" ("episode_id", "code");
CREATE INDEX "ip_story_nodes_episode_order_idx"
  ON "ip_story_nodes" ("episode_id", "display_order");
CREATE UNIQUE INDEX "ip_story_choices_edge_unique"
  ON "ip_story_choices" ("from_node_id", "to_node_id");
CREATE INDEX "ip_story_choices_from_order_idx"
  ON "ip_story_choices" ("from_node_id", "display_order");

CREATE UNIQUE INDEX "ip_campaigns_title_code_unique"
  ON "ip_campaigns" ("title_id", "code");
CREATE INDEX "ip_campaigns_title_status_idx"
  ON "ip_campaigns" ("title_id", "status", "starts_at");
CREATE INDEX "ip_campaigns_status_idx"
  ON "ip_campaigns" ("status", "starts_at");

CREATE INDEX "ip_price_rules_title_target_idx"
  ON "ip_price_rules" ("title_id", "target_type", "status", "priority");
CREATE INDEX "ip_price_rules_episode_idx"
  ON "ip_price_rules" ("episode_id", "status");
CREATE INDEX "ip_price_rules_campaign_idx"
  ON "ip_price_rules" ("campaign_id", "status");
CREATE INDEX "ip_price_rules_effective_idx"
  ON "ip_price_rules" ("status", "starts_at", "ends_at");

CREATE UNIQUE INDEX "ip_purchase_orders_order_no_unique"
  ON "ip_purchase_orders" ("order_no");
CREATE UNIQUE INDEX "ip_purchase_orders_user_idem_unique"
  ON "ip_purchase_orders" ("user_id", "idempotency_key");
CREATE INDEX "ip_purchase_orders_user_recent_idx"
  ON "ip_purchase_orders" ("user_id", "created_at" DESC);
CREATE INDEX "ip_purchase_orders_subject_recent_idx"
  ON "ip_purchase_orders" ("subject_type", "subject_id", "created_at" DESC);
CREATE INDEX "ip_purchase_orders_title_status_idx"
  ON "ip_purchase_orders" ("title_id", "status", "created_at" DESC);
CREATE INDEX "ip_purchase_orders_episode_status_idx"
  ON "ip_purchase_orders" ("episode_id", "status", "created_at" DESC);
CREATE INDEX "ip_purchase_orders_status_recent_idx"
  ON "ip_purchase_orders" ("status", "updated_at" DESC);

CREATE UNIQUE INDEX "ip_entitlements_source_unique"
  ON "ip_content_entitlements" ("source_type", "source_id");
CREATE UNIQUE INDEX "ip_entitlements_active_target_unique"
  ON "ip_content_entitlements" (
    "subject_type",
    "subject_id",
    "target_type",
    "title_id",
    COALESCE("episode_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" = 'active';
CREATE INDEX "ip_entitlements_subject_status_idx"
  ON "ip_content_entitlements" ("subject_type", "subject_id", "status", "starts_at");
CREATE INDEX "ip_entitlements_title_target_idx"
  ON "ip_content_entitlements" ("title_id", "target_type", "status");
CREATE INDEX "ip_entitlements_episode_idx"
  ON "ip_content_entitlements" ("episode_id", "status");

CREATE UNIQUE INDEX "ip_collection_items_active_unique"
  ON "ip_collection_items" (
    "user_id",
    "target_type",
    "title_id",
    COALESCE("episode_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "removed_at" IS NULL;
CREATE INDEX "ip_collection_items_user_recent_idx"
  ON "ip_collection_items" ("user_id", "status", "added_at" DESC);
CREATE INDEX "ip_collection_items_title_idx"
  ON "ip_collection_items" ("title_id", "status");

CREATE INDEX "ip_contributors_title_order_idx"
  ON "ip_contributors" ("title_id", "display_order");
CREATE INDEX "ip_contributors_user_idx"
  ON "ip_contributors" ("user_id", "removed_at");

CREATE INDEX "ip_revenue_rules_title_status_idx"
  ON "ip_revenue_rules" ("title_id", "status", "rule_type");
CREATE INDEX "ip_revenue_rules_beneficiary_idx"
  ON "ip_revenue_rules" ("beneficiary_user_id", "status");
CREATE INDEX "ip_revenue_entries_user_recent_idx"
  ON "ip_revenue_ledger_entries" ("user_id", "status", "created_at" DESC);
CREATE INDEX "ip_revenue_entries_title_recent_idx"
  ON "ip_revenue_ledger_entries" ("title_id", "status", "created_at" DESC);
CREATE INDEX "ip_revenue_entries_order_idx"
  ON "ip_revenue_ledger_entries" ("order_id");

CREATE UNIQUE INDEX "ip_referral_links_code_unique"
  ON "ip_referral_links" ("code");
CREATE INDEX "ip_referral_links_user_recent_idx"
  ON "ip_referral_links" ("user_id", "status", "created_at" DESC);
CREATE INDEX "ip_referral_links_title_status_idx"
  ON "ip_referral_links" ("title_id", "status");
CREATE UNIQUE INDEX "ip_referral_attributions_order_id_key"
  ON "ip_referral_attributions" ("order_id")
  WHERE "order_id" IS NOT NULL;
CREATE INDEX "ip_referral_attr_link_recent_idx"
  ON "ip_referral_attributions" ("referral_link_id", "attributed_at" DESC);
CREATE INDEX "ip_referral_attr_buyer_recent_idx"
  ON "ip_referral_attributions" ("buyer_user_id", "attributed_at" DESC);
CREATE INDEX "ip_referral_attr_order_idx"
  ON "ip_referral_attributions" ("order_id");

CREATE INDEX "ip_review_submissions_queue_idx"
  ON "ip_review_submissions" ("status", "submitted_at" ASC);
CREATE INDEX "ip_review_submissions_target_idx"
  ON "ip_review_submissions" ("target_type", "target_id", "submitted_at" DESC);
CREATE INDEX "ip_review_submissions_title_idx"
  ON "ip_review_submissions" ("title_id", "submitted_at" DESC);
CREATE INDEX "ip_review_events_submission_idx"
  ON "ip_review_events" ("submission_id", "created_at" ASC);

CREATE INDEX "ip_rights_declarations_title_idx"
  ON "ip_rights_declarations" ("title_id", "target_type", "status");
CREATE INDEX "ip_rights_declarations_queue_idx"
  ON "ip_rights_declarations" ("status", "submitted_at" ASC);
CREATE INDEX "ip_content_reports_queue_idx"
  ON "ip_content_reports" ("status", "created_at" ASC);
CREATE INDEX "ip_content_reports_target_idx"
  ON "ip_content_reports" ("target_type", "target_id", "created_at" DESC);
CREATE INDEX "ip_content_reports_reporter_idx"
  ON "ip_content_reports" ("reporter_user_id", "created_at" DESC);
CREATE INDEX "ip_moderation_actions_target_idx"
  ON "ip_moderation_actions" ("target_type", "target_id", "created_at" DESC);
CREATE INDEX "ip_moderation_actions_actor_idx"
  ON "ip_moderation_actions" ("actor_user_id", "created_at" DESC);
CREATE UNIQUE INDEX "ip_user_content_blocks_active_unique"
  ON "ip_user_content_blocks" ("user_id", "target_type", "target_id")
  WHERE "unblocked_at" IS NULL;
CREATE INDEX "ip_user_content_blocks_lookup_idx"
  ON "ip_user_content_blocks" ("user_id", "target_type", "target_id");

ALTER TABLE "ip_titles"
  ADD CONSTRAINT "ip_titles_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_titles"
  ADD CONSTRAINT "ip_titles_source_project_id_fkey"
  FOREIGN KEY ("source_project_id") REFERENCES "platform_projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_titles"
  ADD CONSTRAINT "ip_titles_cover_asset_id_fkey"
  FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_titles"
  ADD CONSTRAINT "ip_titles_hero_asset_id_fkey"
  FOREIGN KEY ("hero_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_titles"
  ADD CONSTRAINT "ip_titles_trailer_asset_id_fkey"
  FOREIGN KEY ("trailer_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_episodes"
  ADD CONSTRAINT "ip_episodes_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_episodes"
  ADD CONSTRAINT "ip_episodes_source_project_id_fkey"
  FOREIGN KEY ("source_project_id") REFERENCES "platform_projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_episodes"
  ADD CONSTRAINT "ip_episodes_cover_asset_id_fkey"
  FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_episodes"
  ADD CONSTRAINT "ip_episodes_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_episodes"
  ADD CONSTRAINT "ip_episodes_trailer_asset_id_fkey"
  FOREIGN KEY ("trailer_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_story_nodes"
  ADD CONSTRAINT "ip_story_nodes_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_story_nodes"
  ADD CONSTRAINT "ip_story_nodes_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_story_choices"
  ADD CONSTRAINT "ip_story_choices_from_node_id_fkey"
  FOREIGN KEY ("from_node_id") REFERENCES "ip_story_nodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_story_choices"
  ADD CONSTRAINT "ip_story_choices_to_node_id_fkey"
  FOREIGN KEY ("to_node_id") REFERENCES "ip_story_nodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_campaigns"
  ADD CONSTRAINT "ip_campaigns_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_price_rules"
  ADD CONSTRAINT "ip_price_rules_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_price_rules"
  ADD CONSTRAINT "ip_price_rules_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_price_rules"
  ADD CONSTRAINT "ip_price_rules_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "ip_campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_referral_links"
  ADD CONSTRAINT "ip_referral_links_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_referral_links"
  ADD CONSTRAINT "ip_referral_links_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_referral_links"
  ADD CONSTRAINT "ip_referral_links_poster_asset_id_fkey"
  FOREIGN KEY ("poster_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_referral_links"
  ADD CONSTRAINT "ip_referral_links_qr_asset_id_fkey"
  FOREIGN KEY ("qr_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_price_rule_id_fkey"
  FOREIGN KEY ("price_rule_id") REFERENCES "ip_price_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "ip_campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_referral_link_id_fkey"
  FOREIGN KEY ("referral_link_id") REFERENCES "ip_referral_links"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_purchase_orders"
  ADD CONSTRAINT "ip_purchase_orders_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_content_entitlements"
  ADD CONSTRAINT "ip_content_entitlements_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_content_entitlements"
  ADD CONSTRAINT "ip_content_entitlements_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_content_entitlements"
  ADD CONSTRAINT "ip_content_entitlements_source_order_id_fkey"
  FOREIGN KEY ("source_order_id") REFERENCES "ip_purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_collection_items"
  ADD CONSTRAINT "ip_collection_items_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_collection_items"
  ADD CONSTRAINT "ip_collection_items_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_collection_items"
  ADD CONSTRAINT "ip_collection_items_entitlement_id_fkey"
  FOREIGN KEY ("entitlement_id") REFERENCES "ip_content_entitlements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_contributors"
  ADD CONSTRAINT "ip_contributors_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_rules"
  ADD CONSTRAINT "ip_revenue_rules_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_rules"
  ADD CONSTRAINT "ip_revenue_rules_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_rules"
  ADD CONSTRAINT "ip_revenue_rules_contributor_id_fkey"
  FOREIGN KEY ("contributor_id") REFERENCES "ip_contributors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ip_purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "ip_revenue_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_referral_link_id_fkey"
  FOREIGN KEY ("referral_link_id") REFERENCES "ip_referral_links"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_revenue_ledger_entries"
  ADD CONSTRAINT "ip_revenue_ledger_entries_wallet_transaction_id_fkey"
  FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_referral_attributions"
  ADD CONSTRAINT "ip_referral_attributions_referral_link_id_fkey"
  FOREIGN KEY ("referral_link_id") REFERENCES "ip_referral_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_referral_attributions"
  ADD CONSTRAINT "ip_referral_attributions_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_referral_attributions"
  ADD CONSTRAINT "ip_referral_attributions_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_referral_attributions"
  ADD CONSTRAINT "ip_referral_attributions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "ip_purchase_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "ip_campaigns"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_price_rule_id_fkey"
  FOREIGN KEY ("price_rule_id") REFERENCES "ip_price_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_review_submissions"
  ADD CONSTRAINT "ip_review_submissions_revenue_rule_id_fkey"
  FOREIGN KEY ("revenue_rule_id") REFERENCES "ip_revenue_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_review_events"
  ADD CONSTRAINT "ip_review_events_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "ip_review_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_rights_declarations"
  ADD CONSTRAINT "ip_rights_declarations_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_rights_declarations"
  ADD CONSTRAINT "ip_rights_declarations_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ip_content_reports"
  ADD CONSTRAINT "ip_content_reports_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_content_reports"
  ADD CONSTRAINT "ip_content_reports_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_content_reports"
  ADD CONSTRAINT "ip_content_reports_evidence_asset_id_fkey"
  FOREIGN KEY ("evidence_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ip_user_content_blocks"
  ADD CONSTRAINT "ip_user_content_blocks_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
