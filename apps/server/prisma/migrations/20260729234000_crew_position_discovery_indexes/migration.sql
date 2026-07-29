-- Public recruitment discovery supports independent multi-select facets.
-- Partial indexes keep the hot, visible subset small; PostgreSQL can combine
-- these through bitmap scans when more than one facet is active.
CREATE INDEX IF NOT EXISTS "crew_positions_public_employment_recent_idx"
  ON "crew_positions" ("employment_type", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'open';

CREATE INDEX IF NOT EXISTS "crew_positions_public_experience_recent_idx"
  ON "crew_positions" ("experience_level", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'open';

CREATE INDEX IF NOT EXISTS "crew_positions_public_work_mode_recent_idx"
  ON "crew_positions" ("work_mode", "created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "status" = 'open';
