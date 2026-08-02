CREATE TYPE "CrewProductionDateGranularity" AS ENUM (
  'day',
  'month',
  'quarter',
  'half_year',
  'year'
);

ALTER TABLE "crew_production_pages"
  ADD COLUMN "start_date_granularity" "CrewProductionDateGranularity" NOT NULL DEFAULT 'day',
  ADD COLUMN "target_date_granularity" "CrewProductionDateGranularity" NOT NULL DEFAULT 'day';
