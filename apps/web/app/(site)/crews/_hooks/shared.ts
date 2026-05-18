/**
 * Crews feature data layer — shared cache keys.
 *
 * Routes import only from `_hooks/use-crew` (the barrel) or sibling
 * `_data` / `_components/`, never from `src/hooks/*`.
 */

export const crewKeys = {
  all: ["crew"] as const,
  list: (cursor?: string) => ["crew", "list", cursor ?? "first"] as const,
  detail: (id: string) => ["crew", "detail", id] as const,
  positions: (crewId: string) => ["crew", "positions", crewId] as const,
  members: (crewId: string) => ["crew", "members", crewId] as const,
  applications: (crewId: string) => ["crew", "applications", crewId] as const,
  mine: ["crew", "mine"] as const,
  episodes: (crewId: string) => ["crew", "episodes", crewId] as const,
  episodeAssignments: (crewId: string, episodeId: string | number) =>
    ["crew", "episode", crewId, String(episodeId), "assignments"] as const,
  episodeActivity: (crewId: string, episodeId: string | number) =>
    ["crew", "episode", crewId, String(episodeId), "activity"] as const,
};
