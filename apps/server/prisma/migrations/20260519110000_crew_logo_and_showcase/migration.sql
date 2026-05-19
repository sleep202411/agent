-- crew_logo_and_showcase
--
-- Shifts the Crew identity model from a hero-style `cover_image` (+
-- optional `cover_video`) to a durable square `logo` plus a set of
-- editable showcase / discovery fields. Hero visual on the visitor
-- page now comes from `showcase_works[0]` (or the logo on a gradient
-- when no showcase is set).
--
-- Backfill strategy: existing rows carry their old `cover_image` URL
-- forward as the new `logo` (UI crops via `object-cover` to fit the
-- square). Acceptable for early-stage data; new crews will be
-- captured as proper square logos via the upload flow.

-- ─── 1. Add new identity column (nullable for backfill) ────
ALTER TABLE "crews" ADD COLUMN "logo" VARCHAR(512);

-- ─── 2. Backfill from the old cover ────────────────────────
UPDATE "crews" SET "logo" = "cover_image" WHERE "logo" IS NULL;

-- ─── 3. Enforce NOT NULL after backfill ────────────────────
ALTER TABLE "crews" ALTER COLUMN "logo" SET NOT NULL;

-- ─── 4. Drop deprecated columns ────────────────────────────
ALTER TABLE "crews" DROP COLUMN "cover_image";
ALTER TABLE "crews" DROP COLUMN "cover_video";

-- ─── 5. Add the new editable / discovery fields ────────────
ALTER TABLE "crews" ADD COLUMN "tagline" VARCHAR(140);
ALTER TABLE "crews" ADD COLUMN "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "crews" ADD COLUMN "styles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "crews" ADD COLUMN "social_links" JSONB;
ALTER TABLE "crews" ADD COLUMN "showcase_works" JSONB;

-- ─── 6. CHECK constraints (defense in depth — server also  ─
--        validates via Zod) ────────────────────────────────
ALTER TABLE "crews"
  ADD CONSTRAINT "crews_logo_length_chk"
  CHECK (char_length("logo") > 0 AND char_length("logo") <= 512);

ALTER TABLE "crews"
  ADD CONSTRAINT "crews_tagline_length_chk"
  CHECK ("tagline" IS NULL OR char_length("tagline") <= 140);

ALTER TABLE "crews"
  ADD CONSTRAINT "crews_genres_count_chk"
  CHECK (array_length("genres", 1) IS NULL OR array_length("genres", 1) <= 5);

ALTER TABLE "crews"
  ADD CONSTRAINT "crews_styles_count_chk"
  CHECK (array_length("styles", 1) IS NULL OR array_length("styles", 1) <= 5);

-- social_links / showcase_works element-level validation lives at
-- the Zod layer (length + URL shape per entry); SQL CHECK on JSONB
-- is doable but the error surface is poor — keep enforcement in
-- the service.
