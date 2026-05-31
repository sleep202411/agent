-- Product-grade multilingual IP model.
--
-- Core IP tables keep only business facts. Public copy, SEO copy, labels,
-- subtitles, descriptions, genres and tags move to typed localization tables.
-- This keeps locale fallback, review, translation, search and SEO indexable
-- without weak polymorphic localized-text rows.

CREATE TYPE "IpLocalizationStatus" AS ENUM (
  'draft',
  'machine_translated',
  'needs_review',
  'approved',
  'published',
  'outdated',
  'archived'
);

CREATE TYPE "IpTranslationJobStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled'
);

CREATE TYPE "IpTranslationTargetType" AS ENUM (
  'title',
  'episode',
  'story_node',
  'story_choice',
  'campaign',
  'media_text_track'
);

CREATE TYPE "IpMediaTextTrackKind" AS ENUM (
  'subtitle',
  'caption',
  'dubbing_script',
  'transcript'
);

ALTER TABLE "ip_titles"
  RENAME COLUMN "language" TO "source_locale";

CREATE TABLE "ip_title_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "slug" VARCHAR(120),
  "title" VARCHAR(160) NOT NULL,
  "subtitle" VARCHAR(160),
  "summary" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "seo_title" VARCHAR(180),
  "seo_description" VARCHAR(300),
  "source_hash" VARCHAR(64),
  "translated_from_locale" VARCHAR(16),
  "translation_provider" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_title_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_title_localizations_title_nonempty" CHECK (btrim("title") <> ''),
  CONSTRAINT "ip_title_localizations_summary_nonempty" CHECK (btrim("summary") <> ''),
  CONSTRAINT "ip_title_localizations_slug_nonempty" CHECK ("slug" IS NULL OR btrim("slug") <> '')
);

CREATE TABLE "ip_episode_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "episode_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "title" VARCHAR(160) NOT NULL,
  "subtitle" VARCHAR(160),
  "summary" VARCHAR(500),
  "description" TEXT,
  "source_hash" VARCHAR(64),
  "translated_from_locale" VARCHAR(16),
  "translation_provider" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_episode_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_episode_localizations_title_nonempty" CHECK (btrim("title") <> '')
);

CREATE TABLE "ip_story_node_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "story_node_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500),
  "source_hash" VARCHAR(64),
  "translated_from_locale" VARCHAR(16),
  "translation_provider" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_story_node_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_story_node_localizations_title_nonempty" CHECK (btrim("title") <> '')
);

CREATE TABLE "ip_story_choice_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "story_choice_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "label" VARCHAR(120) NOT NULL,
  "source_hash" VARCHAR(64),
  "translated_from_locale" VARCHAR(16),
  "translation_provider" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_story_choice_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_story_choice_localizations_label_nonempty" CHECK (btrim("label") <> '')
);

CREATE TABLE "ip_campaign_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "source_hash" VARCHAR(64),
  "translated_from_locale" VARCHAR(16),
  "translation_provider" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_campaign_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_campaign_localizations_name_nonempty" CHECK (btrim("name") <> '')
);

CREATE TABLE "ip_media_text_tracks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title_id" UUID,
  "episode_id" UUID,
  "story_node_id" UUID,
  "media_asset_id" UUID,
  "content_asset_id" UUID,
  "locale" VARCHAR(16) NOT NULL,
  "kind" "IpMediaTextTrackKind" NOT NULL,
  "status" "IpLocalizationStatus" NOT NULL DEFAULT 'draft',
  "label" VARCHAR(120),
  "format" VARCHAR(32),
  "content" TEXT,
  "source_hash" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_id" VARCHAR(64),
  "reviewed_by_id" VARCHAR(64),
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_media_text_tracks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_media_text_tracks_scope_required" CHECK (
    "title_id" IS NOT NULL OR
    "episode_id" IS NOT NULL OR
    "story_node_id" IS NOT NULL OR
    "media_asset_id" IS NOT NULL
  ),
  CONSTRAINT "ip_media_text_tracks_content_required" CHECK (
    "content" IS NOT NULL OR "content_asset_id" IS NOT NULL
  )
);

CREATE TABLE "ip_translation_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "target_type" "IpTranslationTargetType" NOT NULL,
  "target_id" UUID NOT NULL,
  "source_locale" VARCHAR(16) NOT NULL,
  "target_locale" VARCHAR(16) NOT NULL,
  "status" "IpTranslationJobStatus" NOT NULL DEFAULT 'queued',
  "provider" VARCHAR(64),
  "requested_by_id" VARCHAR(64),
  "idempotency_key" VARCHAR(180) NOT NULL,
  "input_hash" VARCHAR(64),
  "result_localization_id" UUID,
  "error_code" VARCHAR(64),
  "error_message" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_translation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_translation_jobs_locale_diff" CHECK ("source_locale" <> "target_locale")
);

