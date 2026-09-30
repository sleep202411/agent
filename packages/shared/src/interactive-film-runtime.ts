import { z } from "zod";
import {
  StoryAutoRoutesSchema,
  StoryConditionSchema,
  StoryEndingKindSchema,
  StoryRouteTargetSchema,
  StoryStateEffectsSchema,
  StoryStateKeySchema,
  StoryStateValueTypeSchema,
  migrateStoryReleaseStats,
  storyRouteNodeId,
} from "./story-stats.js";

export const INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION = 2 as const;

const stableId = z.string().trim().min(1).max(120);
const localizedText = z.record(z.string().trim().min(2), z.string().trim().min(1));
const positiveInteger = z.number().int().positive();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Media hashes must be lowercase SHA-256");

const FramesPerSecondSchema = z
  .object({ numerator: positiveInteger, denominator: positiveInteger })
  .strict();

const RuntimeUriSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    if (value.startsWith("/") || value.startsWith("https://")) return;
    context.addIssue({
      code: "custom",
      message: "Runtime media URI must be root-relative or a permanent HTTPS URL",
    });
  });

/**
 * Whether a URL can be carried by a release as a PLAIN MEDIA REFERENCE (a music
 * bed, a cover) rather than a frozen build asset.
 *
 * Plain references are resolved from live storage config, so they can come back
 * in a shape this schema rejects — most often `http://` from an `external_url`
 * asset. Such a reference must be dropped by its resolver, because reaching the
 * release parse instead would fail a whole Build over decoration. Exported from
 * beside the schema so the resolvers cannot drift from what they are gating for.
 */
export function isRuntimeMediaUri(value: string): boolean {
  return RuntimeUriSchema.safeParse(value).success;
}

const VisualVariantSchema = z
  .object({
    sourceAssetId: stableId,
    sha256,
    src: RuntimeUriSchema,
    width: positiveInteger,
    height: positiveInteger,
  })
  .strict();

const VideoVariantSchema = VisualVariantSchema.extend({
  sha256: sha256.optional(),
  width: positiveInteger.optional(),
  height: positiveInteger.optional(),
  durationSeconds: z.number().positive().optional(),
  framesPerSecond: FramesPerSecondSchema.optional(),
  codec: z.enum(["h264", "h265", "av1"]).optional(),
}).strict();

const OrientationPolicySchema = z.enum(["paired-required", "single-master"]);

function validateOrientationPolicy(
  asset: {
    orientationPolicy: "paired-required" | "single-master";
    variants: { landscape?: unknown; portrait?: unknown };
  },
  context: z.RefinementCtx
): void {
  const count =
    Number(Boolean(asset.variants.landscape)) + Number(Boolean(asset.variants.portrait));
  if (asset.orientationPolicy === "paired-required" && count !== 2) {
    context.addIssue({
      code: "custom",
      path: ["variants"],
      message: "paired-required media must provide independent landscape and portrait variants",
    });
  }
  if (asset.orientationPolicy === "single-master" && count !== 1) {
    context.addIssue({
      code: "custom",
      path: ["variants"],
      message: "single-master media must provide exactly one authored variant",
    });
  }
}

