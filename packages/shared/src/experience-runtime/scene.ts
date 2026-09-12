import { z } from "zod";
import { ExperienceAccessRequirementSchema } from "./access.js";
import {
  ExperienceLocalizedTextSchema,
  ExperienceRuntimeUriSchema,
  ExperienceStableIdSchema,
} from "./common.js";
import { ExperienceEventBindingSchema } from "./logic.js";
import { ExperienceRendererInstanceSchema } from "./renderer.js";
import { ExperienceGestureSchema, ExperienceSpatialAnchorSchema } from "./spatial.js";

export const ExperienceSceneClockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("fixed"), durationMs: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("renderer"),
      rendererInstanceId: ExperienceStableIdSchema,
    })
    .strict(),
]);

export const ExperienceTimelineCueSchema = z
  .object({
    cueId: ExperienceStableIdSchema,
    atMs: z.number().int().nonnegative(),
    once: z.boolean().default(true),
  })
  .strict();

export const ExperienceTimelineSchema = z
  .object({
    cues: z.array(ExperienceTimelineCueSchema).default([]),
  })
  .strict()
  .superRefine((timeline, context) => {
    const cueIds = new Set<string>();
    let previousAtMs = -1;
    timeline.cues.forEach((cue, index) => {
      if (cueIds.has(cue.cueId)) {
        context.addIssue({
          code: "custom",
          path: ["cues", index, "cueId"],
          message: `Duplicate timeline cue ${cue.cueId}`,
        });
      }
      cueIds.add(cue.cueId);
      if (cue.atMs < previousAtMs) {
        context.addIssue({
          code: "custom",
          path: ["cues", index, "atMs"],
          message: "Timeline cues must be ordered by time",
        });
      }
      previousAtMs = cue.atMs;
    });
  });

/**
 * The music bed a scene asks for on entry.
 *
 * A PLAIN MEDIA REFERENCE, not a frozen build asset: `url` is the track's
 * ordinary public media URL, so it is not listed in `assets` and nothing in the
 * integrity graph points at it. That is deliberate — losing a video breaks the
 * story, losing a bed only means silence, so music must never be able to fail a
 * build or a publish. A URL that stops resolving degrades to silence in the
 * player.
 *
 * `trackId` identifies the track (one file bound to five scenes is one id), so
 * the runtime crossfades only when the bed actually changes and a theme carries
 * across the scenes that share it. Optional because a scene that names no track
 * changes nothing — silence is not a binding.
 */
export const ExperienceSceneMusicSchema = z
  .object({ trackId: ExperienceStableIdSchema, url: ExperienceRuntimeUriSchema })
  .strict();

export const ExperienceSceneSchema = z
  .object({
    kind: z.literal("scene"),
    sceneId: ExperienceStableIdSchema,
    access: ExperienceAccessRequirementSchema.optional(),
    music: ExperienceSceneMusicSchema.optional(),
    clock: ExperienceSceneClockSchema.default({ kind: "none" }),
    renderers: z.array(ExperienceRendererInstanceSchema).default([]),
    anchors: z.array(ExperienceSpatialAnchorSchema).default([]),
    gestures: z.array(ExperienceGestureSchema).default([]),
    timeline: ExperienceTimelineSchema.default({ cues: [] }),
    eventBindings: z.array(ExperienceEventBindingSchema).default([]),
  })
  .strict();

export const ExperienceRouterSchema = z
  .object({
    kind: z.literal("router"),
    sceneId: ExperienceStableIdSchema,
    access: ExperienceAccessRequirementSchema.optional(),
    eventBindings: z.array(ExperienceEventBindingSchema).min(1),
  })
  .strict();

export const ExperienceGraphNodeSchema = z.discriminatedUnion("kind", [
  ExperienceSceneSchema,
  ExperienceRouterSchema,
]);

export const ExperienceGraphSchema = z
  .object({
    entrySceneId: ExperienceStableIdSchema,
    nodes: z.array(ExperienceGraphNodeSchema).min(1),
  })
  .strict();

export const ExperienceEndingSchema = z
  .object({
    endingId: ExperienceStableIdSchema,
    title: ExperienceLocalizedTextSchema,
    summary: ExperienceLocalizedTextSchema.optional(),
    kind: z.enum(["success", "failure", "neutral", "hidden", "custom"]),
  })
  .strict();

export type ExperienceSceneMusic = z.infer<typeof ExperienceSceneMusicSchema>;
export type ExperienceScene = z.infer<typeof ExperienceSceneSchema>;
export type ExperienceRouter = z.infer<typeof ExperienceRouterSchema>;
export type ExperienceGraphNode = z.infer<typeof ExperienceGraphNodeSchema>;
export type ExperienceGraph = z.infer<typeof ExperienceGraphSchema>;
