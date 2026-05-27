-- Import the first manually issued FizzDragon creator certificates.
--
-- Prerequisites:
--   1. The 20260527090000_media_assets migration has been applied.
--   2. The certificate PNGs already exist in Azure Blob:
--      fizzdragonblob / foundry-outputs / certificates/users/...
--
-- This script is intentionally idempotent:
--   - media_assets are upserted by provider + bucket + object_key.
--   - user_certificates are upserted by cert_no.
--
-- Missing source image:
--   - userId 13060 was present in the operator spreadsheet but no
--     matching certificate image was provided, so it is not imported.

BEGIN;

WITH input(
  user_id,
  cert_no,
  title,
  object_key,
  size_bytes,
  width,
  height,
  issued_at
) AS (
  VALUES
    (
      '12971',
      'FD-OPC-2605-K7M4QZ',
      'AIGC Advanced Creator Program - Level I',
      'certificates/users/12971/12971-FD-I.png',
      1569012::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '12973',
      'FD-OPC-2605-R8N2VX',
      'AIGC Advanced Creator Program - Level I',
      'certificates/users/12973/12973-FD-I.png',
      1570619::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '2254',
      'FD-OPC-2605-T4P9LA',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/2254/2254-FD-II.png',
      1570799::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '294',
      'FD-OPC-2605-M6C3WD',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/294/294-FD-II.png',
      1569911::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '12982',
      'FD-OPC-2605-X2H8BJ',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/12982/12982-FD-II.png',
      1568935::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '2252',
      'FD-OPC-2605-Q5Z7NY',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/2252/2252-FD-II.png',
      1570093::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '2273',
      'FD-OPC-2605-L9V2ES',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/2273/2273-FD-II.png',
      1570475::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    ),
    (
      '13020',
      'FD-OPC-2605-B3Y6KU',
      'AIGC Advanced Creator Program - Level II',
      'certificates/users/13020/13020-FD-II.png',
      1569190::bigint,
      1900,
      1082,
      '2026-03-21 00:00:00+00'::timestamptz
    )
),
upserted_assets AS (
  INSERT INTO media_assets (
    kind,
    storage_provider,
    bucket,
    region,
    object_key,
    external_url,
    content_type,
    size_bytes,
    width,
    height,
    visibility,
    status
  )
  SELECT
    'image'::"MediaAssetKind",
    'azure_blob'::"MediaStorageProvider",
    'foundry-outputs',
    'eastus2',
    input.object_key,
    NULL,
    'image/png',
    input.size_bytes,
    input.width,
    input.height,
    'public'::"MediaAssetVisibility",
    'ready'::"MediaAssetStatus"
  FROM input
  ON CONFLICT (storage_provider, bucket, object_key)
    WHERE object_key IS NOT NULL AND deleted_at IS NULL
  DO UPDATE SET
    content_type = EXCLUDED.content_type,
    size_bytes = EXCLUDED.size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height,
    visibility = EXCLUDED.visibility,
    status = EXCLUDED.status,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id, object_key
),
asset_lookup AS (
  SELECT id, object_key FROM upserted_assets
  UNION
  SELECT media_assets.id, media_assets.object_key
  FROM media_assets
  INNER JOIN input
    ON input.object_key = media_assets.object_key
  WHERE media_assets.storage_provider = 'azure_blob'
    AND media_assets.bucket = 'foundry-outputs'
    AND media_assets.deleted_at IS NULL
),
upserted_certificates AS (
  INSERT INTO user_certificates (
    user_id,
    cert_no,
    title,
    issuer,
    image_asset_id,
    issued_at,
    revoked_at,
    revoked_reason
  )
  SELECT
    input.user_id,
    input.cert_no,
    input.title,
    'FizzDragon',
    asset_lookup.id,
    input.issued_at,
    NULL,
    NULL
  FROM input
  INNER JOIN asset_lookup
    ON asset_lookup.object_key = input.object_key
  ON CONFLICT (cert_no)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    title = EXCLUDED.title,
    issuer = EXCLUDED.issuer,
    image_asset_id = EXCLUDED.image_asset_id,
    issued_at = EXCLUDED.issued_at,
    revoked_at = NULL,
    revoked_reason = NULL,
    updated_at = CURRENT_TIMESTAMP
  RETURNING id, user_id, cert_no, title, image_asset_id
)
SELECT
  COUNT(*) AS imported_certificate_count,
  ARRAY_AGG(user_id ORDER BY user_id) AS imported_user_ids
FROM upserted_certificates;

COMMIT;

-- Optional verification after COMMIT:
--
-- SELECT
--   cert.user_id,
--   cert.cert_no,
--   cert.title,
--   asset.storage_provider,
--   asset.bucket,
--   asset.object_key,
--   cert.issued_at
-- FROM user_certificates cert
-- INNER JOIN media_assets asset
--   ON asset.id = cert.image_asset_id
-- WHERE cert.cert_no LIKE 'FD-OPC-2605-%'
-- ORDER BY cert.user_id;
