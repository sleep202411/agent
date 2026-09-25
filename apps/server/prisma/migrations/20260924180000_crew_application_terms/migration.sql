ALTER TABLE crew_applications ADD COLUMN terms_version INTEGER NOT NULL DEFAULT 0 CHECK (terms_version >= 0);
CREATE TABLE crew_application_terms (
 id UUID PRIMARY KEY,
 application_id TEXT NOT NULL REFERENCES crew_applications(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK (version > 0),
 scope TEXT NOT NULL CHECK (length(trim(scope)) > 0),
 fee_amount BIGINT NOT NULL CHECK (fee_amount >= 0),
 currency VARCHAR(3) NOT NULL CHECK (currency IN ('USD', 'CNY')),
 fee_period VARCHAR(16) NOT NULL CHECK (fee_period IN ('month', 'episode', 'project')),
 revenue_share_bp INTEGER NOT NULL CHECK (revenue_share_bp BETWEEN 0 AND 5000),
 share_basis TEXT,
 proposed_by_user_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 confirmed_at TIMESTAMPTZ,
 UNIQUE (application_id, version),
 CHECK (revenue_share_bp = 0 OR length(trim(share_basis)) > 0 AND share_basis IS NOT NULL)
);
