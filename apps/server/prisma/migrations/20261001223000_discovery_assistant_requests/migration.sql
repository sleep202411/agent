CREATE TABLE discovery_assistant_requests (
  actor_id varchar(64) NOT NULL,
  request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  locale varchar(16) NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('ips', 'creators')),
  coordinate_system varchar(8) NOT NULL CHECK (coordinate_system IN ('WGS84', 'GCJ02')),
  read_token_hash varchar(64),
  read_count integer NOT NULL DEFAULT 0 CHECK (read_count BETWEEN 0 AND 16),
  status varchar(16) NOT NULL CHECK (status IN ('dispatched', 'succeeded', 'uncertain', 'cancelled')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_expires_at timestamptz NOT NULL,
  finished_at timestamptz,
  PRIMARY KEY (actor_id, request_id),
  CHECK ((status = 'succeeded') = (result IS NOT NULL))
);
CREATE INDEX discovery_assistant_quota_idx ON discovery_assistant_requests (created_at, status, read_expires_at);
CREATE UNIQUE INDEX discovery_assistant_read_token_idx ON discovery_assistant_requests (read_token_hash) WHERE read_token_hash IS NOT NULL;
