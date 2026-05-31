-- Keep IP commerce independent from internal production projects.
-- Public IP and episode objects should not carry a PlatformProject source
-- reference in the core contract.

ALTER TABLE "ip_titles"
  DROP CONSTRAINT IF EXISTS "ip_titles_source_project_id_fkey";

ALTER TABLE "ip_episodes"
  DROP CONSTRAINT IF EXISTS "ip_episodes_source_project_id_fkey";

ALTER TABLE "ip_titles"
  DROP COLUMN IF EXISTS "source_project_id";

ALTER TABLE "ip_episodes"
  DROP COLUMN IF EXISTS "source_project_id";
