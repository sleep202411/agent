-- Remove the compatibility targets introduced immediately before
-- 20260730150000_agent_domain_gateway. Dropping the tables also drops the two
-- obsolete aggregate-version triggers created by that historical migration.
DROP TABLE IF EXISTS "episode_assignments";
DROP TABLE IF EXISTS "episodes";
