CREATE TABLE ip_content_gps_dispatches (
  id uuid PRIMARY KEY,
  ip_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
  actor_id varchar(64) NOT NULL,
  request_id uuid NOT NULL,
  locale varchar(16) NOT NULL,
  source_fingerprint varchar(64) NOT NULL,
  analysis_version varchar(200) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'dispatched',
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT gps_dispatch_status CHECK (status IN ('dispatched', 'succeeded', 'uncertain')),
  UNIQUE(actor_id, request_id),
  UNIQUE(ip_id, locale, source_fingerprint, analysis_version)
);
CREATE INDEX gps_dispatch_quota_idx ON ip_content_gps_dispatches (created_at, status);
CREATE INDEX gps_dispatch_status_idx ON ip_content_gps_dispatches (status);

-- Bind every accepted request, including cache hits, to its original source.
CREATE TABLE ip_content_gps_analysis_requests (
  actor_id varchar(64) NOT NULL,
  request_id uuid NOT NULL,
  ip_id uuid NOT NULL REFERENCES ips(id) ON DELETE CASCADE,
  locale varchar(16) NOT NULL,
  source_fingerprint varchar(64) NOT NULL,
  analysis_version varchar(200) NOT NULL,
  dispatch_id uuid REFERENCES ip_content_gps_dispatches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
