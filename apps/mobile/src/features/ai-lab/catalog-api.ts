import type { AiObjectSchema } from "@repo/shared";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { generationSession } from "./jobs-api";
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function isSchema(v: unknown, depth = 0): boolean {
  if (!object(v) || depth > 20) return false;
  if (v.type === "object")
    return object(v.properties) && Object.values(v.properties).every((x) => isSchema(x, depth + 1));
  if (v.type === "array") return isSchema(v.items, depth + 1);
  return ["string", "number", "integer", "boolean"].includes(String(v.type));
}
const model = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum(["image", "video", "audio"]),
    generationModes: z.array(z.string().min(1)).optional(),
    enabled: z.boolean(),
    disabledReason: z.string().optional(),
    schemaVersion: z.string().min(1),
    input_schema: z.custom<AiObjectSchema>((v) => object(v) && v.type === "object" && isSchema(v)),
    access: z
      .object({
        allowed: z.boolean(),
        reason: z.string().optional(),
        requiredPlan: z.string().nullish(),
      })
      .optional(),
    entitlement: z.object({ requiredPlan: z.string().nullable() }).optional(),
  })
  .passthrough();
const preset = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    description: z.string().optional(),
    type: z.enum(["image", "video", "audio"]),
    modelIds: z.array(z.string()),
    enabled: z.boolean(),
    disabledReason: z.string().optional(),
    requiredPlan: z.string().nullish(),
    campaignId: z.string().optional(),
    billingPolicy: z
      .object({
        mode: z.enum(["free", "charge", "estimate_then_finalize"]),
        preflightCost: z.number().nonnegative().optional(),
        displayCurrency: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const catalog = z
  .object({
    version: z.string(),
    region: z.string(),
    models: z.array(model),
    presets: z.array(preset),
  })
  .passthrough();
export type GenerationCatalog = z.infer<typeof catalog>;
export type GenerationModel = z.infer<typeof model>;
export type GenerationPreset = z.infer<typeof preset>;
export function planRank(plan: string | null | undefined): number {
  if (!plan) return 0;
  return (
    ({ free: 0, basic: 10, standard: 20, pro: 30, team: 40 } as Record<string, number>)[
      plan.trim().toLowerCase()
    ] ?? Infinity
  );
}
export async function loadGenerationCatalog(
  generation: number,
  signal: AbortSignal,
  workspaceId?: string
) {
  generationSession(generation, signal);
  const headers = workspaceId
    ? { "x-fizz-workspace-id": z.string().uuid().parse(workspaceId) }
    : undefined;
  // No process cache: access and available providers vary by account and site.
  const [raw, entitlement] = await Promise.all([
    api.get("/ai/models", { service: "aurora", signal, retry: false, headers }),
    api.get("/billing/entitlement/me", { service: "aurora", signal, retry: false, headers }),
  ]);
  generationSession(generation, signal);
  const value = catalog.parse(raw);
  const rank = z
    .object({ entitlement: z.object({ rank: z.number().nonnegative() }) })
    .parse(entitlement).entitlement.rank;
  return {
    catalog: value,
    rank,
  };
}
export function canUseGeneration(model: GenerationModel, preset: GenerationPreset, rank: number) {
  return (
    model.enabled &&
    preset.enabled &&
    preset.modelIds.includes(model.id) &&
    model.type === preset.type &&
    model.access?.allowed !== false &&
    planRank(preset.requiredPlan) <= rank &&
    planRank(model.access?.requiredPlan ?? model.entitlement?.requiredPlan) <= rank
  );
}

/** Read catalog constraints for existing canvas wires; no billing/preflight request. */
export async function loadCanvasReferenceCatalog(generation: number, signal: AbortSignal) {
  generationSession(generation, signal);
  const raw = await api.get("/ai/models", { service: "aurora", signal, retry: false });
  generationSession(generation, signal);
  return catalog.parse(raw);
}