const RuntimeVideoAssetSchema = z
  .object({
    assetId: stableId,
    kind: z.literal("video"),
    orientationPolicy: OrientationPolicySchema,
    variants: z
      .object({
        landscape: VideoVariantSchema.optional(),
        portrait: VideoVariantSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateOrientationPolicy);

const RuntimeImageAssetSchema = z
  .object({
    assetId: stableId,
    kind: z.literal("image"),
    orientationPolicy: OrientationPolicySchema,
    variants: z
      .object({
        landscape: VisualVariantSchema.optional(),
        portrait: VisualVariantSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateOrientationPolicy);

const RuntimeDataAssetSchema = z
  .object({
    assetId: stableId,
    kind: z.literal("data"),
    sourceAssetId: stableId,
    sha256,
    src: RuntimeUriSchema,
    format: z.enum(["json", "vtt", "svg"]),
  })
  .strict();

export const RuntimeMediaAssetSchema = z.discriminatedUnion("kind", [
  RuntimeVideoAssetSchema,
  RuntimeImageAssetSchema,
  RuntimeDataAssetSchema,
]);
export type RuntimeMediaAsset = z.infer<typeof RuntimeMediaAssetSchema>;
export type RuntimeVideoAsset = z.infer<typeof RuntimeVideoAssetSchema>;
export type RuntimeImageAsset = z.infer<typeof RuntimeImageAssetSchema>;
export type RuntimeDataAsset = z.infer<typeof RuntimeDataAssetSchema>;
export type RuntimeVisualVariant = z.infer<typeof VisualVariantSchema>;

const SafeAreaSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine((area, context) => {
    if (area.x + area.width > 1 || area.y + area.height > 1) {
      context.addIssue({
        code: "custom",
        message: "Overlay safe area must remain inside the frame",
      });
    }
  });

const OverlayBaseSchema = z
  .object({
    overlayId: stableId,
    landscapeSafeArea: SafeAreaSchema,
    portraitSafeArea: SafeAreaSchema,
  })
  .strict();

const OverlaySchema = z.discriminatedUnion("kind", [
  OverlayBaseSchema.extend({
    kind: z.literal("bound-text"),
    binding: z
      .string()
      .trim()
      .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/),
  }).strict(),
  OverlayBaseSchema.extend({ kind: z.literal("subtitle"), assetId: stableId }).strict(),
  OverlayBaseSchema.extend({ kind: z.literal("seal"), assetId: stableId }).strict(),
  OverlayBaseSchema.extend({ kind: z.literal("interaction") }).strict(),
]);

const ChoiceSchema = z
  .object({
    choiceId: stableId,
    label: localizedText,
    effects: StoryStateEffectsSchema.optional(),
    visibleWhen: StoryConditionSchema.optional(),
    target: StoryRouteTargetSchema,
  })
  .strict();

const RuntimeInteractionActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("continue"),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pause"),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("seek"),
      timeMs: z.number().int().nonnegative(),
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goto"),
      target: StoryRouteTargetSchema,
      effects: StoryStateEffectsSchema.optional(),
    })
    .strict(),
]);

const RuntimeInteractionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap") }).strict(),
  z
    .object({
      kind: z.literal("swipe"),
      direction: z.enum(["up", "down", "left", "right"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("press-hold"),
      durationMs: z.number().int().min(300).max(10_000),
      /**
       * Timeline-control charge: the clip pauses when the input window opens
       * and only advances while the pointer is held, so media playback
       * position is the charge progress. Defaults keep legacy wall-clock
       * judging with a freely playing video.
       */
      controlTimeline: z.boolean().default(false),
    })
    .strict(),
]);

const RuntimeInteractionOutcomesSchema = z
  .object({
    success: RuntimeInteractionActionSchema,
    failure: RuntimeInteractionActionSchema.optional(),
    timeout: RuntimeInteractionActionSchema.optional(),
  })
  .strict();

const RuntimeHotspotInteractionSchema = z
  .object({
    kind: z.literal("hotspot"),
    interactionId: stableId,
    label: localizedText,
    trigger: RuntimeInteractionTriggerSchema,
    rect: SafeAreaSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    /**
     * Safe branch frame: a resolved interaction keeps playing the current
     * clip until this timestamp before the branch cut lands. Defaults to the
     * input window end when omitted.
     */
    branchAtMs: z.number().int().positive().optional(),
    /** `window` keeps playing through the range. `hold` pauses at the start until the gesture resolves. */
    timing: z.enum(["window", "hold"]).default("window"),
    outcomes: RuntimeInteractionOutcomesSchema,
  })
  .strict()
  .superRefine((interaction, context) => {
    if (interaction.endMs > interaction.startMs) return;
    context.addIssue({
      code: "custom",
      path: ["endMs"],
      message: "Interaction end must be after its start",
    });
  })
  .superRefine((interaction, context) => {
    if (interaction.branchAtMs === undefined) return;
    if (interaction.branchAtMs >= interaction.endMs) return;
    context.addIssue({
      code: "custom",
      path: ["branchAtMs"],
      message: "Branch frame must not land before the input window closes",
    });
  });

export const RuntimeAutoExitSchema = z
  .object({
    kind: z.literal("auto"),
    /** A null fallback target marks a clip that naturally completes playback. */
    routes: StoryAutoRoutesSchema,
  })
  .strict();

export const RuntimeChoiceExitSchema = z
  .object({
    kind: z.literal("choice"),
    decisionId: stableId,
    prompt: localizedText.optional(),
    choices: z.array(ChoiceSchema).min(1).max(6),
  })
  .strict();

const VideoSequenceEndBehaviorSchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("advance") }).strict(),
  z
    .object({
      behavior: z.literal("hold-last-frame"),
      // Still-image clips hold for their full storyboard length, so the cap
      // covers a long held shot, not just a brief end-frame beat. Must stay in
      // step with the renderer schema in experience-runtime/core-renderers.
      durationMs: z.number().int().min(100).max(120_000).optional(),
    })
    .strict(),
  z
    .object({
      behavior: z.literal("loop-tail"),
      tailSeconds: z.number().min(0.5).max(3),
    })
    .strict(),
  z.object({ behavior: z.literal("loop"), assetId: stableId }).strict(),
]);

