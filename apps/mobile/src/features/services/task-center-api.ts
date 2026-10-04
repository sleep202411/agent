import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { taskKindSchema } from "./task-kind-api";
const uuid = z.string().uuid();
export const centerFilters = z.object({
  hasContract: z.boolean().optional(),
  scope: z.enum(["mine", "managed", "all"]),
  status: z.enum(["active", "all", "submitted", "revision_requested", "overdue", "approved"]),
  crewId: z.union([z.literal(""), uuid]),
  taskKind: z.union([z.literal(""), taskKindSchema]),
  query: z.string().trim().max(180),
});
export type CenterFilters = z.infer<typeof centerFilters>;
const crew = z.object({ id: uuid, name: z.string() });
const date = z.string().datetime({ offset: true });
const pageSchema = z.object({
  items: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      contractAssetNodeId: uuid.nullable().optional(),
      number: z.number().int(),
      taskKind: taskKindSchema.nullable(),
      crew,
      status: z.string().min(1),
      workflowState: z.object({
        name: z.string(),
        semantic: z.string(),
        systemKey: z.string().nullable(),
      }),
      priority: z.enum(["low", "normal", "high", "urgent"]),
      dueAt: date.nullable(),
      canSubmit: z.boolean(),
      canReview: z.boolean(),
      deadlineRisk: z.object({ dueAt: date, overdue: z.boolean() }).nullable(),
    })
  ),
  nextCursor: uuid.nullable(),
  crews: z.array(crew),
  categories: z.array(taskKindSchema),
  stats: z.object({
    dueSoon: z.number().int().nonnegative(),
    pendingReviews: z.number().int().nonnegative(),
  }),
});
export type CenterPage = z.infer<typeof pageSchema>;
export type CenterTask = CenterPage["items"][number];
export async function fetchTaskCenter(
  filters: CenterFilters,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || getAuthGeneration() !== generation)
      throw new Error("Task session expired");
  };
  current();
  const parsed = centerFilters.parse(filters);
  if (cursor) uuid.parse(cursor);
  const page = pageSchema.parse(
    await api.get("/crew-task-center", {
      service: "aurora",
      signal,
      retry: false,
      params: {
        scope: parsed.scope,
        status: parsed.status,
        query: parsed.query,
        limit: 30,
        ...(parsed.hasContract !== undefined ? { hasContract: String(parsed.hasContract) } : {}),
        ...(parsed.crewId ? { crewId: parsed.crewId } : {}),
        ...(parsed.taskKind ? { taskKind: parsed.taskKind } : {}),
        ...(cursor ? { cursor } : {}),
      },
    })
  );
  current();
  if (
    new Set(page.items.map((item) => item.id)).size !== page.items.length ||
    page.items.some(
      (item) =>
        item.status !== item.workflowState.semantic ||
        (parsed.hasContract === true && !item.contractAssetNodeId) ||
        (parsed.crewId && item.crew.id !== parsed.crewId) ||
        (parsed.taskKind && item.taskKind !== parsed.taskKind)
    ) ||
    (cursor && page.nextCursor === cursor)
  )
    throw new Error("Invalid task tracking response");
  return page;
}
