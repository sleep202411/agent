-- Replace coarse IP type and localized free-text genre/tag arrays with a
-- governed, multilingual taxonomy model.

CREATE TYPE "IpTaxonomyTermType" AS ENUM ('genre', 'tag');
CREATE TYPE "IpTaxonomyTermStatus" AS ENUM ('active', 'hidden', 'archived');
CREATE TYPE "IpTaxonomyAssignmentSource" AS ENUM ('creator', 'admin', 'migration', 'system');

CREATE TABLE "ip_taxonomy_terms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "IpTaxonomyTermType" NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "status" "IpTaxonomyTermStatus" NOT NULL DEFAULT 'active',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by_id" VARCHAR(64),
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_taxonomy_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_taxonomy_terms_type_code_unique" UNIQUE ("type", "code")
);

CREATE TABLE "ip_taxonomy_term_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "term_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "description" VARCHAR(300),
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_taxonomy_term_localizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_taxonomy_term_l10n_term_locale_unique" UNIQUE ("term_id", "locale"),
  CONSTRAINT "ip_taxonomy_term_localizations_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "ip_taxonomy_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ip_taxonomy_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "term_id" UUID NOT NULL,
  "source" "IpTaxonomyAssignmentSource" NOT NULL DEFAULT 'creator',
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_taxonomy_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_taxonomy_assignments_ip_term_unique" UNIQUE ("ip_id", "term_id"),
  CONSTRAINT "ip_taxonomy_assignments_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ip_taxonomy_assignments_term_id_fkey"
    FOREIGN KEY ("term_id") REFERENCES "ip_taxonomy_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ip_taxonomy_terms_type_status_order_idx"
  ON "ip_taxonomy_terms"("type", "status", "display_order");
CREATE INDEX "ip_taxonomy_term_l10n_locale_label_idx"
  ON "ip_taxonomy_term_localizations"("locale", "label");
CREATE INDEX "ip_taxonomy_assignments_ip_order_idx"
  ON "ip_taxonomy_assignments"("ip_id", "display_order");
CREATE INDEX "ip_taxonomy_assignments_term_ip_idx"
  ON "ip_taxonomy_assignments"("term_id", "ip_id");

