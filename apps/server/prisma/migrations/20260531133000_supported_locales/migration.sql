-- Govern IP localization locales through a DB-backed allowlist. This keeps
-- the first production launch constrained to the three supported locales
-- while allowing future locale expansion by inserting a new row instead of
-- changing enum types.

CREATE TYPE "SupportedLocaleStatus" AS ENUM ('active', 'hidden', 'archived');

CREATE TABLE "supported_locales" (
  "code" VARCHAR(16) NOT NULL,
  "status" "SupportedLocaleStatus" NOT NULL DEFAULT 'active',
  "display_name" VARCHAR(80) NOT NULL,
  "native_name" VARCHAR(80) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supported_locales_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "supported_locales_code_format"
    CHECK ("code" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  CONSTRAINT "supported_locales_display_name_nonempty"
    CHECK (btrim("display_name") <> ''),
  CONSTRAINT "supported_locales_native_name_nonempty"
    CHECK (btrim("native_name") <> '')
);

CREATE INDEX "supported_locales_status_order_idx"
  ON "supported_locales" ("status", "display_order");

INSERT INTO "supported_locales" (
  "code",
  "status",
  "display_name",
  "native_name",
  "display_order",
  "metadata"
) VALUES
  ('en-US', 'active', 'English (US)', 'English', 10, '{"region":"global"}'::jsonb),
  ('zh-CN', 'active', 'Simplified Chinese', '简体中文', 20, '{"region":"cn"}'::jsonb),
  ('zh-HK', 'active', 'Traditional Chinese', '繁體中文', 30, '{"region":"hk"}'::jsonb)
ON CONFLICT ("code") DO UPDATE SET
  "status" = EXCLUDED."status",
  "display_name" = EXCLUDED."display_name",
  "native_name" = EXCLUDED."native_name",
  "display_order" = EXCLUDED."display_order",
  "metadata" = "supported_locales"."metadata" || EXCLUDED."metadata",
  "updated_at" = CURRENT_TIMESTAMP;

CREATE TEMP TABLE "_supported_locale_aliases" (
  "raw" TEXT PRIMARY KEY,
  "code" VARCHAR(16) NOT NULL
) ON COMMIT DROP;

INSERT INTO "_supported_locale_aliases" ("raw", "code") VALUES
  ('en', 'en-US'),
  ('en-us', 'en-US'),
  ('zh', 'zh-CN'),
  ('zh-cn', 'zh-CN'),
  ('zh-hans', 'zh-CN'),
  ('zh-hans-cn', 'zh-CN'),
  ('cn', 'zh-CN'),
  ('zh-hk', 'zh-HK'),
  ('zh-tw', 'zh-HK'),
  ('zh-hant', 'zh-HK'),
  ('zh-hant-hk', 'zh-HK'),
  ('zh-hant-tw', 'zh-HK'),
  ('hk', 'zh-HK'),
  ('tw', 'zh-HK')
ON CONFLICT ("raw") DO NOTHING;

UPDATE "ips" t
SET "source_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."source_locale", '_', '-')) = a."raw";

UPDATE "ip_taxonomy_term_localizations" t
SET "locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."locale", '_', '-')) = a."raw";

UPDATE "ip_localizations" t
SET "locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."locale", '_', '-')) = a."raw";

UPDATE "ip_localizations" t
SET "translated_from_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE t."translated_from_locale" IS NOT NULL
  AND lower(replace(t."translated_from_locale", '_', '-')) = a."raw";

UPDATE "ip_episode_localizations" t
SET "locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."locale", '_', '-')) = a."raw";

UPDATE "ip_episode_localizations" t
SET "translated_from_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE t."translated_from_locale" IS NOT NULL
  AND lower(replace(t."translated_from_locale", '_', '-')) = a."raw";

UPDATE "ip_campaign_localizations" t
SET "locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."locale", '_', '-')) = a."raw";

UPDATE "ip_campaign_localizations" t
SET "translated_from_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE t."translated_from_locale" IS NOT NULL
  AND lower(replace(t."translated_from_locale", '_', '-')) = a."raw";

UPDATE "ip_translation_jobs" t
SET "source_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."source_locale", '_', '-')) = a."raw";

UPDATE "ip_translation_jobs" t
SET "target_locale" = a."code"
FROM "_supported_locale_aliases" a
WHERE lower(replace(t."target_locale", '_', '-')) = a."raw";

DO $$
DECLARE
  unsupported TEXT;
BEGIN
  SELECT string_agg(DISTINCT "source_locale", ', ' ORDER BY "source_locale")
  INTO unsupported
  FROM "ips"
  WHERE "source_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ips.source_locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "locale", ', ' ORDER BY "locale")
  INTO unsupported
  FROM "ip_taxonomy_term_localizations"
  WHERE "locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_taxonomy_term_localizations.locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "locale", ', ' ORDER BY "locale")
  INTO unsupported
  FROM "ip_localizations"
  WHERE "locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_localizations.locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "translated_from_locale", ', ' ORDER BY "translated_from_locale")
  INTO unsupported
  FROM "ip_localizations"
  WHERE "translated_from_locale" IS NOT NULL
    AND "translated_from_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_localizations.translated_from_locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "locale", ', ' ORDER BY "locale")
  INTO unsupported
  FROM "ip_episode_localizations"
  WHERE "locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_episode_localizations.locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "translated_from_locale", ', ' ORDER BY "translated_from_locale")
  INTO unsupported
  FROM "ip_episode_localizations"
  WHERE "translated_from_locale" IS NOT NULL
    AND "translated_from_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_episode_localizations.translated_from_locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "locale", ', ' ORDER BY "locale")
  INTO unsupported
  FROM "ip_campaign_localizations"
  WHERE "locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_campaign_localizations.locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "translated_from_locale", ', ' ORDER BY "translated_from_locale")
  INTO unsupported
  FROM "ip_campaign_localizations"
  WHERE "translated_from_locale" IS NOT NULL
    AND "translated_from_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_campaign_localizations.translated_from_locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "source_locale", ', ' ORDER BY "source_locale")
  INTO unsupported
  FROM "ip_translation_jobs"
  WHERE "source_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_translation_jobs.source_locale values: %', unsupported;
  END IF;

  SELECT string_agg(DISTINCT "target_locale", ', ' ORDER BY "target_locale")
  INTO unsupported
  FROM "ip_translation_jobs"
  WHERE "target_locale" NOT IN (SELECT "code" FROM "supported_locales");
  IF unsupported IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported ip_translation_jobs.target_locale values: %', unsupported;
  END IF;
END $$;

ALTER TABLE "ips"
  ADD CONSTRAINT "ips_source_locale_fkey"
  FOREIGN KEY ("source_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_taxonomy_term_localizations"
  ADD CONSTRAINT "ip_taxonomy_term_localizations_locale_fkey"
  FOREIGN KEY ("locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_localizations"
  ADD CONSTRAINT "ip_localizations_locale_fkey"
  FOREIGN KEY ("locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_localizations"
  ADD CONSTRAINT "ip_localizations_translated_from_locale_fkey"
  FOREIGN KEY ("translated_from_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_episode_localizations"
  ADD CONSTRAINT "ip_episode_localizations_locale_fkey"
  FOREIGN KEY ("locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_episode_localizations"
  ADD CONSTRAINT "ip_episode_localizations_translated_from_locale_fkey"
  FOREIGN KEY ("translated_from_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_campaign_localizations"
  ADD CONSTRAINT "ip_campaign_localizations_locale_fkey"
  FOREIGN KEY ("locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_campaign_localizations"
  ADD CONSTRAINT "ip_campaign_localizations_translated_from_locale_fkey"
  FOREIGN KEY ("translated_from_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_translation_jobs"
  ADD CONSTRAINT "ip_translation_jobs_source_locale_fkey"
  FOREIGN KEY ("source_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ip_translation_jobs"
  ADD CONSTRAINT "ip_translation_jobs_target_locale_fkey"
  FOREIGN KEY ("target_locale") REFERENCES "supported_locales"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
