CREATE TABLE discovery_preferences (
  site varchar(8) NOT NULL CHECK (site IN ('global', 'cn')),
  actor_id varchar(64) NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  preferences jsonb,
  mutation_id uuid NOT NULL,
  mutation_hash varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, actor_id),
  CHECK (preferences IS NULL OR jsonb_typeof(preferences) = 'object')
);

-- Planning receipts only. No cron, AI dispatch, email or inbox delivery is enabled.
CREATE TABLE discovery_daily_plans (
  site varchar(8) NOT NULL,
  actor_id varchar(64) NOT NULL,
  local_day date NOT NULL,
  preference_revision integer NOT NULL CHECK (preference_revision > 0),
  time_zone varchar(100) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('reserved', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site, actor_id, local_day),
  FOREIGN KEY (site, actor_id) REFERENCES discovery_preferences(site, actor_id) ON DELETE CASCADE
);
CREATE INDEX discovery_daily_plans_pending_idx ON discovery_daily_plans(site, created_at) WHERE status = 'reserved';
