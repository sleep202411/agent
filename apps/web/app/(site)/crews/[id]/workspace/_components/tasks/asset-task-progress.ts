import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/types";

export const ASSET_TASK_GROUPS = [
  "scripts",
  "characters",
  "scenes",
  "props",
  "art",
  "music",
  "other",
] as const;
type ProgressTask = Pick<CrewTaskDTO, "id" | "parentId" | "status" | "assetCategory">;
export function assetTaskProgress(tasks: ProgressTask[]) {
  const groups = Object.fromEntries(
    ASSET_TASK_GROUPS.map((key) => [key, { approved: 0, total: 0 }])
  ) as Record<(typeof ASSET_TASK_GROUPS)[number], { approved: number; total: number }>;
  // Container tasks are not extra deliverables. Count each task once across paginated reads.
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  function category(task: ProgressTask) {
    const visited = new Set<string>();
    let current: ProgressTask | undefined = task;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const key = ASSET_TASK_GROUPS.find((key) => key === current?.assetCategory);
      if (key && key !== "other" && key !== "art") return key;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return task.assetCategory === "art" ? "art" : "other";
  }
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id) || parents.has(task.id) || task.status === "cancelled") continue;
    seen.add(task.id);
    const key = category(task);
    groups[key].total++;
    if (task.status === "approved") groups[key].approved++;
  }
  return groups;
}
