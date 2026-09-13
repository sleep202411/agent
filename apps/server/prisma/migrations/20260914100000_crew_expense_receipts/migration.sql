CREATE TABLE crew_expense_receipts (
 id UUID PRIMARY KEY,
 draft_id UUID NOT NULL,
 draft_version INTEGER NOT NULL,
 claimant_user_id VARCHAR(64) NOT NULL,
 name TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 placement JSONB NOT NULL,
 final_key TEXT NOT NULL,
 media_asset_id UUID REFERENCES media_assets(id),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(draft_id,draft_version) REFERENCES crew_expense_draft_revisions(id,version)
);
CREATE INDEX crew_expense_receipts_draft_idx ON crew_expense_receipts(draft_id,claimant_user_id);
