/**
 * Crews feature data layer — shared cache keys + filter shapes.
 *
 * Mirrors the IP feature's `_hooks/` split (see `app/(site)/ips/_hooks/`):
 * routes import only from `_hooks/use-crew` (re-export shim) or sibling
 * `_data` / `_components/`, never from `src/hooks/*`.
 */

// ─── Query keys ────────────────────────────────────────

export interface CrewListFilter {
  search?: string;
  status?: string;
  role?: string;
}

/**
 * Filter shape for `POST /project/crew/list` (queryCrewList).
 * Matches the backend body except for `ipId`, which the frontend
 * doesn't surface — crews aren't bound to an IP at the user-facing
 * layer per phase-1 spec. Backend may still accept it; we just
 * never send it.
 */
export interface QueryCrewListFilter {
  name?: string;
  pageNum?: number;
  pageSize?: number;
  /** Backend lifecycle status. 0 = active, others reserved. */
  status?: number;
}

export const crewKeys = {
  all: ["crew"] as const,
  detail: (id: string) => ["crew", "detail", id] as const,
  workspace: (id: string) => ["crew", "workspace", id] as const,
  members: (id: string) => ["crew", "members", id] as const,
  jobs: (crewId: string | number) => ["crew", "jobs", String(crewId)] as const,
  applicants: (jobId: number) => ["crew", "applicants", jobId] as const,
  queryList: (filter: QueryCrewListFilter) => ["crew", "queryList", filter] as const,
  mine: ["crew", "mine"] as const,
  episodes: (crewId: string) => ["crew", "episodes", crewId] as const,
  episodeAssignments: (crewId: string, episodeId: number) =>
    ["crew", "episode", crewId, episodeId, "assignments"] as const,
  episodeActivity: (crewId: string, episodeId: number) =>
    ["crew", "episode", crewId, episodeId, "activity"] as const,
};