INSERT INTO "ip_title_localizations" (
  "title_id",
  "locale",
  "status",
  "slug",
  "title",
  "subtitle",
  "summary",
  "description",
  "genres",
  "tags",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "source_locale",
  CASE
    WHEN "status" IN ('scheduled', 'published') THEN 'published'::"IpLocalizationStatus"
    WHEN "status" IN ('approved') THEN 'approved'::"IpLocalizationStatus"
    WHEN "status" IN ('submitted', 'in_review', 'changes_requested') THEN 'needs_review'::"IpLocalizationStatus"
    ELSE 'draft'::"IpLocalizationStatus"
  END,
  "slug",
  "title",
  "subtitle",
  "summary",
  "description",
  COALESCE("genres", ARRAY[]::TEXT[]),
  COALESCE("tags", ARRAY[]::TEXT[]),
  "published_at",
  "created_at",
  "updated_at"
FROM "ip_titles";

INSERT INTO "ip_episode_localizations" (
  "episode_id",
  "locale",
  "status",
  "title",
  "subtitle",
  "summary",
  "description",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  e."id",
  t."source_locale",
  CASE
    WHEN e."status" IN ('scheduled', 'published') THEN 'published'::"IpLocalizationStatus"
    WHEN e."status" IN ('approved') THEN 'approved'::"IpLocalizationStatus"
    WHEN e."status" IN ('submitted', 'in_review', 'changes_requested') THEN 'needs_review'::"IpLocalizationStatus"
    ELSE 'draft'::"IpLocalizationStatus"
  END,
  e."title",
  e."subtitle",
  e."summary",
  e."description",
  e."published_at",
  e."created_at",
  e."updated_at"
FROM "ip_episodes" e
JOIN "ip_titles" t ON t."id" = e."title_id";

INSERT INTO "ip_story_node_localizations" (
  "story_node_id",
  "locale",
  "status",
  "title",
  "summary",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  n."id",
  t."source_locale",
  CASE
    WHEN e."status" IN ('scheduled', 'published') THEN 'published'::"IpLocalizationStatus"
    WHEN e."status" IN ('approved') THEN 'approved'::"IpLocalizationStatus"
    WHEN e."status" IN ('submitted', 'in_review', 'changes_requested') THEN 'needs_review'::"IpLocalizationStatus"
    ELSE 'draft'::"IpLocalizationStatus"
  END,
  n."title",
  n."summary",
  e."published_at",
  n."created_at",
  n."updated_at"
FROM "ip_story_nodes" n
JOIN "ip_episodes" e ON e."id" = n."episode_id"
JOIN "ip_titles" t ON t."id" = e."title_id";

INSERT INTO "ip_story_choice_localizations" (
  "story_choice_id",
  "locale",
  "status",
  "label",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  t."source_locale",
  CASE
    WHEN e."status" IN ('scheduled', 'published') THEN 'published'::"IpLocalizationStatus"
    WHEN e."status" IN ('approved') THEN 'approved'::"IpLocalizationStatus"
    WHEN e."status" IN ('submitted', 'in_review', 'changes_requested') THEN 'needs_review'::"IpLocalizationStatus"
    ELSE 'draft'::"IpLocalizationStatus"
  END,
  c."label",
  c."created_at",
  c."updated_at"
FROM "ip_story_choices" c
JOIN "ip_story_nodes" n ON n."id" = c."from_node_id"
JOIN "ip_episodes" e ON e."id" = n."episode_id"
JOIN "ip_titles" t ON t."id" = e."title_id";

INSERT INTO "ip_campaign_localizations" (
  "campaign_id",
  "locale",
  "status",
  "name",
  "description",
  "published_at",
  "created_at",
  "updated_at"
)
SELECT
  c."id",
  t."source_locale",
  CASE
    WHEN c."status" IN ('scheduled', 'active') THEN 'published'::"IpLocalizationStatus"
    ELSE 'draft'::"IpLocalizationStatus"
  END,
  c."name",
  c."description",
  c."starts_at",
  c."created_at",
  c."updated_at"
FROM "ip_campaigns" c
JOIN "ip_titles" t ON t."id" = c."title_id";

ALTER TABLE "ip_title_localizations"
  ADD CONSTRAINT "ip_title_localizations_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_episode_localizations"
  ADD CONSTRAINT "ip_episode_localizations_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_story_node_localizations"
  ADD CONSTRAINT "ip_story_node_localizations_story_node_id_fkey"
  FOREIGN KEY ("story_node_id") REFERENCES "ip_story_nodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_story_choice_localizations"
  ADD CONSTRAINT "ip_story_choice_localizations_story_choice_id_fkey"
  FOREIGN KEY ("story_choice_id") REFERENCES "ip_story_choices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_campaign_localizations"
  ADD CONSTRAINT "ip_campaign_localizations_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "ip_campaigns"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_title_id_fkey"
  FOREIGN KEY ("title_id") REFERENCES "ip_titles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_episode_id_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "ip_episodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_story_node_id_fkey"
  FOREIGN KEY ("story_node_id") REFERENCES "ip_story_nodes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ip_media_text_tracks"
  ADD CONSTRAINT "ip_media_text_tracks_content_asset_id_fkey"
  FOREIGN KEY ("content_asset_id") REFERENCES "media_assets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ip_title_localizations_title_locale_unique"
  ON "ip_title_localizations" ("title_id", "locale");
CREATE UNIQUE INDEX "ip_title_localizations_public_slug_unique"
  ON "ip_title_localizations" ("locale", "slug")
  WHERE "slug" IS NOT NULL AND "archived_at" IS NULL AND "status" = 'published';
CREATE INDEX "ip_title_localizations_public_locale_idx"
  ON "ip_title_localizations" ("locale", "status", "published_at" DESC);
CREATE INDEX "ip_title_localizations_status_recent_idx"
  ON "ip_title_localizations" ("status", "updated_at" DESC);

CREATE UNIQUE INDEX "ip_episode_localizations_episode_locale_unique"
  ON "ip_episode_localizations" ("episode_id", "locale");
CREATE INDEX "ip_episode_localizations_public_locale_idx"
  ON "ip_episode_localizations" ("locale", "status", "published_at" DESC);
CREATE INDEX "ip_episode_localizations_status_recent_idx"
  ON "ip_episode_localizations" ("status", "updated_at" DESC);

CREATE UNIQUE INDEX "ip_story_node_localizations_node_locale_unique"
  ON "ip_story_node_localizations" ("story_node_id", "locale");
CREATE INDEX "ip_story_node_localizations_public_locale_idx"
  ON "ip_story_node_localizations" ("locale", "status", "published_at" DESC);
CREATE INDEX "ip_story_node_localizations_status_recent_idx"
  ON "ip_story_node_localizations" ("status", "updated_at" DESC);

CREATE UNIQUE INDEX "ip_story_choice_localizations_choice_locale_unique"
  ON "ip_story_choice_localizations" ("story_choice_id", "locale");
CREATE INDEX "ip_story_choice_localizations_public_locale_idx"
  ON "ip_story_choice_localizations" ("locale", "status", "published_at" DESC);
CREATE INDEX "ip_story_choice_localizations_status_recent_idx"
  ON "ip_story_choice_localizations" ("status", "updated_at" DESC);

CREATE UNIQUE INDEX "ip_campaign_localizations_campaign_locale_unique"
  ON "ip_campaign_localizations" ("campaign_id", "locale");
CREATE INDEX "ip_campaign_localizations_public_locale_idx"
  ON "ip_campaign_localizations" ("locale", "status", "published_at" DESC);
CREATE INDEX "ip_campaign_localizations_status_recent_idx"
  ON "ip_campaign_localizations" ("status", "updated_at" DESC);

CREATE INDEX "ip_media_text_tracks_title_locale_idx"
  ON "ip_media_text_tracks" ("title_id", "locale", "kind", "status");
CREATE INDEX "ip_media_text_tracks_episode_locale_idx"
  ON "ip_media_text_tracks" ("episode_id", "locale", "kind", "status");
CREATE INDEX "ip_media_text_tracks_node_locale_idx"
  ON "ip_media_text_tracks" ("story_node_id", "locale", "kind", "status");
CREATE INDEX "ip_media_text_tracks_media_locale_idx"
  ON "ip_media_text_tracks" ("media_asset_id", "locale", "kind", "status");

CREATE UNIQUE INDEX "ip_translation_jobs_idempotency_key_unique"
  ON "ip_translation_jobs" ("idempotency_key");
CREATE INDEX "ip_translation_jobs_target_idx"
  ON "ip_translation_jobs" ("target_type", "target_id", "target_locale", "status");
CREATE INDEX "ip_translation_jobs_queue_idx"
  ON "ip_translation_jobs" ("status", "requested_at" DESC);

DROP INDEX IF EXISTS "ip_titles_active_slug_unique";

ALTER TABLE "ip_titles"
  DROP CONSTRAINT IF EXISTS "ip_titles_title_nonempty",
  DROP CONSTRAINT IF EXISTS "ip_titles_summary_nonempty",
  DROP CONSTRAINT IF EXISTS "ip_titles_slug_nonempty";

ALTER TABLE "ip_episodes"
  DROP CONSTRAINT IF EXISTS "ip_episodes_title_nonempty";

ALTER TABLE "ip_story_nodes"
  DROP CONSTRAINT IF EXISTS "ip_story_nodes_title_nonempty";

ALTER TABLE "ip_story_choices"
  DROP CONSTRAINT IF EXISTS "ip_story_choices_label_nonempty";

ALTER TABLE "ip_campaigns"
  DROP CONSTRAINT IF EXISTS "ip_campaigns_name_nonempty";

ALTER TABLE "ip_titles"
  DROP COLUMN "slug",
  DROP COLUMN "title",
  DROP COLUMN "subtitle",
  DROP COLUMN "summary",
  DROP COLUMN "description",
  DROP COLUMN "genres",
  DROP COLUMN "tags";

ALTER TABLE "ip_episodes"
  DROP COLUMN "title",
  DROP COLUMN "subtitle",
  DROP COLUMN "summary",
  DROP COLUMN "description";

ALTER TABLE "ip_story_nodes"
  DROP COLUMN "title",
  DROP COLUMN "summary";

ALTER TABLE "ip_story_choices"
  DROP COLUMN "label";

ALTER TABLE "ip_campaigns"
  DROP COLUMN "name",
  DROP COLUMN "description";
