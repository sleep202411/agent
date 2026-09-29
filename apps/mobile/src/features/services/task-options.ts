import { z } from "zod";
import { api } from "@/lib/api-client";
export const taskOption = z.object({
  id: z.string().uuid(),
  number: z.number().int().positive(),
  title: z.string().min(1).max(240),
});
export type TaskOption = z.infer<typeof taskOption>;
export async function fetchTaskOptions(
  crewId: string,
  query: { query?: string },
  cursor: string | null,
  signal: AbortSignal
) {
  if (!crewId.trim() || crewId.length > 64) throw new Error("Invalid Crew");
  const search = z
    .string()
    .trim()
    .max(180)
    .parse(query.query ?? "");
  return z.object({ items: z.array(taskOption), nextCursor: z.string().uuid().nullable() }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/task-options`, {
      service: "aurora",
      signal,
      params: {
        query: search || undefined,
        limit: 30,
        ...(cursor ? { cursor: z.string().uuid().parse(cursor) } : {}),
      },
    })
  );
}
export function taskLabel(task: TaskOption) {
  return `TASK-${task.number} ${task.title}`
    .replace(/[#\r\n]/g, " ")
    .trim()
    .slice(0, 260);
}
