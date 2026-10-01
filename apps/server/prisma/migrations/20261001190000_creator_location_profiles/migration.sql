-- Java owns identity. The authenticated subject owns these declarations.
-- Coordinates are deliberately absent from this owner-editable payload.
CREATE TABLE creator_location_revisions (
  id UUID PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  expected_version INTEGER NOT NULL CHECK (expected_version = version - 1),
  request_id UUID NOT NULL,
  profile JSONB NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (creator_id, version),
  UNIQUE (creator_id, request_id)
);
