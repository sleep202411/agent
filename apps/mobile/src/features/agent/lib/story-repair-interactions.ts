import { z } from "zod";
import {
  StoryStateEffectsSchema,
  StoryRouteTargetSchema,
  storyEffectTypeError,
  type StoryStateEffect,
  type StoryRouteTarget,
} from "@repo/shared/story-stats";
import { repairTargets, sameRepairTarget, type RepairContent } from "./story-repair-fields";
import { repairVariables } from "./story-repair-conditions";
const effects = z.custom<StoryStateEffect[]>((v) => StoryStateEffectsSchema.safeParse(v).success);
const target = z.custom<StoryRouteTarget>((v) => StoryRouteTargetSchema.safeParse(v).success);
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue"), effects: effects.optional() }).strict(),
  z.object({ kind: z.literal("pause"), effects: effects.optional() }).strict(),
  z
    .object({
      kind: z.literal("seek"),
      timeMs: z.number().int().nonnegative(),
      effects: effects.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("goto"), target, effects: effects.optional() }).strict(),
]);
export const repairInteractionSchema = z
  .object({
    kind: z.literal("hotspot"),
    interactionId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/),
    label: z.record(z.string().min(2).max(16), z.string().max(4000)),
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("tap") }).strict(),
      z
        .object({ kind: z.literal("swipe"), direction: z.enum(["up", "down", "left", "right"]) })
        .strict(),
      z
        .object({
          kind: z.literal("press-hold"),
          durationMs: z.number().int().min(300).max(10000),
          controlTimeline: z.boolean().default(false),
        })
        .strict(),
    ]),
    rect: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .strict()
      .refine(
        (r) => r.x + r.width <= 1 && r.y + r.height <= 1,
        "The hotspot must remain inside the frame."
      ),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    branchAtMs: z.number().int().positive().optional(),
    timing: z.enum(["window", "hold"]).default("window"),
    outcomes: z
      .object({ success: action, failure: action.optional(), timeout: action.optional() })
      .strict(),
  })
  .strict()
  .refine((v) => v.endMs > v.startMs, "The interaction must end after it starts.")
  .refine(
    (v) => v.branchAtMs === undefined || v.branchAtMs >= v.endMs,
    "The branch frame must not precede the end of the input window."
  );
export const repairInteractionsSchema = z
  .array(repairInteractionSchema)
  .max(100)
  .refine(
    (v) => new Set(v.map((r) => r.interactionId)).size === v.length,
    "Interaction IDs must be unique."
  );
export type RepairInteraction = z.infer<typeof repairInteractionSchema>;
export function readRepairInteractions(
  content: RepairContent,
  nodeId: string
): RepairInteraction[] {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  if (!node || node.kind !== "clip") throw Error("The selected scene is no longer available.");
  return repairInteractionsSchema.parse(node.interactions);
}
export function replaceRepairInteractions(
  content: RepairContent,
  nodeId: string,
  expected: unknown,
  value: unknown
): RepairContent {
  if (JSON.stringify(readRepairInteractions(content, nodeId)) !== JSON.stringify(expected))
    throw Error("Interactions changed. Reopen the editor before applying changes.");
  const next = repairInteractionsSchema.parse(value);
  const otherIds = new Set(
    content.graph.nodes
      .filter((n) => n.nodeId !== nodeId && n.kind === "clip")
      .flatMap((n) => readRepairInteractions(content, n.nodeId).map((i) => i.interactionId))
  );
  if (next.some((i) => otherIds.has(i.interactionId)))
    throw Error("This interaction ID is already used by another scene.");
  const targets = repairTargets(content, "en-US"),
    variables = new Map(repairVariables(content, "en-US").map((v) => [v.key, v]));
  for (const item of next)
    for (const outcome of Object.values(item.outcomes)) {
      if (!outcome) continue;
      if (
        outcome.kind === "goto" &&
        !targets.some((t) => sameRepairTarget(t.value, outcome.target))
      )
        throw Error("The interaction destination is no longer available.");
      for (const effect of outcome.effects ?? []) {
        const error = storyEffectTypeError(effect, variables);
        if (error) throw Error(error);
      }
    }
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((n) =>
        n.nodeId === nodeId ? { ...n, interactions: next } : n
      ),
    },
  };
}
export function newRepairInteraction(
  identity: string,
  locale: string,
  defaultLocale: string
): RepairInteraction {
  return repairInteractionSchema.parse({
    kind: "hotspot",
    interactionId: `hotspot:${identity}`,
    label: { [defaultLocale]: "", [locale]: "" },
    trigger: { kind: "tap" },
    rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    startMs: 0,
    endMs: 1000,
    timing: "window",
    outcomes: { success: { kind: "continue" } },
  });
}
/** Numeric text is kept intact in device drafts until explicit Apply. */
export function compileRepairInteractions(value: unknown): RepairInteraction[] {
  const number = (v: unknown): number => {
    if (typeof v !== "number" && (typeof v !== "string" || !v.trim()))
      throw Error("Enter a valid number.");
    const n = Number(v);
    if (!Number.isFinite(n)) throw Error("Enter a valid number.");
    return n;
  };
  const rows = z.array(z.record(z.unknown())).parse(value);
  return repairInteractionsSchema.parse(
    rows.map((r) => {
      const rect = z.record(z.unknown()).parse(r.rect),
        trigger = z.record(z.unknown()).parse(r.trigger),
        outcomes = z.record(z.unknown()).parse(r.outcomes);
      return {
        ...r,
        rect: Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, number(v)])),
        startMs: number(r.startMs),
        endMs: number(r.endMs),
        ...(r.branchAtMs === ""
          ? { branchAtMs: undefined }
          : r.branchAtMs !== undefined
            ? { branchAtMs: number(r.branchAtMs) }
            : {}),
        trigger: {
          ...trigger,
          ...(trigger.kind === "press-hold" ? { durationMs: number(trigger.durationMs) } : {}),
        },
        outcomes: Object.fromEntries(
          Object.entries(outcomes).map(([k, v]) => {
            const a = z.record(z.unknown()).parse(v);
            return [k, { ...a, ...(a.kind === "seek" ? { timeMs: number(a.timeMs) } : {}) }];
          })
        ),
      };
    })
  );
}
