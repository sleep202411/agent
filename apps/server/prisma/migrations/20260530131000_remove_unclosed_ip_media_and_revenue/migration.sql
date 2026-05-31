-- Remove IP capabilities that do not have a complete product/UI/ops loop yet:
-- media text tracks, creator revenue rules, and IP revenue ledger entries.

DELETE FROM "ip_translation_jobs"
WHERE "target_type"::text = 'media_text_track';

DELETE FROM "ip_review_events"
WHERE "submission_id" IN (
  SELECT "id"
  FROM "ip_review_submissions"
  WHERE "target_type"::text = 'revenue_rule'
);

DELETE FROM "ip_review_submissions"
WHERE "target_type"::text = 'revenue_rule';

UPDATE "ip_contributors"
SET "role" = 'other'
WHERE "role"::text IN ('investor', 'referrer');

ALTER TABLE "ip_review_submissions"
  DROP CONSTRAINT IF EXISTS "ip_review_submissions_revenue_rule_id_fkey";

ALTER TABLE "ip_review_submissions"
  DROP COLUMN IF EXISTS "revenue_rule_id";

ALTER TABLE "ip_contributors"
  DROP COLUMN IF EXISTS "revenue_eligible";

ALTER TABLE "ip_referral_links"
  DROP COLUMN IF EXISTS "commission_bps";

DROP TABLE IF EXISTS "ip_revenue_ledger_entries";
DROP TABLE IF EXISTS "ip_revenue_rules";
DROP TABLE IF EXISTS "ip_media_text_tracks";

DROP TYPE IF EXISTS "IpRevenueLedgerStatus";
DROP TYPE IF EXISTS "IpRevenueLedgerEntryType";
DROP TYPE IF EXISTS "IpRevenueRuleStatus";
DROP TYPE IF EXISTS "IpRevenueRuleType";
DROP TYPE IF EXISTS "IpMediaTextTrackKind";

CREATE TYPE "IpTranslationTargetType_new" AS ENUM ('ip', 'episode', 'campaign');
ALTER TABLE "ip_translation_jobs"
  ALTER COLUMN "target_type" TYPE "IpTranslationTargetType_new"
  USING ("target_type"::text::"IpTranslationTargetType_new");
ALTER TYPE "IpTranslationTargetType" RENAME TO "IpTranslationTargetType_old";
ALTER TYPE "IpTranslationTargetType_new" RENAME TO "IpTranslationTargetType";
DROP TYPE "IpTranslationTargetType_old";

CREATE TYPE "IpReviewTargetType_new" AS ENUM ('ip', 'episode', 'price_rule', 'campaign');
ALTER TABLE "ip_review_submissions"
  ALTER COLUMN "target_type" TYPE "IpReviewTargetType_new"
  USING ("target_type"::text::"IpReviewTargetType_new");
ALTER TYPE "IpReviewTargetType" RENAME TO "IpReviewTargetType_old";
ALTER TYPE "IpReviewTargetType_new" RENAME TO "IpReviewTargetType";
DROP TYPE "IpReviewTargetType_old";

CREATE TYPE "IpContributorRole_new" AS ENUM (
  'owner',
  'producer',
  'director',
  'writer',
  'artist',
  'editor',
  'performer',
  'other'
);
ALTER TABLE "ip_contributors"
  ALTER COLUMN "role" TYPE "IpContributorRole_new"
  USING ("role"::text::"IpContributorRole_new");
ALTER TYPE "IpContributorRole" RENAME TO "IpContributorRole_old";
ALTER TYPE "IpContributorRole_new" RENAME TO "IpContributorRole";
DROP TYPE "IpContributorRole_old";