const VideoSequenceClipSchema = z
  .object({
    clipId: stableId,
    assetId: stableId,
    posterAssetId: stableId.optional(),
    endBehavior: VideoSequenceEndBehaviorSchema,
  })
  .strict();

const VideoPresentationSchema = z
  .object({
    kind: z.literal("video"),
    // Empty means "this shot has no footage yet". Only a preview Build emits
    // one; the release path still raises STORY_BUILD_CURRENT_VIDEO_REQUIRED as
    // an error, so an empty sequence cannot reach a published experience.
    sequence: z.array(VideoSequenceClipSchema),
    posterAssetId: stableId.optional(),
    fit: z.enum(["cover", "contain"]),
  })
  .strict()
  .superRefine((presentation, context) => {
    const clipIds = new Set<string>();
    presentation.sequence.forEach((clip, index) => {
      if (clipIds.has(clip.clipId)) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "clipId"],
          message: `Duplicate sequence clip id ${clip.clipId}`,
        });
      }
      clipIds.add(clip.clipId);
      const isLast = index === presentation.sequence.length - 1;
      const behavior = clip.endBehavior;
      if (!isLast && behavior.behavior === "hold-last-frame" && !behavior.durationMs) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "endBehavior"],
          message: "Only the final clip may hold its last frame indefinitely",
        });
      }
      if (!isLast && (behavior.behavior === "loop" || behavior.behavior === "loop-tail")) {
        context.addIssue({
          code: "custom",
          path: ["sequence", index, "endBehavior"],
          message: "Only the final clip may enter an indefinite wait loop",
        });
      }
    });
  });

const ImagePresentationSchema = z
  .object({
    kind: z.literal("image"),
    assetId: stableId,
    fit: z.enum(["cover", "contain"]),
  })
  .strict();

const WorldPresentationSchema = z
  .object({
    kind: z.literal("world"),
    worldId: stableId,
    entryInstruction: z.string().trim().min(1).max(4_000).optional(),
    maxExperienceSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]),
  })
  .strict();

const ExtensionPresentationSchema = z
  .object({
    kind: z.literal("extension"),
    rendererId: stableId,
    configAssetId: stableId,
    accessibleFallbackAssetId: stableId,
    narrativePurpose: z.string().trim().min(20),
  })
  .strict();

const RuntimeNodeExitSchema = z.discriminatedUnion("kind", [
  RuntimeAutoExitSchema,
  RuntimeChoiceExitSchema,
]);

const SceneNodeSchema = z
  .object({
    nodeId: stableId,
    communityPointPrice: z.number().int().nonnegative().max(2_147_483_647).optional(),
    title: localizedText.optional(),
    presentation: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("decision") }).strict(),
      VideoPresentationSchema,
      ImagePresentationSchema,
      WorldPresentationSchema,
      ExtensionPresentationSchema,
    ]),
    /**
     * The music bed this scene asks for on entry; absent means "unchanged".
     * A plain media reference — `url` is the track's ordinary public media URL
     * and it is deliberately NOT a `media` entry, because a bed that fails to
     * load is silence, never a broken release.
     */
    music: z.object({ trackId: stableId, url: RuntimeUriSchema }).strict().optional(),
    overlays: z.array(OverlaySchema).default([]),
    interactions: z.array(RuntimeHotspotInteractionSchema).max(100).default([]),
    onEnterEffects: StoryStateEffectsSchema.optional(),
    exit: RuntimeNodeExitSchema,
  })
  .strict();

export const InteractiveFilmRuntimeNodeSchema = SceneNodeSchema;

const RuntimeStateVariableSchema = z
  .object({
    key: StoryStateKeySchema,
    name: localizedText,
    valueType: StoryStateValueTypeSchema,
    initialValue: z.union([z.number().finite(), z.boolean()]),
  })
  .strict();

