-- Private attempt ledger. Never persist device coordinates or provider bodies.
CREATE TABLE creator_device_city_attempts (
  creator_id varchar(64) NOT NULL,
  request_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('dispatched','uncertain','completed')),
  provider varchar(16) NOT NULL CHECK (provider IN ('google','amap')),
  cost integer NOT NULL CHECK (cost IN (1,2)),
  city jsonb CHECK (city IS NULL OR jsonb_typeof(city)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (creator_id, request_id)
);
CREATE INDEX creator_device_city_quota ON creator_device_city_attempts(created_at,status);
