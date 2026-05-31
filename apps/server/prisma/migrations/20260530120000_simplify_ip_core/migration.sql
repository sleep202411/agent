-- Simplify the new IP core to the product surface we can fully operate now.
--
-- Story bible, world entities, interactive nodes, and experience runtime tables
-- are parked as future product direction. The current production schema keeps
-- only IP profile, localization, episodes, media, pricing, purchase,
-- entitlement, moderation, and fundraising/accounting foundations.

DELETE FROM "ip_translation_jobs"
WHERE "target_type"::TEXT IN ('story_node', 'story_choice');

DROP TABLE IF EXISTS "ip_story_choice_localizations" CASCADE;
DROP TABLE IF EXISTS "ip_story_node_localizations" CASCADE;
DROP TABLE IF EXISTS "ip_story_choices" CASCADE;
DROP TABLE IF EXISTS "ip_story_nodes" CASCADE;
DROP TYPE IF EXISTS "IpStoryNodeType";

ALTER TABLE "ip_media_text_tracks"
  DROP CONSTRAINT IF EXISTS "ip_media_text_tracks_story_node_id_fkey";
DROP INDEX IF EXISTS "ip_media_text_tracks_node_locale_idx";
ALTER TABLE "ip_media_text_tracks"
  DROP CONSTRAINT IF EXISTS "ip_media_text_tracks_scope_required";
ALTER TABLE "ip_media_text_tracks"
  DROP COLUMN IF EXISTS "story_node_id";
ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_scope_required" CHECK (
    "ip_id" IS NOT NULL OR
    "episode_id" IS NOT NULL OR
    "media_asset_id" IS NOT NULL
  );

CREATE TYPE "IpTranslationTargetType_new" AS ENUM (
  'ip',
  'episode',
  'campaign',
  'media_text_track'
);
ALTER TABLE "ip_translation_jobs"
  ALTER COLUMN "target_type" TYPE "IpTranslationTargetType_new"
  USING "target_type"::TEXT::"IpTranslationTargetType_new";
DROP TYPE "IpTranslationTargetType";
ALTER TYPE "IpTranslationTargetType_new" RENAME TO "IpTranslationTargetType";

DROP TABLE IF EXISTS "ip_world_entities" CASCADE;
DROP TABLE IF EXISTS "ip_experiences" CASCADE;
DROP TYPE IF EXISTS "IpWorldEntityKind";
DROP TYPE IF EXISTS "IpExperienceStatus";
DROP TYPE IF EXISTS "IpExperienceKind";

ALTER TABLE "ips"
  ALTER COLUMN "ip_type" DROP DEFAULT;
CREATE TYPE "IpType_new" AS ENUM (
  'series',
  'film_short',
  'other'
);
ALTER TABLE "ips"
  ALTER COLUMN "ip_type" TYPE "IpType_new"
  USING (
    CASE "ip_type"::TEXT
      WHEN 'series' THEN 'series'
      WHEN 'film_short' THEN 'film_short'
      ELSE 'other'
    END
  )::"IpType_new";
DROP TYPE "IpType";
ALTER TYPE "IpType_new" RENAME TO "IpType";
ALTER TABLE "ips"
  ALTER COLUMN "ip_type" SET DEFAULT 'series';
