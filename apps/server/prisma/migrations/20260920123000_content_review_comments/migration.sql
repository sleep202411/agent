ALTER TABLE content_review_records
  ADD COLUMN comments jsonb NOT NULL DEFAULT '[]'::jsonb;
