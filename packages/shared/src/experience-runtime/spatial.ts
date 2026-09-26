import { z } from "zod";
import {
  ExperienceLocalizedTextSchema,
  ExperienceNormalizedPointSchema,
  ExperienceNormalizedRectSchema,
  ExperienceStableIdSchema,
} from "./common.js";
import { ExperienceConditionSchema } from "./state.js";

export const ExperienceSpatialGeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), rect: ExperienceNormalizedRectSchema }).strict(),
  z.object({ kind: z.literal("ellipse"), bounds: ExperienceNormalizedRectSchema }).strict(),
  z
    .object({
      kind: z.literal("polygon"),
      points: z.array(ExperienceNormalizedPointSchema).min(3).max(64),
    })
    .strict(),
]);
export type ExperienceSpatialGeometry = z.infer<typeof ExperienceSpatialGeometrySchema>;

export const ExperienceResponsiveGeometrySchema = z
  .object({
    default: ExperienceSpatialGeometrySchema.optional(),
    landscape: ExperienceSpatialGeometrySchema.optional(),
    portrait: ExperienceSpatialGeometrySchema.optional(),
    square: ExperienceSpatialGeometrySchema.optional(),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (geometry.default || (geometry.landscape && geometry.portrait && geometry.square)) return;
    context.addIssue({
      code: "custom",
      message: "Spatial geometry needs a default or landscape, portrait, and square variants",
    });
  });
export type ExperienceResponsiveGeometry = z.infer<typeof ExperienceResponsiveGeometrySchema>;

export const ExperienceCoordinateSpaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("viewport") }).strict(),
  z
    .object({
      kind: z.literal("renderer-content"),
      rendererInstanceId: ExperienceStableIdSchema,
    })
    .strict(),
]);

const SpatialKeyframeSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    geometry: ExperienceResponsiveGeometrySchema,
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out", "step"]).default("linear"),
  })
  .strict();

const SpatialMotionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed") }).strict(),
  z
    .object({ kind: z.literal("keyframes"), keyframes: z.array(SpatialKeyframeSchema).min(2) })
    .strict()
    .superRefine((motion, context) => {
      let previous = -1;
      motion.keyframes.forEach((keyframe, index) => {
        if (keyframe.atMs <= previous) {
          context.addIssue({
            code: "custom",
            path: ["keyframes", index, "atMs"],
            message: "Spatial keyframes must be strictly ordered",
          });
        }
        previous = keyframe.atMs;
      });
    }),
  z
    .object({
      kind: z.literal("tracked"),
      trackingAssetId: ExperienceStableIdSchema,
      trackId: ExperienceStableIdSchema,
    })
    .strict(),
]);

export const ExperienceSpatialAnchorSchema = z
  .object({
    anchorId: ExperienceStableIdSchema,
    space: ExperienceCoordinateSpaceSchema,
    geometry: ExperienceResponsiveGeometrySchema,
    motion: SpatialMotionSchema.default({ kind: "fixed" }),
  })
  .strict();
export type ExperienceSpatialAnchor = z.infer<typeof ExperienceSpatialAnchorSchema>;

export const ExperienceInputActionDefinitionSchema = z
  .object({
    actionId: ExperienceStableIdSchema,
    label: ExperienceLocalizedTextSchema,
    required: z.boolean().default(true),
    accessibilityDescription: ExperienceLocalizedTextSchema.optional(),
  })
  .strict();

const InteractionWindowSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .strict()
  .superRefine((window, context) => {
    if (window.endMs <= window.startMs) {
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "Interaction windows must end after they start",
      });
    }
  });

