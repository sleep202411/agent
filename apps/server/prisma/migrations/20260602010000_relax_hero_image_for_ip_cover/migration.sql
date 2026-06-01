-- Relax the hero enablement gate: an enabled `ip_plaza_hero` may omit its own
-- `image_asset_id` when the IP itself has a ready cover — the public read path
-- + web fall back to the IP's native card. Mirrors the service-layer relaxation
-- in assertDiscoveryEnablement; without this the DB trigger still rejected
-- image-less heroes (RAISE → 500).
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

    IF NEW."placement_key" = 'ip_plaza_hero'
       AND NEW."image_asset_id" IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM "ips" i
         JOIN "media_assets" m ON m."id" = i."cover_asset_id"
         WHERE i."id" = NEW."ip_id"
           AND m."kind" = 'image'
           AND m."status" = 'ready'
           AND m."deleted_at" IS NULL
       ) THEN
      RAISE EXCEPTION 'enabled hero recommendation requires an image_asset_id or a ready IP cover'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
