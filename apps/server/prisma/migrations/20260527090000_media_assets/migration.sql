-- Media asset foundation.
--
-- Business domains should reference media_assets instead of persisting
-- public URLs. The DB stores durable storage identity; Nest materializes
-- public URLs at API boundaries.

CREATE TYPE "MediaAssetKind" AS ENUM (
  'image',
  'video',
  'audio',
  'document',
  'other'
);

CREATE TYPE "MediaStorageProvider" AS ENUM (
  'azure_blob',
  'aliyun_oss',
  's3_compatible',
  'external_url'
);

CREATE TYPE "MediaAssetVisibility" AS ENUM (
  'public',
  'private'
);

CREATE TYPE "MediaAssetStatus" AS ENUM (
  'uploading',
  'ready',
  'failed',
  'deleted'
);

CREATE TABLE "media_assets" (
  "id"                   UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"                 "MediaAssetKind"         NOT NULL,
  "storage_provider"     "MediaStorageProvider"   NOT NULL,
  "bucket"               VARCHAR(128),
  "region"               VARCHAR(64),
  "object_key"           VARCHAR(1024),
  "external_url"         VARCHAR(2048),
  "content_type"         VARCHAR(128)             NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes"           BIGINT,
  "width"                INTEGER,
  "height"               INTEGER,
  "duration_seconds"     INTEGER,
  "checksum_sha256"      VARCHAR(64),
  "visibility"           "MediaAssetVisibility"   NOT NULL DEFAULT 'public',
  "status"               "MediaAssetStatus"       NOT NULL DEFAULT 'ready',
  "created_at"           TIMESTAMPTZ(6)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(6)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"           TIMESTAMPTZ(6),

  CONSTRAINT "media_assets_storage_identity_chk"
    CHECK (
      (
        "storage_provider" = 'external_url'
        AND "external_url" IS NOT NULL
        AND "object_key" IS NULL
      )
      OR
      (
        "storage_provider" <> 'external_url'
        AND "bucket" IS NOT NULL
        AND "object_key" IS NOT NULL
        AND "external_url" IS NULL
      )
    ),
  CONSTRAINT "media_assets_size_chk"
    CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  CONSTRAINT "media_assets_dimensions_chk"
    CHECK (
      ("width" IS NULL OR "width" > 0)
      AND ("height" IS NULL OR "height" > 0)
      AND ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
    ),
  CONSTRAINT "media_assets_checksum_sha256_chk"
    CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[a-f0-9]{64}$')
);

-- One physical object should have one active asset row. Historical
-- soft-deleted rows do not block a later re-import.
CREATE UNIQUE INDEX "media_assets_storage_identity_unique"
  ON "media_assets" ("storage_provider", "bucket", "object_key")
  WHERE "object_key" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "media_assets_external_url_unique"
  ON "media_assets" ("external_url")
  WHERE "storage_provider" = 'external_url'
    AND "external_url" IS NOT NULL
    AND "deleted_at" IS NULL;

CREATE INDEX "media_assets_storage_lookup_idx"
  ON "media_assets" ("storage_provider", "bucket", "object_key");

CREATE INDEX "media_assets_kind_status_idx"
  ON "media_assets" ("kind", "status", "created_at" DESC);

ALTER TABLE "user_certificates"
  ADD COLUMN "image_asset_id" UUID;

-- Forward-compatible backfill if a dev/staging DB already has rows from
-- the previous direct-URL certificate schema. Azure Blob URLs are
-- normalized into stable object identity; everything else becomes an
-- external_url asset so no issued certificate is stranded.
INSERT INTO "media_assets" (
  "kind",
  "storage_provider",
  "bucket",
  "object_key",
  "external_url",
  "content_type",
  "visibility",
  "status"
)
SELECT DISTINCT
  'image'::"MediaAssetKind",
  CASE
    WHEN "image_url" LIKE 'https://%.blob.core.windows.net/foundry-outputs/%'
      THEN 'azure_blob'::"MediaStorageProvider"
    ELSE 'external_url'::"MediaStorageProvider"
  END,
  CASE
    WHEN "image_url" LIKE 'https://%.blob.core.windows.net/foundry-outputs/%'
      THEN 'foundry-outputs'
    ELSE NULL
  END,
  CASE
    WHEN "image_url" LIKE 'https://%.blob.core.windows.net/foundry-outputs/%'
      THEN substring("image_url" FROM 'foundry-outputs/(.*)$')
    ELSE NULL
  END,
  CASE
    WHEN "image_url" LIKE 'https://%.blob.core.windows.net/foundry-outputs/%'
      THEN NULL
    ELSE "image_url"
  END,
  'image/png',
  'public'::"MediaAssetVisibility",
  'ready'::"MediaAssetStatus"
FROM "user_certificates"
WHERE "image_url" IS NOT NULL;

UPDATE "user_certificates" AS cert
SET "image_asset_id" = asset."id"
FROM "media_assets" AS asset
WHERE cert."image_url" IS NOT NULL
  AND (
    (
      asset."storage_provider" = 'azure_blob'
      AND asset."bucket" = 'foundry-outputs'
      AND asset."object_key" = substring(cert."image_url" FROM 'foundry-outputs/(.*)$')
    )
    OR
    (
      asset."storage_provider" = 'external_url'
      AND asset."external_url" = cert."image_url"
    )
  );

ALTER TABLE "user_certificates"
  ALTER COLUMN "image_asset_id" SET NOT NULL;

ALTER TABLE "user_certificates"
  ADD CONSTRAINT "user_certificates_image_asset_id_fkey"
    FOREIGN KEY ("image_asset_id")
    REFERENCES "media_assets" ("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

CREATE INDEX "user_certificates_image_asset_idx"
  ON "user_certificates" ("image_asset_id");

ALTER TABLE "user_certificates"
  DROP COLUMN "image_url";
