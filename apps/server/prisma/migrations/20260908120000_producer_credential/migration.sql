ALTER TABLE user_certificates ADD COLUMN credential_type VARCHAR(64) NOT NULL DEFAULT 'general';
ALTER TABLE user_certificates ADD CONSTRAINT user_certificates_credential_type_check
  CHECK (credential_type IN ('general', 'fizzdragon_certified_ai_producer'));
CREATE INDEX user_certificates_crew_eligibility_idx ON user_certificates (user_id, credential_type, issued_at) WHERE revoked_at IS NULL;
