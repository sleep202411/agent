import { z } from "zod";
import {
  ExperienceEventTypeSchema,
  ExperienceStableIdSchema,
  ExperienceStatePathSchema,
  ExperienceValueExpressionSchema,
} from "./common.js";
import { ExperienceConditionSchema } from "./state.js";

const ResolvedPayloadSchema = z.record(z.string(), ExperienceValueExpressionSchema);

export const ExperienceRuntimeActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("state.set"),
      path: ExperienceStatePathSchema,
      value: ExperienceValueExpressionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("state.increment"),
      path: ExperienceStatePathSchema,
      amount: ExperienceValueExpressionSchema,
    })
    .strict(),
  z.object({ kind: z.literal("scene.goto"), sceneId: ExperienceStableIdSchema }).strict(),
  z.object({ kind: z.literal("ending.complete"), endingId: ExperienceStableIdSchema }).strict(),
  z
    .object({
      kind: z.literal("renderer.command"),
      instanceId: ExperienceStableIdSchema,
      commandType: ExperienceStableIdSchema,
      payload: ResolvedPayloadSchema.default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio.play"),
      cueId: ExperienceStableIdSchema,
      playbackId: ExperienceStableIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio.stop"),
      target: z.enum(["cue", "playback"]),
      targetId: ExperienceStableIdSchema,
      fadeOutMs: z.number().int().nonnegative().max(60_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio.fade-bus"),
      busId: ExperienceStableIdSchema,
      gain: z.number().min(0).max(4),
      durationMs: z.number().int().nonnegative().max(60_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio.apply-snapshot"),
      snapshotId: ExperienceStableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("event.emit"),
      eventType: ExperienceEventTypeSchema,
      sourceId: ExperienceStableIdSchema.optional(),
      qualifierId: ExperienceStableIdSchema.optional(),
      payload: ResolvedPayloadSchema.default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal("telemetry.emit"),
      eventName: ExperienceEventTypeSchema,
      payload: ResolvedPayloadSchema.default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal("progress.mark-asset-watched"),
      assetId: ExperienceStableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("progress.unlock-ending"),
      endingId: ExperienceStableIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("session.checkpoint"),
      checkpointId: ExperienceStableIdSchema,
    })
    .strict(),
]);
export type ExperienceRuntimeAction = z.infer<typeof ExperienceRuntimeActionSchema>;

export const ExperienceEventSelectorSchema = z
  .object({
    type: ExperienceEventTypeSchema,
    sourceId: ExperienceStableIdSchema.optional(),
    qualifierId: ExperienceStableIdSchema.optional(),
  })
  .strict();

export const ExperienceEventRouteSchema = z
  .object({
    routeId: ExperienceStableIdSchema,
    when: ExperienceConditionSchema.optional(),
    actions: z.array(ExperienceRuntimeActionSchema).min(1),
  })
  .strict()
  .superRefine((route, context) => {
    const navigationCount = route.actions.filter(
      (action) => action.kind === "scene.goto" || action.kind === "ending.complete"
    ).length;
    if (navigationCount > 1) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "An event route may commit at most one navigation action",
      });
    }
    const navigationIndex = route.actions.findIndex(
      (action) => action.kind === "scene.goto" || action.kind === "ending.complete"
    );
    if (navigationIndex >= 0 && navigationIndex !== route.actions.length - 1) {
      context.addIssue({
        code: "custom",
        path: ["actions", navigationIndex],
        message: "Navigation must be the final action in an event route",
      });
    }
  });

export const ExperienceEventBindingSchema = z
  .object({
    bindingId: ExperienceStableIdSchema,
    on: ExperienceEventSelectorSchema,
    routes: z.array(ExperienceEventRouteSchema).min(1),
  })
  .strict()
  .superRefine((binding, context) => {
    const fallbackIndexes = binding.routes.flatMap((route, index) => (route.when ? [] : [index]));
    if (fallbackIndexes.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: "An event binding may define at most one unconditional fallback route",
      });
    }
    if (fallbackIndexes.length === 1 && fallbackIndexes[0] !== binding.routes.length - 1) {
      context.addIssue({
        code: "custom",
        path: ["routes", fallbackIndexes[0] ?? 0],
        message: "An unconditional fallback route must be last",
      });
    }
  });

export type ExperienceEventBinding = z.infer<typeof ExperienceEventBindingSchema>;
