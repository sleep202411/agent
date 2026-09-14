CREATE TABLE crew_expense_draft_revisions (
  id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  crew_id TEXT NOT NULL REFERENCES crews(id),
  claimant_user_id VARCHAR(64) NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id, version)
);
CREATE INDEX crew_expense_draft_owner_idx ON crew_expense_draft_revisions(claimant_user_id, crew_id, id, version DESC);
