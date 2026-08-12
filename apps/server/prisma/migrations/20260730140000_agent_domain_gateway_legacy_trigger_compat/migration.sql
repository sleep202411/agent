-- Historical-order compatibility for 20260730150000_agent_domain_gateway.
--
-- The legacy Crew episode tables were retired by
-- 20260729130000_remove_legacy_crew_episodes. The gateway migration was
-- authored against an older schema snapshot and still creates triggers on
-- those two table names. Existing production databases may already have the
-- gateway migration recorded, so its checksum must remain immutable.
--
-- On a database applying the complete history in timestamp order, provide the
-- smallest trigger-compatible targets. The immediately following cleanup
-- migration removes them again; no application version owns or uses them.
CREATE TABLE IF NOT EXISTS "episodes" (
  "crew_id" TEXT
);

CREATE TABLE IF NOT EXISTS "episode_assignments" (
  "crew_id" TEXT
);
