import type { QueryFilters } from "@tanstack/react-query";

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
  membership: (crewId: string) => ["crew", "members", crewId, "me"] as const,
  applications: (crewId: string) => ["crew", "applications", crewId] as const,
  application: (crewId: string, applicationId: string) =>
    ["crew", "applications", crewId, "detail", applicationId] as const,
  mine: ["crew", "mine"] as const,
  byUser: (userId: string) => ["crew", "by-user", userId] as const,
  assets: (crewId: string) => ["crew", "assets", crewId] as const,
  taskCenter: ["crew", "task-center"] as const,
  taskProject: (crewId: string) => ["crew", "task-project", crewId] as const,
  tasks: (crewId: string) => ["crew", "tasks", crewId] as const,
  taskView: (crewId: string, input: { viewId: string; query?: string; priority?: string }) =>
    ["crew", "tasks", crewId, "view", input] as const,
  taskOptions: (crewId: string, input: Record<string, unknown>) =>
    ["crew", "tasks", crewId, "options", input] as const,
  taskSummary: (crewId: string) => ["crew", "tasks", crewId, "summary"] as const,
  taskActivity: (crewId: string) => ["crew", "tasks", crewId, "activity"] as const,
  task: (taskId: string) => ["crew", "task", taskId] as const,
  taskTimeline: (taskId: string) => ["crew", "task", taskId, "timeline"] as const,
  productionOverview: (crewId: string) => ["crew", "production", crewId, "overview"] as const,
  studioProjectOptions: (crewId: string) =>
    ["crew", "production", crewId, "studio-project-options"] as const,
  productionActivity: (crewId: string) => ["crew", "production", crewId, "activity"] as const,
  episodes: (crewId: string) => ["crew", "production", crewId, "episodes"] as const,
  earnings: (crewId: string, scope: "mine" | "crew") =>
    ["crew", "earnings", crewId, scope] as const,
  earning: (earningId: string) => ["crew", "earning", earningId] as const,
  payouts: (crewId: string, scope: "mine" | "crew") => ["crew", "payouts", crewId, scope] as const,
  payout: (payoutId: string) => ["crew", "payout", payoutId] as const,
  invitations: (crewId: string) => ["crew", "invitations", crewId] as const,
  inviteLinks: (crewId: string) => ["crew", "invite-links", crewId] as const,
  myInvitations: ["crew", "invitations", "mine"] as const,
  invitation: (invitationId: string) => ["crew", "invitation", invitationId] as const,
  agreements: (crewId: string) => ["crew", "agreements", crewId] as const,
  assetContext: (crewId: string) => ["crew", "assets", crewId, "context"] as const,
  assetList: (crewId: string, query: Record<string, unknown>) =>
    ["crew", "assets", crewId, "list", query] as const,
};

// Task detail keys use task IDs, so select their Crew from the cached DTO.
export function crewTaskDetailQueries(
  crewId: string,
  exceptTaskId?: string,
  accountUserId?: string | null
): QueryFilters {
  return {
    queryKey: ["crew", "task"],
    predicate: (query) => {
      const data = query.state.data;
      return (
        query.queryKey.length === 4 &&
        Boolean(accountUserId) &&
        query.queryKey.at(-1) === accountUserId &&
        query.queryKey[2] !== exceptTaskId &&
        typeof data === "object" &&
        data !== null &&
        "crewId" in data &&
        data.crewId === crewId
      );
    },
  };
}

/** Private Crew queries use an account suffix; the cross-Crew centre uses an account prefix. */
export function crewAccountQueries(
  queryKey: readonly unknown[],
  accountUserId: string | null | undefined
): QueryFilters {
  return {
    queryKey,
    predicate: (query) =>
      Boolean(accountUserId) &&
      (query.queryKey[1] === "task-center" ? query.queryKey[2] : query.queryKey.at(-1)) ===
        accountUserId,
  };
}
