import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const snapshot = z.object({
  templateId: z.string().uuid(),
  templateVersion: z.number().int().positive(),
  episodeVersion: z.number().int().positive(),
});
export const episodeTaskPlan = snapshot
  .extend({
    name: z.string().min(1),
    items: z
      .array(
        z.object({
          templateKey: z.string().min(1),
          title: z.string().min(1),
          roleRequirement: z.string(),
          defaultDependencies: z.array(z.string()),
          deliveryFields: z.array(z.object({ type: z.string().min(1), required: z.boolean() })),
        })
      )
      .min(1),
  })
  .refine((plan) => {
    const keys = new Set(plan.items.map((item) => item.templateKey));
    return (
      keys.size === plan.items.length &&
      plan.items.every((item) =>
        item.defaultDependencies.every((key) => keys.has(key) && key !== item.templateKey)
      )
    );
  }, "Invalid task template dependencies");
export type EpisodeTaskPlan = z.infer<typeof episodeTaskPlan>;
const receipt = z.object({
  taskIds: z.array(z.string().uuid()).refine((ids) => new Set(ids).size === ids.length),
  replayed: z.boolean(),
});
function path(crewId: string, episodeId: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  z.string().uuid().parse(episodeId);
  return `/crews/${encodeURIComponent(crewId)}/episodes/${episodeId}/task-template`;
}
export async function fetchEpisodeTaskPlan(crewId: string, episodeId: string, signal: AbortSignal) {
  return episodeTaskPlan.parse(
    await api.get(path(crewId, episodeId), { service: "aurora", signal })
  );
}
export async function applyEpisodeTaskPlan(
  crewId: string,
  episodeId: string,
  plan: EpisodeTaskPlan,
  generation: number
) {
  if (generation !== getAuthGeneration()) throw new Error("Task template session expired");
  const data = snapshot.parse(plan);
  return receipt.parse(await api.post(path(crewId, episodeId), { service: "aurora", data }));
}