const RuntimeEndingSchema = z
  .object({
    endingId: stableId,
    title: localizedText,
    kind: StoryEndingKindSchema,
  })
  .strict();

const InteractiveFilmReleaseObjectSchema = z
  .object({
    schemaVersion: z.literal(INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION),
    channel: z.enum(["preview", "production"]),
    gameId: stableId,
    releaseId: stableId,
    contentVersion: stableId,
    entryNodeId: stableId,
    defaultLocale: stableId,
    locales: z.array(stableId).min(1),
    media: z.array(RuntimeMediaAssetSchema).default([]),
    stateVariables: z.array(RuntimeStateVariableSchema).default([]),
    endings: z.array(RuntimeEndingSchema).default([]),
    nodes: z.array(InteractiveFilmRuntimeNodeSchema).min(1),
  })
  .strict()
  .superRefine((release, context) => {
    const media = uniqueIndex(release.media, (asset) => asset.assetId, ["media"], context);
    const nodes = uniqueIndex(release.nodes, (node) => node.nodeId, ["nodes"], context);
    const endings = uniqueIndex(release.endings, (ending) => ending.endingId, ["endings"], context);
    uniqueIndex(release.stateVariables, (variable) => variable.key, ["stateVariables"], context);
    validateRuntimeDecisionDefinitions(release.nodes, context);

    if (!release.locales.includes(release.defaultLocale)) {
      context.addIssue({
        code: "custom",
        path: ["defaultLocale"],
        message: "defaultLocale must be included in locales",
      });
    }
    if (!nodes.has(release.entryNodeId)) {
      context.addIssue({
        code: "custom",
        path: ["entryNodeId"],
        message: `Unknown entry node ${release.entryNodeId}`,
      });
    }

    const requireAsset = (
      assetId: string,
      kinds: RuntimeMediaAsset["kind"][],
      path: PropertyKey[]
    ) => {
      const asset = media.get(assetId);
      if (!asset) {
        context.addIssue({ code: "custom", path, message: `Unknown media asset ${assetId}` });
        return;
      }
      if (!kinds.includes(asset.kind)) {
        context.addIssue({
          code: "custom",
          path,
          message: `Media ${assetId} must be ${kinds.join(" or ")}, received ${asset.kind}`,
        });
      }
    };

    const requireNode = (nodeId: string, path: PropertyKey[]) => {
      if (!nodes.has(nodeId)) {
        context.addIssue({ code: "custom", path, message: `Unknown target node ${nodeId}` });
      }
    };

    const requireTarget = (
      target: { kind: "node"; nodeId: string } | { kind: "ending"; endingId: string } | null,
      path: PropertyKey[]
    ) => {
      if (!target) return;
      if (target.kind === "node") requireNode(target.nodeId, path);
      else if (!endings.has(target.endingId)) {
        context.addIssue({
          code: "custom",
          path,
          message: `Unknown ending ${target.endingId}`,
        });
      }
    };

    const requireLocaleCoverage = (value: Record<string, string>, path: PropertyKey[]): void => {
      release.locales.forEach((locale) => {
        if (!value[locale]) {
          context.addIssue({
            code: "custom",
            path: [...path, locale],
            message: `Missing localized text for ${locale}`,
          });
        }
      });
    };
    release.stateVariables.forEach((variable, index) => {
      requireLocaleCoverage(variable.name, ["stateVariables", index, "name"]);
    });
    release.endings.forEach((ending, index) => {
      requireLocaleCoverage(ending.title, ["endings", index, "title"]);
    });

    release.nodes.forEach((node, nodeIndex) => {
      const presentationPath = ["nodes", nodeIndex, "presentation"];
      if ("presentation" in node) {
        if (node.presentation.kind === "video") {
          node.presentation.sequence.forEach((clip, clipIndex) => {
            const clipPath = [...presentationPath, "sequence", clipIndex];
            requireAsset(clip.assetId, ["video"], [...clipPath, "assetId"]);
            if (clip.posterAssetId) {
              requireAsset(clip.posterAssetId, ["image"], [...clipPath, "posterAssetId"]);
            }
            // A wait loop used to have to point at a provably silent asset.
            // Nothing inspects media for sound any more — what the creator
            // supplied is what plays — so only the reference is validated.
            if (clip.endBehavior.behavior === "loop") {
              requireAsset(
                clip.endBehavior.assetId,
                ["video"],
                [...clipPath, "endBehavior", "assetId"]
              );
            }
          });
          if (node.presentation.posterAssetId) {
            requireAsset(
              node.presentation.posterAssetId,
              ["image"],
              [...presentationPath, "posterAssetId"]
            );
          }
        } else if (node.presentation.kind === "image") {
          requireAsset(node.presentation.assetId, ["image"], [...presentationPath, "assetId"]);
        } else if (node.presentation.kind === "extension") {
          requireAsset(
            node.presentation.configAssetId,
            ["data"],
            [...presentationPath, "configAssetId"]
          );
          requireAsset(
            node.presentation.accessibleFallbackAssetId,
            ["image", "video"],
            [...presentationPath, "accessibleFallbackAssetId"]
          );
        }

        node.overlays.forEach((overlay, overlayIndex) => {
          const overlayPath = ["nodes", nodeIndex, "overlays", overlayIndex];
          if (overlay.kind === "seal") {
            requireAsset(overlay.assetId, ["image", "data"], [...overlayPath, "assetId"]);
            const asset = media.get(overlay.assetId);
            if (asset?.kind === "data" && asset.format !== "svg") {
              context.addIssue({
                code: "custom",
                path: [...overlayPath, "assetId"],
                message: `Seal overlay data ${overlay.assetId} must be SVG`,
              });
            }
          }
          if (overlay.kind === "subtitle") {
            requireAsset(overlay.assetId, ["data"], [...overlayPath, "assetId"]);
            const asset = media.get(overlay.assetId);
            if (asset?.kind === "data" && asset.format !== "vtt") {
              context.addIssue({
                code: "custom",
                path: [...overlayPath, "assetId"],
                message: `Subtitle overlay data ${overlay.assetId} must be VTT`,
              });
            }
          }
        });

        const interactionIds = new Set<string>();
        node.interactions.forEach((interaction, interactionIndex) => {
          const interactionPath = ["nodes", nodeIndex, "interactions", interactionIndex];
          if (interactionIds.has(interaction.interactionId)) {
            context.addIssue({
              code: "custom",
              path: [...interactionPath, "interactionId"],
              message: `Duplicate interaction id ${interaction.interactionId}`,
            });
          }
          interactionIds.add(interaction.interactionId);
          requireLocaleCoverage(interaction.label, [...interactionPath, "label"]);
          Object.entries(interaction.outcomes).forEach(([outcome, action]) => {
            if (action?.kind === "goto") {
              requireTarget(action.target, [...interactionPath, "outcomes", outcome, "target"]);
            }
          });
        });
      }

      const exitPath = ["nodes", nodeIndex, "exit"];
      if (node.exit.kind === "auto") {
        node.exit.routes.forEach((route, routeIndex) => {
          requireTarget(route.target, [...exitPath, "routes", routeIndex, "target"]);
        });
      }
      if (node.exit.kind === "choice") {
        if (node.exit.prompt) {
          requireLocaleCoverage(node.exit.prompt, [...exitPath, "prompt"]);
        }
        const choiceIds = new Set<string>();
        node.exit.choices.forEach((choice, choiceIndex) => {
          if (choiceIds.has(choice.choiceId)) {
            context.addIssue({
              code: "custom",
              path: [...exitPath, "choices", choiceIndex, "choiceId"],
              message: `Duplicate choice id ${choice.choiceId}`,
            });
          }
          choiceIds.add(choice.choiceId);
          requireLocaleCoverage(choice.label, [...exitPath, "choices", choiceIndex, "label"]);
          requireTarget(choice.target, [...exitPath, "choices", choiceIndex, "target"]);
        });
      }
    });

    const reachable = new Set<string>();
    const pending = [release.entryNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      const node = nodes.get(nodeId);
      if (!node) continue;
      const nextNodeIds =
        node.exit.kind === "auto"
          ? node.exit.routes.map((route) => storyRouteNodeId(route.target))
          : node.exit.kind === "choice"
            ? node.exit.choices.map((choice) => storyRouteNodeId(choice.target))
            : [];
      node.interactions.forEach((interaction) => {
        Object.values(interaction.outcomes).forEach((action) => {
          if (action?.kind === "goto") {
            const targetNodeId = storyRouteNodeId(action.target);
            if (targetNodeId) pending.push(targetNodeId);
          }
        });
      });
      nextNodeIds.forEach((nextNodeId) => {
        if (nextNodeId !== null) pending.push(nextNodeId);
      });
    }
    release.nodes.forEach((node, nodeIndex) => {
      if (!reachable.has(node.nodeId)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", nodeIndex, "nodeId"],
          message: `Node ${node.nodeId} is unreachable from entry ${release.entryNodeId}`,
        });
      }
    });
    // A runtime may intentionally contain no terminal clip. Retry loops,
    // survival sequences and open-ended interactions are valid film-game
    // structures; the player owns their exit through a later interaction or
    // an explicit user action. Authoring diagnostics may still surface this
    // shape as a warning, but it is not a malformed release contract.
  });

