-- Runtime Manifest v2 is the only schema emitted by new Story Builds.
-- Existing v1 Builds/Releases remain immutable historical records and may be
-- inspected, but the database default must never create another v1 Build.
BEGIN;

ALTER TABLE "story_builds"
  DROP CONSTRAINT "story_builds_runtime_schema_chk",
  ALTER COLUMN "runtime_schema_version" SET DEFAULT 2,
  ADD CONSTRAINT "story_builds_runtime_schema_chk"
    CHECK ("runtime_schema_version" IN (1, 2));

ALTER TABLE "story_releases"
  DROP CONSTRAINT "story_releases_runtime_schema_chk",
  ADD CONSTRAINT "story_releases_runtime_schema_chk"
    CHECK ("runtime_schema_version" IN (1, 2));

COMMIT;
