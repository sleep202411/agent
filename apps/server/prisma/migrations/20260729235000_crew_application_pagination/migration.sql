-- Owner recruitment inbox:
--   crew + optional position/status filters
--   stable newest-first cursor scan inside status buckets.
CREATE INDEX "crew_applications_position_inbox_idx"
  ON "crew_applications" (
    "crew_id",
    "position_id",
    "status",
    "created_at" DESC,
    "id" DESC
  );
