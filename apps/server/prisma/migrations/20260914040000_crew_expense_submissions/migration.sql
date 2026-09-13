CREATE TABLE crew_expense_submissions (
  draft_id UUID NOT NULL,
  draft_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (draft_id, draft_version),
  FOREIGN KEY (draft_id, draft_version) REFERENCES crew_expense_draft_revisions(id, version)
);
CREATE UNIQUE INDEX crew_expense_one_pending_idx ON crew_expense_submissions(draft_id) WHERE status = 'pending';
