-- Provider results are separate from immutable AI metadata and owner corrections.
-- Attempts remain as audit/quota receipts after their coordinate payload expires.
CREATE TABLE ip_content_gps_geocodes (
  id uuid PRIMARY KEY,
  ip_id uuid NOT NULL,
  locale varchar(16) NOT NULL,
  source_fingerprint varchar(64) NOT NULL,
  analysis_version varchar(200) NOT NULL,
  location_id varchar(200) NOT NULL,
  provider varchar(16) NOT NULL CHECK (provider IN ('google', 'amap')),
  status varchar(16) NOT NULL CHECK (status IN ('dispatched', 'uncertain', 'completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (ip_id, locale, source_fingerprint, analysis_version)
    REFERENCES ip_content_gps_analyses (ip_id, locale, source_fingerprint, analysis_version) ON DELETE CASCADE,
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE INDEX gps_geocode_location ON ip_content_gps_geocodes
  (ip_id, locale, source_fingerprint, analysis_version, location_id, provider, created_at DESC);
CREATE INDEX gps_geocode_quota ON ip_content_gps_geocodes (created_at, status);
CREATE INDEX gps_geocode_expiry ON ip_content_gps_geocodes (expires_at) WHERE result IS NOT NULL;
