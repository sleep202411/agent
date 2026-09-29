import { z } from "zod";
import { api } from "@/lib/api-client";
export const taskKindSchema = z.enum([
  "script",
  "gameplay",
  "plot_tree",
  "art",
  "storyboard",
  "voice",
  "music",
  "edit",
  "qa",
  "other",
]);
export type TaskKind = z.infer<typeof taskKindSchema>;
const template = z.object({
  id: z.string().uuid(),
  kind: taskKindSchema,
  name: z.string().min(1).max(80),
  title: z.string().min(1).max(180),
  description: z.string().max(10000),
});
export type TaskKindTemplate = z.infer<typeof template>;
export async function fetchTaskKindTemplates(crewId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const result = z.object({ items: z.array(template) }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/task-kind-templates`, {
      service: "aurora",
      signal,
    })
  );
  if (new Set(result.items.map((item) => item.id)).size !== result.items.length)
    throw new Error("Duplicate task templates");
  return result.items;
}
