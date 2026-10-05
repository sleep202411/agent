-- Durable recovery for server-held private writes. No signed capabilities stored.
CREATE TABLE crew_revenue_contract_uploads (
  object_key text PRIMARY KEY,
  provider "MediaStorageProvider" NOT NULL,
  bucket text NOT NULL,
  region text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retired')),
  next_attempt_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_revenue_contract_uploads_due ON crew_revenue_contract_uploads(next_attempt_at,object_key);
