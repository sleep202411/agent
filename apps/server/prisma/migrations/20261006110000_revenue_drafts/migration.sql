CREATE TABLE crew_revenue_drafts (
  admin_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, crew_id)
);
