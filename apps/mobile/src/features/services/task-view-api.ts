import { z } from "zod";
import { api } from "@/lib/api-client";
import { taskOption } from "./task-options";
const id = z.string().uuid();
export const taskView = z.object({
  id,
  crewId: z.string().min(1),
  name: z.string().min(1),
  completedMode: z.enum(["all", "recent", "hidden"]),
  showSubIssues: z.boolean(),
});
export type TaskView = z.infer<typeof taskView>;
export type TaskViewQuery = {
  viewId: string;
  query?: string;
  priority?: "low" | "normal" | "high" | "urgent";
};
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export async function fetchTaskViews(crewId: string, signal: AbortSignal) {
  crew.parse(crewId);
  const result = z
    .object({ views: z.array(taskView) })
    .parse(await api.get(`/crews/${crewId}/task-project`, { service: "aurora", signal }));
  if (
    result.views.some((v) => v.crewId !== crewId) ||
    new Set(result.views.map((v) => v.id)).size !== result.views.length
  )
    throw new Error("Task view scope mismatch");
  return result.views;
}
export async function fetchTaskViewPage(
  crewId: string,
  query: TaskViewQuery,
  cursor: string | null,
  signal: AbortSignal
) {
  crew.parse(crewId);
  id.parse(query.viewId);
  if (cursor) id.parse(cursor);
  const search = z
    .string()
    .trim()
    .max(180)
    .parse(query.query ?? "");
  if (query.priority) z.enum(["low", "normal", "high", "urgent"]).parse(query.priority);
  const result = z
    .object({
      items: z.array(taskOption.extend({ crewId: z.string() })),
      nextCursor: id.nullable(),
      total: z.number().int().nonnegative(),
    })
    .parse(
      await api.get(`/crews/${crewId}/tasks`, {
        service: "aurora",
        signal,
        params: {
          viewId: query.viewId,
          query: search || undefined,
          priority: query.priority,
          limit: 30,
          ...(cursor ? { cursor } : {}),
        },
      })
    );
  if (
    result.items.some((v) => v.crewId !== crewId || v.id === cursor) ||
    new Set(result.items.map((v) => v.id)).size !== result.items.length ||
    (result.nextCursor && result.items.at(-1)?.id !== result.nextCursor)
  )
    throw new Error("Task view pagination changed. Refresh to reload.");
  return result;
}