export const InteractiveFilmReleaseSchema = z.preprocess(
  migrateStoryReleaseStats,
  InteractiveFilmReleaseObjectSchema
);

export type InteractiveFilmRelease = z.infer<typeof InteractiveFilmReleaseSchema>;
export type InteractiveFilmRuntimeNode = z.infer<typeof InteractiveFilmRuntimeNodeSchema>;
export type RuntimeAutoExit = z.infer<typeof RuntimeAutoExitSchema>;
export type RuntimeChoiceExit = z.infer<typeof RuntimeChoiceExitSchema>;
export type RuntimeVideoSequenceClip = z.infer<typeof VideoSequenceClipSchema>;
export type RuntimeVideoVariant = z.infer<typeof VideoVariantSchema>;

export function parseInteractiveFilmRelease(input: unknown): InteractiveFilmRelease {
  return InteractiveFilmReleaseSchema.parse(input);
}

function validateRuntimeDecisionDefinitions(
  nodes: z.infer<typeof InteractiveFilmRuntimeNodeSchema>[],
  context: z.RefinementCtx
): void {
  const decisions = new Map<
    string,
    { exit: z.infer<typeof RuntimeChoiceExitSchema>; nodeId: string }
  >();
  nodes.forEach((node, nodeIndex) => {
    if (node.exit.kind !== "choice") return;
    const canonical = decisions.get(node.exit.decisionId);
    if (!canonical) {
      decisions.set(node.exit.decisionId, { exit: node.exit, nodeId: node.nodeId });
      return;
    }
    const conflictingField = findRuntimeDecisionConflict(canonical.exit, node.exit);
    if (!conflictingField) return;
    context.addIssue({
      code: "custom",
      path: ["nodes", nodeIndex, "exit", "decisionId"],
      message: `Decision ${node.exit.decisionId} conflicts with its canonical definition on node ${canonical.nodeId}: ${conflictingField} must match`,
    });
  });
}

