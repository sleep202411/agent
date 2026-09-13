ALTER TABLE crew_trust_corrections ADD COLUMN revision bigserial NOT NULL;
DROP INDEX crew_trust_corrections_submission;
CREATE INDEX crew_trust_corrections_submission ON crew_trust_corrections(submission_id,revision DESC);
