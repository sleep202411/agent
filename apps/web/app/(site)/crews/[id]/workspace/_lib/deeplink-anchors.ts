/**
 * The DOM anchors a crew notification deeplink targets, and the order
 * the workspace tries them in.
 *
 * The server emits `?tab=tasks&task=<id>`. The task list writes the row
 * id and the workspace reads it back to scroll, so the spelling lives
 * here once, free of React.
 */

import type { WorkspaceTabId } from "./workspace-tabs";

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
  if (tab !== "tasks") return [];
  const taskId = params.get("task");
  return taskId ? [`task-row-${taskId}`] : [];
}
