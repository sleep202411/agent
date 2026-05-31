CREATE TYPE "IpAssetPurpose" AS ENUM ('source_material', 'reference_art', 'production_asset');

CREATE TABLE "ip_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ip_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "purpose" "IpAssetPurpose" NOT NULL DEFAULT 'source_material',
  "title" VARCHAR(160),
  "description" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" VARCHAR(64) NOT NULL,
  "updated_by_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "ip_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_assets_ip_id_fkey" FOREIGN KEY ("ip_id") REFERENCES "ips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ip_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ip_assets_ip_media_unique" ON "ip_assets" ("ip_id", "media_asset_id");
CREATE INDEX "ip_assets_ip_purpose_recent_idx" ON "ip_assets" ("ip_id", "purpose", "created_at" DESC);
CREATE INDEX "ip_assets_media_idx" ON "ip_assets" ("media_asset_id");
