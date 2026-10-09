ALTER TABLE academy_withdrawal_allocations
 ADD COLUMN source_credits BIGINT,
 ADD COLUMN exchange_rate JSONB;
ALTER TABLE academy_withdrawal_allocations ADD CONSTRAINT academy_source_credits_positive CHECK (source_credits IS NULL OR source_credits > 0);
CREATE TABLE academy_exchange_rates (
 pair VARCHAR(16) PRIMARY KEY,
 rate VARCHAR(32) NOT NULL,
 source VARCHAR(500) NOT NULL,
 expires_at TIMESTAMPTZ(6) NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
