-- Per-locale cover override for IpLocalization (localized poster; falls back to Ip.coverAssetId).
ALTER TABLE "ip_localizations" ADD COLUMN IF NOT EXISTS "cover_asset_id" UUID;
DO $$ BEGIN
  ALTER TABLE "ip_localizations"
    ADD CONSTRAINT "ip_localizations_cover_asset_id_fkey"
    FOREIGN KEY ("cover_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
