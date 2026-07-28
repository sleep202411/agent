/**
 * Workspace deeplink builder for crew notification meta.
 *
 * Emitted locale-agnostic. The web client is what knows the reader's
 * locale, so it prefixes the path before routing
 * (`notificationHref` → `localizePath`); the server must not guess.
 *
 * The query string is the only channel that tells the workspace *which*
 * episode — and which assignment row inside it — the notification is
 * about. The workspace reads all three params: `tab` selects the
 * episodes board, `episode` expands that episode (its body is where the
 * deliverable and the approve / reject controls live) and scrolls it
 * into view, and `assignment` refines the scroll onto the row itself.
 * Without them every crew notification dumps the reader on the same
 * page with no way back to the thing that happened.
 *
 * Params are purely additive: a client that ignores them still lands on
 * the right crew workspace, so producers and consumers deploy in any order.
 */
export interface WorkspaceDeeplinkArgs {
  crewId: string;
  episodeId: string;
  /** Omitted when the notification is about the episode as a whole, or
   *  when the assignment row no longer exists (unassign deletes it). */
  assignmentId?: string;
}

export function workspaceDeeplink(args: WorkspaceDeeplinkArgs): string {
  const params = new URLSearchParams({
    tab: 'episodes',
    episode: args.episodeId,
  });
  if (args.assignmentId) params.set('assignment', args.assignmentId);
  return `/crews/${args.crewId}/workspace?${params.toString()}`;
}
