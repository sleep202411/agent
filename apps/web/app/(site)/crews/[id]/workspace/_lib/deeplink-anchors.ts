/**
 * The DOM anchors a crew notification deeplink targets, and the order
 * the workspace tries them in.
 *
 * The server emits `?tab=episodes&episode=<e>` and, for anything that
 * happened to one person's work (assigned / submitted / approved /
 * rejected / revenue set), `&assignment=<a>`. Three surfaces have to
 * agree on the resulting element ids — the episodes board writes the
 * episode row's, the assignment table writes the assignment row's, and
 * the page reads both back to scroll — so the spellings live here,
 * once, free of React.
 *
 * Order is most specific first. The assignment row is what the reader
 * was notified about, but it renders strictly later than its episode
 * row (the episode has to expand, then its assignments query has to
 * resolve), so the scroller treats the episode as the fallback it can
 * settle for and upgrade from.
 */

import type { WorkspaceTabId } from "./workspace-tabs";

export function episodeRowAnchorId(episodeId: string): string {
  return `episode-row-${episodeId}`;
}

export function assignmentRowAnchorId(assignmentId: string): string {
  return `assignment-row-${assignmentId}`;
}

/** The `useSearchParams()` surface this needs — narrowed so the contract
 *  is testable with a plain `URLSearchParams`. */
interface ReadonlyParams {
  get(name: string): string | null;
}

/**
 * Anchor candidates for the current view, best first. Empty when there
 * is nothing to scroll to: no deeplink, or a reader who has since moved
 * to a tab that renders no such row.
 */
export function workspaceDeeplinkAnchors(tab: WorkspaceTabId, params: ReadonlyParams): string[] {
  if (tab !== "episodes") return [];
  const assignmentId = params.get("assignment");
  const episodeId = params.get("episode");
  const anchors: string[] = [];
  if (assignmentId) anchors.push(assignmentRowAnchorId(assignmentId));
  if (episodeId) anchors.push(episodeRowAnchorId(episodeId));
  return anchors;
}
