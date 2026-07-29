-- Crew production is task-based. Episodes belong to Studio project/storyboard
-- structure and must not double as crew assignments.
DROP TABLE IF EXISTS "episode_activities";
DROP TABLE IF EXISTS "episode_assignments";
DROP TABLE IF EXISTS "episodes";

DROP TYPE IF EXISTS "AssignmentStatus";
DROP TYPE IF EXISTS "EpisodeStatus";
