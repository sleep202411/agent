import type { TaskDraft } from "./task-draft-session";
import { canvasScenes } from "./canvas-task-import-api";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export const assetGroups = [
  "scripts",
  "characters",
  "scenes",
  "props",
  "art",
  "music",
  "production",
  "other",
] as const;
const row = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  status: z.string().min(1),
  assetCategory: z.enum(assetGroups),
});
const page = z.object({
  items: z.array(row),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
type Task = z.infer<typeof row>;
export function summarizeAssetTasks(tasks: Task[]) {
  const result = Object.fromEntries(
    assetGroups.map((key) => [key, { approved: 0, total: 0 }])
  ) as Record<(typeof assetGroups)[number], { approved: number; total: number }>;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parents = new Set(tasks.map((task) => task.parentId).filter(Boolean));
  for (const task of byId.values()) {
    if (parents.has(task.id) || task.status === "cancelled") continue;
    let key = task.assetCategory;
    let current: Task | undefined = task;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.assetCategory !== "other" && current.assetCategory !== "art") {
        key = current.assetCategory;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    result[key].total++;
    if (task.status === "approved") result[key].approved++;
  }
  return result;
}
export async function fetchAssetTaskProgress(
  crewId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const checkSession = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Task progress request expired");
  };
  const seen = new Set<string>();
  const tasks = new Map<string, Task>();
  let cursor: string | null = null;
  let total: number | undefined;
  do {
    checkSession();
    const result = page.parse(
      await api.get(`/crews/${encodeURIComponent(crewId)}/tasks`, {
        service: "aurora",
        signal,
        params: { viewId: "production", limit: 100, ...(cursor ? { cursor } : {}) },
      })
    );
    checkSession();
    if (total !== undefined && total !== result.total)
      throw new Error("Tasks changed while loading. Refresh task progress.");
    total = result.total;
    for (const task of result.items) {
      if (task.crewId !== crewId) throw new Error("Task progress scope mismatch");
      if (tasks.has(task.id))
        throw new Error("Tasks changed while loading. Refresh task progress.");
      tasks.set(task.id, task);
    }
    if (tasks.size > total) throw new Error("Task progress exceeds the reported task total");
    cursor = result.nextCursor;
    if (cursor) {
      if (seen.has(cursor) || !result.items.length || tasks.size >= total)
        throw new Error("Task progress pagination did not advance");
      seen.add(cursor);
    }
  } while (cursor);
  if (tasks.size !== total) throw new Error("Incomplete task progress. Refresh to try again.");
  return summarizeAssetTasks([...tasks.values()]);
}

/** Pending work is informational and never part of the created-task denominator. */
export function pendingAssetTasks(drafts: TaskDraft[]) {
  const result = Object.fromEntries(assetGroups.map((key) => [key, 0])) as Record<
    (typeof assetGroups)[number],
    number
  >;
  const category = (kind?: string | null, templateKey?: string) => {
    if (templateKey === "character_art") return "characters";
    if (templateKey === "scene_art") return "scenes";
    if (kind === "script") return "scripts";
    if (kind === "music") return "music";
    if (kind === "art") return "art";
    if (["storyboard", "edit", "voice", "qa"].includes(kind ?? "")) return "production";
    return "other";
  };
  for (const draft of drafts) {
    if (draft.state !== "staged") continue;
    if (draft.kind === "task") result[category(draft.input.taskKind)]++;
    else if (draft.kind === "canvas") result.production += canvasScenes(draft.preview).length;
    else
      for (const item of draft.plan.items)
        result[item.assetCategory ?? category(item.taskKind, item.templateKey)]++;
  }
  return result;
}
