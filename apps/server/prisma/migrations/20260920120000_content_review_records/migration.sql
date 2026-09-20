CREATE TABLE content_review_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL,
  file_name varchar(256) NOT NULL,
  export_file_name varchar(256) NOT NULL,
  duration_seconds integer NOT NULL,
  credits_charged integer NOT NULL,
  finding_count integer NOT NULL,
  overview jsonb NOT NULL,
  details jsonb NOT NULL,
  created_by_user_id varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (charge_id)
);
CREATE INDEX content_review_records_workspace_recent_idx
  ON content_review_records (workspace_id, created_at DESC);
