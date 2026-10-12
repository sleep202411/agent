import type { TaskDraft, TaskDraftReview } from "./task-draft-session";
import { fetchTaskPlanningOptions } from "./task-planning-api";
import { fetchManualTaskWorkflows } from "./task-workflow-api";
import { fetchTaskOptions, type TaskOption } from "./task-options";
/** Resolve saved IDs before opening older drafts. Missing options must never silently clear selections. */
export async function restoreTaskDraftEditor(
  crewId: string,
  draft: Extract<TaskDraft, { kind: "task" }>,
  signal: AbortSignal
): Promise<NonNullable<TaskDraftReview["editor"]>> {
  signal.throwIfAborted();
  if (draft.review.editor) return draft.review.editor;
  const input = draft.input;
  const [labels, cycles, episodes, workflows] = await Promise.all([
    input.labelIds?.length ? fetchTaskPlanningOptions(crewId, "labels", signal) : [],
    input.cycleId ? fetchTaskPlanningOptions(crewId, "cycle", signal) : [],
    input.episodeId ? fetchTaskPlanningOptions(crewId, "episode", signal) : [],
    input.workflowStateId ? fetchManualTaskWorkflows(crewId, signal) : [],
  ]);
  const find = <T extends { id: string }>(rows: T[], id: string): T => {
    const found = rows.find((row) => row.id === id);
    if (!found)
      throw Error(`Saved task selection ${id} is unavailable. The draft has not been changed.`);
    return found;
  };
  const required = new Set([
    ...(input.parentId ? [input.parentId] : []),
    ...input.blockedByTaskIds,
  ]);
  const tasks: TaskOption[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  while (required.size) {
    signal.throwIfAborted();
    const page = await fetchTaskOptions(crewId, {}, cursor, signal);
    for (const task of page.items) if (required.delete(task.id)) tasks.push(task);
    if (!required.size || !page.nextCursor) break;
    if (seen.has(page.nextCursor))
      throw Error("Task options pagination did not advance. The draft has not been changed.");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  signal.throwIfAborted();
  return {
    planning: {
      labels: (input.labelIds ?? []).map((id) => find(labels, id)),
      cycle: input.cycleId ? find(cycles, input.cycleId) : null,
      episode: input.episodeId ? find(episodes, input.episodeId) : null,
    },
    workflow: input.workflowStateId ? find(workflows, input.workflowStateId) : null,
    parent: input.parentId ? find(tasks, input.parentId) : null,
    blockers: input.blockedByTaskIds.map((id) => find(tasks, id)),
    assignees: input.assignees.map((row, index) => ({
      userId: row.userId,
      label: draft.review.assignees[index] ?? row.userId,
    })),
  };
}
