import { z } from "zod";
import { taskKindSchema } from "./task-kind-api";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const snapshot = z.object({
  templateId: z.string().uuid(),
  templateVersion: z.number().int().positive(),
  episodeVersion: z.number().int().positive(),
  taskFields: z
    .array(
      z
        .object({
          templateKey: z.string().min(1).max(128),
          values: z
            .array(
              z
                .object({
                  fieldId: z.string().uuid(),
                  value: z.union([
                    z.string().max(4000),
                    z.number().finite(),
                    z.boolean(),
                    z.array(z.string().max(128)).max(50),
                    z.null(),
                  ]),
                })
                .strict()
            )
            .max(50)
            .refine((rows) => new Set(rows.map((row) => row.fieldId)).size === rows.length),
        })
        .strict()
    )
    .max(200)
    .optional(),
});
export const episodeTaskPlan = snapshot
  .extend({
    name: z.string().min(1),
    fieldReview: z.record(z.string(), z.array(z.string())).optional(),
    items: z
      .array(
        z.object({
          templateKey: z.string().min(1),
          title: z.string().min(1),
          taskKind: taskKindSchema.nullable().optional(),
          assetCategory: z
            .enum([
              "scripts",
              "characters",
              "scenes",
              "props",
              "art",
              "music",
              "production",
              "other",
            ])
            .optional(),
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
      new Set((plan.taskFields ?? []).map((row) => row.templateKey)).size ===
        (plan.taskFields ?? []).length &&
      (plan.taskFields ?? []).every((row) => keys.has(row.templateKey)) &&
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
  const data = snapshot.parse(episodeTaskPlan.parse(plan));
  return receipt.parse(await api.post(path(crewId, episodeId), { service: "aurora", data }));
}
