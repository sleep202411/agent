-- CrewPosition: add tenure + revenue-share columns
--
-- See model comments in schema.prisma for the conventions:
--   duration_months : NULL = open-ended; 1..60 months otherwise
--   revenue_share_bp: NULL = no share; basis points (1bp = 0.01%),
--                     capped at 5000 (= 50%) per single position
--
-- Both are nullable + idempotent. No backfill — existing rows stay
-- NULL until an owner edits the position. CHECK constraints prevent
-- future writes outside the expected range.

ALTER TABLE "crew_positions"
  ADD COLUMN IF NOT EXISTS "duration_months"   INTEGER,
  ADD COLUMN IF NOT EXISTS "revenue_share_bp"  INTEGER;

ALTER TABLE "crew_positions"
  ADD CONSTRAINT "crew_positions_duration_months_chk"
    CHECK ("duration_months" IS NULL
           OR ("duration_months" >= 1 AND "duration_months" <= 60)),
  ADD CONSTRAINT "crew_positions_revenue_share_bp_chk"
    CHECK ("revenue_share_bp" IS NULL
           OR ("revenue_share_bp" > 0 AND "revenue_share_bp" <= 5000));
