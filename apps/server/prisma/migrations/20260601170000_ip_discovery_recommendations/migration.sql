-- IP Plaza / For You operational recommendations.
--
-- Recommendation rows keep the operational contract: placement, bound IP,
-- enablement, ordering, schedule window and uploaded media assets. Placement
-- decides rendering semantics:
--   ip_plaza_hero        rich hero merchandising, optional localized overrides
--   ip_plaza_for_you     recommendation row, uses IP native card data
--   ip_plaza_list_pinned list/feed pin, uses IP native card data
-- Localized merchandising copy is normalized into a locale table so the public
-- read path can use the same locale allowlist and fallback rules as the rest
-- of IP commerce.

CREATE TYPE "IpDiscoveryPlacementKey" AS ENUM (
  'ip_plaza_hero',
  'ip_plaza_for_you',
  'ip_plaza_list_pinned'
);

CREATE TYPE "IpDiscoveryRecommendationStatus" AS ENUM (
  'draft',
  'enabled',
  'paused',
  'archived'
);

CREATE TABLE "ip_discovery_recommendations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "placement_key" "IpDiscoveryPlacementKey" NOT NULL,
  "ip_id" UUID NOT NULL,
  "status" "IpDiscoveryRecommendationStatus" NOT NULL DEFAULT 'draft',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMPTZ(6),
  "ends_at" TIMESTAMPTZ(6),
  "image_asset_id" UUID,
  "mobile_image_asset_id" UUID,
  "trailer_asset_id" UUID,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "version" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_discovery_recommendations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_discovery_recs_sort_nonnegative" CHECK ("sort_order" >= 0),
  CONSTRAINT "ip_discovery_recs_window_valid" CHECK (
    "starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" < "ends_at"
  ),
  -- P2.6: archive is a closed state — status='archived' iff archived_at is set.
  CONSTRAINT "ip_discovery_recs_archived_state" CHECK (
    ("status" = 'archived') = ("archived_at" IS NOT NULL)
  ),
  CONSTRAINT "ip_discovery_recs_non_hero_no_media" CHECK (
    "placement_key" = 'ip_plaza_hero' OR (
      "image_asset_id" IS NULL AND
      "mobile_image_asset_id" IS NULL AND
      "trailer_asset_id" IS NULL
    )
  ),
  CONSTRAINT "ip_discovery_recs_ip_id_fkey"
    FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ip_discovery_recs_image_asset_fkey"
    FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ip_discovery_recs_mobile_image_fkey"
    FOREIGN KEY ("mobile_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ip_discovery_recs_trailer_media_fkey"
    FOREIGN KEY ("trailer_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ip_discovery_recommendation_localizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recommendation_id" UUID NOT NULL,
  "locale" VARCHAR(16) NOT NULL,
  "eyebrow" VARCHAR(80),
  "title" VARCHAR(160),
  "description" VARCHAR(500),
  "cta_label" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ip_discovery_rec_l10n_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_discovery_rec_l10n_rec_locale_unique" UNIQUE ("recommendation_id", "locale"),
  CONSTRAINT "ip_discovery_rec_l10n_eyebrow_nonempty" CHECK (
    "eyebrow" IS NULL OR btrim("eyebrow") <> ''
  ),
  CONSTRAINT "ip_discovery_rec_l10n_title_nonempty" CHECK (
    "title" IS NULL OR btrim("title") <> ''
  ),
  CONSTRAINT "ip_discovery_rec_l10n_description_nonempty" CHECK (
    "description" IS NULL OR btrim("description") <> ''
  ),
  CONSTRAINT "ip_discovery_rec_l10n_cta_label_nonempty" CHECK (
    "cta_label" IS NULL OR btrim("cta_label") <> ''
  ),
  CONSTRAINT "ip_discovery_rec_l10n_copy_present" CHECK (
    "eyebrow" IS NOT NULL OR
    "title" IS NOT NULL OR
    "description" IS NOT NULL OR
    "cta_label" IS NOT NULL
  ),
  CONSTRAINT "ip_discovery_rec_l10n_recommendation_fkey"
    FOREIGN KEY ("recommendation_id") REFERENCES "ip_discovery_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ip_discovery_rec_l10n_locale_fkey"
    FOREIGN KEY ("locale") REFERENCES "supported_locales"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ip_discovery_recs_lookup_idx"
  ON "ip_discovery_recommendations" ("placement_key", "status", "starts_at", "sort_order");
CREATE INDEX "ip_discovery_recs_ip_idx"
  ON "ip_discovery_recommendations" ("ip_id");
CREATE INDEX "ip_discovery_recs_status_recent_idx"
  ON "ip_discovery_recommendations" ("status", "updated_at" DESC);
CREATE INDEX "ip_discovery_rec_l10n_locale_idx"
  ON "ip_discovery_recommendation_localizations" ("locale");

-- P2.5 DEPLOY PRE-FLIGHT: btree_gist powers the exclusion constraints below.
-- On Azure Postgres Flexible Server it must be allow-listed in the
-- `azure.extensions` server parameter BEFORE this runs, e.g.:
--   az postgres flexible-server parameter set -g <rg> -s <server> \
--     --name azure.extensions --value BTREE_GIST,<existing,values>
-- (preserve existing values), otherwise CREATE EXTENSION fails.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ip_discovery_recommendations"
  ADD CONSTRAINT "ip_discovery_recs_enabled_ip_no_overlap"
  EXCLUDE USING gist (
    "placement_key" WITH =,
    "ip_id" WITH =,
    -- NULL bound = unbounded; avoids the non-IMMUTABLE text->timestamptz cast
    -- that COALESCE(..., 'infinity'::timestamptz) introduced (illegal in a GiST
    -- index expression). Same semantics: open-ended schedule on the NULL side.
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'enabled' AND "archived_at" IS NULL);

ALTER TABLE "ip_discovery_recommendations"
  ADD CONSTRAINT "ip_discovery_recs_enabled_sort_no_overlap"
  EXCLUDE USING gist (
    "placement_key" WITH =,
    "sort_order" WITH =,
    -- NULL bound = unbounded; avoids the non-IMMUTABLE text->timestamptz cast
    -- that COALESCE(..., 'infinity'::timestamptz) introduced (illegal in a GiST
    -- index expression). Same semantics: open-ended schedule on the NULL side.
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'enabled' AND "archived_at" IS NULL)
  -- Deferred so drag-reorder can pass through transient sort_order collisions
  -- inside a transaction; uniqueness is enforced at COMMIT.
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION "validate_ip_discovery_recommendation_assets"()
RETURNS trigger AS $$
BEGIN
  IF NEW."image_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "media_assets"
    WHERE "id" = NEW."image_asset_id"
      AND "kind" = 'image'
      AND "status" = 'ready'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'image_asset_id must reference a ready image media asset'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."mobile_image_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "media_assets"
    WHERE "id" = NEW."mobile_image_asset_id"
      AND "kind" = 'image'
      AND "status" = 'ready'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'mobile_image_asset_id must reference a ready image media asset'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."trailer_asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "media_assets"
    WHERE "id" = NEW."trailer_asset_id"
      AND "kind" = 'video'
      AND "status" = 'ready'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'trailer_asset_id must reference a ready video media asset'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ip_discovery_recs_asset_kind_check"
BEFORE INSERT OR UPDATE OF
  "image_asset_id",
  "mobile_image_asset_id",
  "trailer_asset_id"
ON "ip_discovery_recommendations"
FOR EACH ROW
EXECUTE FUNCTION "validate_ip_discovery_recommendation_assets"();

CREATE OR REPLACE FUNCTION "validate_ip_discovery_recommendation_localization"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ip_discovery_recommendations"
    WHERE "id" = NEW."recommendation_id"
      AND "placement_key" = 'ip_plaza_hero'
  ) THEN
    RAISE EXCEPTION 'localized merchandising copy is only supported for ip_plaza_hero recommendations'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ip_discovery_rec_l10n_hero_only"
BEFORE INSERT OR UPDATE OF "recommendation_id"
ON "ip_discovery_recommendation_localizations"
FOR EACH ROW
EXECUTE FUNCTION "validate_ip_discovery_recommendation_localization"();

-- ---------------------------------------------------------------------------
-- P1.1 + P1.2: an ENABLED recommendation must point at a publicly displayable
-- IP, and an enabled hero must carry a desktop image. Draft/paused rows may be
-- incomplete; the gate only applies when status='enabled'.
-- NOTE: this is point-in-time at write. Drift (the IP later unpublished, or the
-- hero's localized title removed) is enforced by the public read path (defensive
-- join/filter) + the service layer; the title/copy completeness check lives in
-- the service because it spans the separate localization table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "validate_ip_discovery_recommendation_enablement"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'enabled' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ips"
      WHERE "id" = NEW."ip_id"
        AND "status" = 'published'
        AND "listing_visibility" = 'public'
        AND "deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'enabled recommendation requires a published, public, non-deleted IP (ip_id=%)', NEW."ip_id"
        USING ERRCODE = '23514';
    END IF;

    IF NEW."placement_key" = 'ip_plaza_hero' AND NEW."image_asset_id" IS NULL THEN
      RAISE EXCEPTION 'enabled hero recommendation requires an image_asset_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ip_discovery_recs_enablement_check"
BEFORE INSERT OR UPDATE OF "status", "placement_key", "ip_id", "image_asset_id"
ON "ip_discovery_recommendations"
FOR EACH ROW
EXECUTE FUNCTION "validate_ip_discovery_recommendation_enablement"();

-- ---------------------------------------------------------------------------
-- P1.3: close the hero-localization loop. A hero may carry localized copy;
-- moving it to a non-hero placement while copy still exists would orphan that
-- copy and violate "non-hero has no extra copy". Block the transition (operator
-- must clear localizations first). For_you <-> list_pinned moves stay allowed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "validate_ip_discovery_recommendation_placement_change"()
RETURNS trigger AS $$
BEGIN
  IF OLD."placement_key" = 'ip_plaza_hero'
     AND NEW."placement_key" <> 'ip_plaza_hero'
     AND EXISTS (
       SELECT 1 FROM "ip_discovery_recommendation_localizations"
       WHERE "recommendation_id" = OLD."id"
     ) THEN
    RAISE EXCEPTION 'cannot move a hero recommendation with localized copy to a non-hero placement; remove its localizations first'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ip_discovery_recs_placement_change_check"
BEFORE UPDATE OF "placement_key"
ON "ip_discovery_recommendations"
FOR EACH ROW
EXECUTE FUNCTION "validate_ip_discovery_recommendation_placement_change"();

-- ---------------------------------------------------------------------------
-- P1.4: reverse-protect referenced media. The forward trigger only validates at
-- recommendation write time; this guards the other direction — a media asset
-- bound to an ENABLED (non-archived) recommendation cannot be soft-deleted or
-- moved off 'ready' out from under it. (Hard DELETE is governed by the FK's
-- ON DELETE SET NULL; the public read path must still render defensively.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "protect_ip_discovery_referenced_media"()
RETURNS trigger AS $$
BEGIN
  IF (OLD."status" = 'ready' AND OLD."deleted_at" IS NULL)
     AND (NEW."status" <> 'ready' OR NEW."deleted_at" IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM "ip_discovery_recommendations" r
       WHERE r."status" = 'enabled'
         AND r."archived_at" IS NULL
         AND NEW."id" IN (
           r."image_asset_id",
           r."mobile_image_asset_id",
           r."trailer_asset_id"
         )
     ) THEN
    RAISE EXCEPTION 'media asset % is bound to an enabled discovery recommendation; pause or detach it before unpublishing/deleting', NEW."id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_assets_protect_discovery_refs"
BEFORE UPDATE OF "status", "deleted_at"
ON "media_assets"
FOR EACH ROW
EXECUTE FUNCTION "protect_ip_discovery_referenced_media"();