CREATE TEMP TABLE "_ip_taxonomy_seed" (
  "type" "IpTaxonomyTermType" NOT NULL,
  "code" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "en_us" TEXT NOT NULL,
  "zh_cn" TEXT NOT NULL,
  "zh_hk" TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO "_ip_taxonomy_seed" ("type", "code", "display_order", "en_us", "zh_cn", "zh_hk") VALUES
  ('genre', 'sci_fi', 10, 'Sci-fi', '科幻', '科幻'),
  ('genre', 'fantasy', 20, 'Fantasy', '奇幻', '奇幻'),
  ('genre', 'mystery', 30, 'Mystery', '悬疑', '懸疑'),
  ('genre', 'romance', 40, 'Romance', '爱情', '愛情'),
  ('genre', 'adventure', 50, 'Adventure', '冒险', '冒險'),
  ('genre', 'action', 60, 'Action', '动作', '動作'),
  ('genre', 'comedy', 70, 'Comedy', '喜剧', '喜劇'),
  ('genre', 'drama', 80, 'Drama', '剧情', '劇情'),
  ('genre', 'horror', 90, 'Horror', '恐怖', '恐怖'),
  ('genre', 'children', 100, 'Children', '儿童', '兒童'),
  ('genre', 'education', 110, 'Education', '教育', '教育'),
  ('genre', 'documentary', 120, 'Documentary', '纪录片', '紀錄片');

INSERT INTO "ip_taxonomy_terms" ("type", "code", "display_order", "metadata", "created_by_id")
SELECT
  "type",
  "code",
  "display_order",
  jsonb_build_object('seeded', true),
  'system'
FROM "_ip_taxonomy_seed"
ON CONFLICT ("type", "code") DO UPDATE SET
  "display_order" = EXCLUDED."display_order",
  "metadata" = "ip_taxonomy_terms"."metadata" || EXCLUDED."metadata",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "ip_taxonomy_term_localizations" ("term_id", "locale", "label")
SELECT
  term."id",
  l10n."locale",
  l10n."label"
FROM "_ip_taxonomy_seed" seed
JOIN "ip_taxonomy_terms" term
  ON term."type" = seed."type" AND term."code" = seed."code"
CROSS JOIN LATERAL (
  VALUES
    ('en-US', seed."en_us"),
    ('zh-CN', seed."zh_cn"),
    ('zh-HK', seed."zh_hk")
) AS l10n("locale", "label")
ON CONFLICT ("term_id", "locale") DO UPDATE SET
  "label" = EXCLUDED."label",
  "updated_at" = CURRENT_TIMESTAMP;

CREATE TEMP TABLE "_ip_taxonomy_legacy_entries" AS
SELECT
  l."ip_id",
  'genre'::"IpTaxonomyTermType" AS "type",
  l."locale",
  btrim(item."label") AS "label",
  item."position"::INTEGER AS "display_order"
FROM "ip_localizations" l
CROSS JOIN LATERAL unnest(COALESCE(l."genres", ARRAY[]::TEXT[])) WITH ORDINALITY AS item("label", "position")
WHERE btrim(item."label") <> ''
UNION ALL
SELECT
  l."ip_id",
  'tag'::"IpTaxonomyTermType" AS "type",
  l."locale",
  btrim(item."label") AS "label",
  (1000 + item."position")::INTEGER AS "display_order"
FROM "ip_localizations" l
CROSS JOIN LATERAL unnest(COALESCE(l."tags", ARRAY[]::TEXT[])) WITH ORDINALITY AS item("label", "position")
WHERE btrim(item."label") <> '';

WITH unmatched AS (
  SELECT DISTINCT e."type", e."label"
  FROM "_ip_taxonomy_legacy_entries" e
  LEFT JOIN LATERAL (
    SELECT term."id"
    FROM "ip_taxonomy_terms" term
    JOIN "ip_taxonomy_term_localizations" l10n ON l10n."term_id" = term."id"
    WHERE term."type" = e."type" AND lower(l10n."label") = lower(e."label")
    LIMIT 1
  ) matched ON true
  WHERE matched."id" IS NULL
)
INSERT INTO "ip_taxonomy_terms" ("type", "code", "display_order", "metadata", "created_by_id")
SELECT
  "type",
  'legacy_' || substr(md5("type"::TEXT || ':' || lower("label")), 1, 16),
  10000,
  jsonb_build_object('legacyLabel', "label"),
  'migration'
FROM unmatched
ON CONFLICT ("type", "code") DO NOTHING;

WITH resolved AS (
  SELECT
    e."type",
    e."locale",
    e."label",
    COALESCE(matched."id", legacy_term."id") AS "term_id"
  FROM "_ip_taxonomy_legacy_entries" e
  LEFT JOIN LATERAL (
    SELECT term."id"
    FROM "ip_taxonomy_terms" term
    JOIN "ip_taxonomy_term_localizations" l10n ON l10n."term_id" = term."id"
    WHERE term."type" = e."type" AND lower(l10n."label") = lower(e."label")
    ORDER BY CASE WHEN l10n."locale" = e."locale" THEN 0 ELSE 1 END, term."display_order"
    LIMIT 1
  ) matched ON true
  LEFT JOIN "ip_taxonomy_terms" legacy_term
    ON legacy_term."type" = e."type"
   AND legacy_term."code" = 'legacy_' || substr(md5(e."type"::TEXT || ':' || lower(e."label")), 1, 16)
)
INSERT INTO "ip_taxonomy_term_localizations" ("term_id", "locale", "label")
SELECT DISTINCT "term_id", "locale", "label"
FROM resolved
WHERE "term_id" IS NOT NULL
ON CONFLICT ("term_id", "locale") DO NOTHING;

WITH resolved AS (
  SELECT
    e."ip_id",
    e."display_order",
    e."label",
    COALESCE(matched."id", legacy_term."id") AS "term_id"
  FROM "_ip_taxonomy_legacy_entries" e
  LEFT JOIN LATERAL (
    SELECT term."id"
    FROM "ip_taxonomy_terms" term
    JOIN "ip_taxonomy_term_localizations" l10n ON l10n."term_id" = term."id"
    WHERE term."type" = e."type" AND lower(l10n."label") = lower(e."label")
    ORDER BY CASE WHEN l10n."locale" = e."locale" THEN 0 ELSE 1 END, term."display_order"
    LIMIT 1
  ) matched ON true
  LEFT JOIN "ip_taxonomy_terms" legacy_term
    ON legacy_term."type" = e."type"
   AND legacy_term."code" = 'legacy_' || substr(md5(e."type"::TEXT || ':' || lower(e."label")), 1, 16)
),
deduped AS (
  SELECT DISTINCT ON ("ip_id", "term_id")
    "ip_id",
    "term_id",
    "display_order",
    "label"
  FROM resolved
  WHERE "term_id" IS NOT NULL
  ORDER BY "ip_id", "term_id", "display_order"
)
INSERT INTO "ip_taxonomy_assignments" (
  "ip_id",
  "term_id",
  "source",
  "display_order",
  "metadata",
  "created_by_id"
)
SELECT
  "ip_id",
  "term_id",
  'migration',
  "display_order",
  jsonb_build_object('legacyLabel', "label"),
  'migration'
FROM deduped
ON CONFLICT ("ip_id", "term_id") DO NOTHING;

ALTER TABLE "ip_localizations"
  DROP COLUMN IF EXISTS "genres",
  DROP COLUMN IF EXISTS "tags";

DROP INDEX IF EXISTS "ips_ip_type_feed_idx";
ALTER TABLE "ips" DROP COLUMN IF EXISTS "ip_type";
DROP TYPE IF EXISTS "IpType";
