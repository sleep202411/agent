-- Exact public-text snapshots let catalogue queries reject stale analysis in SQL.
-- Old rows have no snapshot and cannot participate in public GPS search.
ALTER TABLE ip_content_gps_analyses ADD COLUMN source_snapshot JSONB;
ALTER TABLE ip_content_gps_analyses ADD CONSTRAINT gps_analysis_sources
  CHECK (source_snapshot IS NULL OR jsonb_typeof(source_snapshot) = 'array');
