import { z } from "zod";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { fetchPositionCreateAccess } from "./position-create-api";
const id = z.string().uuid();
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const batchTaskSchema = z.object({
  id,
  crewId: crew,
  number: z.number().int().positive(),
  title: z.string().min(1),
  assetCategory: z.string().optional(),
  version: z.number().int().nonnegative(),
  status: z.string(),
  isRecruiting: z.boolean(),
  assignees: z.array(z.object({ userId: z.string().min(1) })),
  requiredSkills: z.array(z.string()),
  rewardUsdMinor: z.number().int().nonnegative().safe().nullable(),
  rewardCurrency: z.enum(["USD", "CNY"]),
});
export type BatchTask = z.infer<typeof batchTaskSchema>;
export function canBatchTask(task: BatchTask) {
  return (
    !task.assignees.length &&
    !task.isRecruiting &&
    ["open", "in_progress", "revision_requested"].includes(task.status)
  );
}
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration())
    throw new Error("Batch task session expired");
}
export async function fetchBatchTasks(
  crewId: string,
  userId: string,
  generation: number,
  cursor: string | null,
  signal: AbortSignal
) {
  crew.parse(crewId);
  if (cursor) id.parse(cursor);
  current(generation, signal);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation, signal);
  if (!access.canManage) throw new Error("Task management permission is required.");
  const result = z.object({ items: z.array(batchTaskSchema), nextCursor: id.nullable() }).parse(
    await api.get(`/crews/${crewId}/tasks`, {
      service: "aurora",
      signal,
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    })
  );
  current(generation, signal);
  if (
    result.items.some((t) => t.crewId !== crewId) ||
    new Set(result.items.map((t) => t.id)).size !== result.items.length ||
    (cursor && result.nextCursor === cursor)
  )
    throw new Error("Batch task scope or pagination changed");
  return result;
}
export async function submitTaskBatch(
  crewId: string,
  userId: string,
  generation: number,
  tasks: BatchTask[],
  mode: "assign" | "recruit",
  target: string
) {
  crew.parse(crewId);
  current(generation);
  const selected = z.array(batchTaskSchema).min(1).max(100).parse(tasks);
  if (
    new Set(selected.map((t) => t.id)).size !== selected.length ||
    selected.some((t) => t.crewId !== crewId || !canBatchTask(t))
  )
    throw new Error("Select available unassigned tasks only.");
  const versions = selected.map((t) => ({ id: t.id, expectedVersion: t.version }));
  if (mode === "recruit") {
    if (!PRESET_POSITIONS.some((p) => p.value === target))
      throw new Error("Choose a valid position");
    const access = await fetchPositionCreateAccess(crewId, userId, generation);
    if (!access.canLinkTask)
      throw new Error("Task management and viewing permissions are required.");
    current(generation);
    const result = z
      .object({
        id,
        crewId: crew,
        positionType: z.string(),
        recruitmentVisibility: z.literal("public"),
      })
      .parse(
        await api.post(`/crews/${crewId}/positions`, {
          service: "aurora",
          data: {
            tasks: versions,
            recruitmentVisibility: "public",
            positionType: target,
            description: selected.map((t) => t.title).join("; "),
            targetCount: 1,
            workMode: "remote",
            employmentType: "project_based",
            requiredSkills: [...new Set(selected.flatMap((t) => t.requiredSkills))],
          },
        })
      );
    current(generation);
    if (result.crewId !== crewId || result.positionType !== target)
      throw new Error("Recruitment receipt does not match");
    return;
  }
  z.string().min(1).max(64).parse(target);
  const result = z.object({ taskIds: z.array(id) }).parse(
    await api.post(`/crews/${crewId}/tasks/batch-assign`, {
      service: "aurora",
      data: { tasks: versions, assigneeId: target },
    })
  );
  current(generation);
  if (
    result.taskIds.length !== selected.length ||
    new Set(result.taskIds).size !== selected.length ||
    result.taskIds.some((value) => !selected.some((t) => t.id === value))
  )
    throw new Error("Assignment receipt does not match");
}
