CREATE TABLE creator_location_geocodes (
  id uuid PRIMARY KEY,
  creator_id varchar(64) NOT NULL,
  version integer NOT NULL,
  provider varchar(16) NOT NULL CHECK (provider IN ('google', 'amap')),
  status varchar(16) NOT NULL CHECK (status IN ('dispatched', 'uncertain', 'completed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (creator_id, version) REFERENCES creator_location_revisions(creator_id, version) ON DELETE CASCADE,
  CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE INDEX creator_geocode_revision ON creator_location_geocodes(creator_id, version, provider, created_at DESC);
CREATE INDEX creator_geocode_quota ON creator_location_geocodes(created_at, status);
CREATE INDEX creator_geocode_expiry ON creator_location_geocodes(expires_at) WHERE result IS NOT NULL;