const GestureCommonShape = {
  gestureId: ExperienceStableIdSchema,
  anchorId: ExperienceStableIdSchema,
  inputActionId: ExperienceStableIdSchema,
  enabledWhen: ExperienceConditionSchema.optional(),
  activeWindow: InteractionWindowSchema.optional(),
  /**
   * Safe branch frame: once this gesture resolves, the scene keeps playing
   * until scene time reaches this timestamp before any bound route fires.
   * Hosts fall back to the active window end when omitted, preserving the
   * legacy cut-on-resolution behavior.
   */
  branchAtMs: z.number().int().positive().optional(),
  /**
   * Pause the scene when the window ends and keep the gesture available
   * until it resolves. The media clock stops on the hotspot's last frame, so
   * the window end is not a timeout. Hosts route the outcome immediately
   * instead of waiting for a later branch frame.
   */
  holdFrame: z.boolean().optional(),
  feedbackRendererInstanceId: ExperienceStableIdSchema.optional(),
  accessibleAlternativeActionId: ExperienceStableIdSchema.optional(),
};

const TapGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.literal("tap"),
    maxDurationMs: z.number().int().min(100).max(2_000).default(500),
  })
  .strict();

const PressHoldGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.literal("press-hold"),
    durationMs: z.number().int().min(100).max(60_000),
    releaseBehavior: z.enum(["reset", "retain", "decay"]),
    decayPerSecond: z.number().positive().max(10).optional(),
    cancelOnPointerExit: z.boolean().default(true),
    /**
     * Timeline-control charge: hosts pause the scene media while the active
     * window is open and unresolved, and only advance playback while the
     * pointer is held. Charge progress then equals media playback position,
     * and release-time judging reads the scene clock instead of wall time.
     */
    timelineControl: z.boolean().default(false),
  })
  .strict()
  .superRefine((gesture, context) => {
    if (gesture.releaseBehavior === "decay" && gesture.decayPerSecond === undefined) {
      context.addIssue({
        code: "custom",
        path: ["decayPerSecond"],
        message: "Decay gestures require decayPerSecond",
      });
    }
    if (gesture.releaseBehavior !== "decay" && gesture.decayPerSecond !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["decayPerSecond"],
        message: "decayPerSecond is only valid for decay gestures",
      });
    }
    if (gesture.timelineControl && gesture.releaseBehavior !== "reset") {
      context.addIssue({
        code: "custom",
        path: ["releaseBehavior"],
        message: "Timeline-control gestures must reset on release",
      });
    }
  });

const RapidTapGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.literal("rapid-tap"),
    requiredCount: z.number().int().min(2).max(100),
    withinMs: z.number().int().min(250).max(60_000),
    missBehavior: z.enum(["reset", "decay"]).default("decay"),
  })
  .strict();

const SwipeGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.literal("swipe"),
    directions: z.array(z.enum(["up", "down", "left", "right"])).min(1),
    minimumDistance: z.number().positive().max(1),
    maximumDurationMs: z.number().int().min(100).max(5_000),
  })
  .strict();

const DragGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.literal("drag"),
    targetAnchorIds: z.array(ExperienceStableIdSchema).min(1),
    snapOnComplete: z.boolean().default(true),
  })
  .strict();

const TransformGestureSchema = z
  .object({
    ...GestureCommonShape,
    kind: z.enum(["pan", "pinch", "rotate"]),
    completionThreshold: z.number().positive(),
  })
  .strict();

export const ExperienceGestureSchema = z.union([
  TapGestureSchema,
  PressHoldGestureSchema,
  RapidTapGestureSchema,
  SwipeGestureSchema,
  DragGestureSchema,
  TransformGestureSchema,
]);
export type ExperienceGesture = z.infer<typeof ExperienceGestureSchema>;

export const EXPERIENCE_GESTURE_CAPABILITY = {
  tap: "input.tap",
  "press-hold": "input.press-hold",
  "rapid-tap": "input.rapid-tap",
  swipe: "input.swipe",
  drag: "input.drag",
  pan: "input.pan",
  pinch: "input.pinch",
  rotate: "input.rotate",
} as const satisfies Record<ExperienceGesture["kind"], string>;