function findRuntimeDecisionConflict(
  canonical: z.infer<typeof RuntimeChoiceExitSchema>,
  candidate: z.infer<typeof RuntimeChoiceExitSchema>
): string | null {
  if (!runtimeSemanticValuesEqual(canonical.prompt, candidate.prompt)) return "prompt";
  const canonicalChoices = new Map(canonical.choices.map((choice) => [choice.choiceId, choice]));
  const candidateChoices = new Map(candidate.choices.map((choice) => [choice.choiceId, choice]));
  if (
    canonicalChoices.size !== candidateChoices.size ||
    [...canonicalChoices.keys()].some((choiceId) => !candidateChoices.has(choiceId))
  ) {
    return "choiceId set";
  }
  for (const [choiceId, canonicalChoice] of canonicalChoices) {
    const candidateChoice = candidateChoices.get(choiceId);
    if (!candidateChoice) return "choiceId set";
    for (const field of ["label"] as const) {
      if (!runtimeSemanticValuesEqual(canonicalChoice[field], candidateChoice[field])) {
        return `choice ${choiceId} ${field}`;
      }
    }
  }
  // A repeated decision can sit after alternate predecessor scenes. Its
  // choices keep one semantic identity while targeting context-specific
  // continuation nodes.
  return null;
}

function runtimeSemanticValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => runtimeSemanticValuesEqual(value, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && runtimeSemanticValuesEqual(leftRecord[key], rightRecord[key])
    )
  );
}

function uniqueIndex<T>(
  values: T[],
  id: (value: T) => string,
  path: PropertyKey[],
  context: z.RefinementCtx
): Map<string, T> {
  const result = new Map<string, T>();
  values.forEach((value, index) => {
    const key = id(value);
    if (result.has(key)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `Duplicate stable id ${key}`,
      });
    }
    result.set(key, value);
  });
  return result;
}
