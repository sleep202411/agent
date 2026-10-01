-- Immutable, source-addressed AI suggestions. Owner assertions stay separate.
CREATE TABLE ip_content_gps_analyses (
  ip_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
  locale varchar(16) NOT NULL,
  source_fingerprint varchar(64) NOT NULL,
  analysis_version varchar(200) NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip_id, locale, source_fingerprint, analysis_version),
  CONSTRAINT gps_analysis_fingerprint CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT gps_analysis_metadata CHECK (jsonb_typeof(metadata) = 'object')
);
