import type { CrewTaskListItemDTO } from "@/app/(site)/crews/_hooks/types";
type Task = Pick<CrewTaskListItemDTO, "id" | "parentId" | "status" | "dueAt">;
/** Count deliverables, not grouping tasks, duplicate pages or cancelled work. */
export function workbenchStatistics(tasks: Task[], now: number) {
  const rows = [...new Map(tasks.map((task) => [task.id, task])).values()];
  const parents = new Set(rows.map((task) => task.parentId).filter(Boolean));
  const result = { total: 0, inProgress: 0, overdue: 0, completed: 0 };
  for (const task of rows) {
    if (parents.has(task.id) || task.status === "cancelled") continue;
    result.total++;
    if (task.status === "approved") {
      result.completed++;
      continue;
    }
    if (["in_progress", "submitted", "revision_requested"].includes(task.status))
      result.inProgress++;
    if (task.dueAt && Date.parse(task.dueAt) < now) result.overdue++;
  }
  return result;
}
