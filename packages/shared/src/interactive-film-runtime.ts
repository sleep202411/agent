import { z } from "zod";

export const INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION = 1 as const;

/**
 * Built-in renderer contract for a non-narrative playback checkpoint.
 *
 * Story authoring treats a checkpoint as an interaction boundary without
 * turning it into a narrative decision. Builds lower that authoring exit to
 * the existing external-overlay runtime primitive so players can handle it as
 * a first-party renderer without widening the release schema union.
 */
export const STORY_CHECKPOINT_RENDERER_ID = "story.checkpoint" as const;
export const STORY_CHECKPOINT_CONTINUE_ACTION_ID = "continue" as const;

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
  durationSeconds: z.number().positive(),
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
    nextNodeId: stableId,
  })
  .strict();

export const RuntimeAutoExitSchema = z
  .object({
    kind: z.literal("auto"),
    nextNodeId: stableId,
  })
  .strict();

export const RuntimeChoiceExitSchema = z
  .object({
    kind: z.literal("choice"),
    decisionId: stableId,
    prompt: localizedText,
    choices: z.array(ChoiceSchema).min(2).max(6),
  })
  .strict();

const ExternalActionRouteSchema = z.union([
  z.object({ actionId: stableId, nextNodeId: stableId }).strict(),
  z.object({ actionId: stableId, endingId: stableId }).strict(),
]);

export const RuntimeExternalExitSchema = z
  .object({
    kind: z.literal("external-overlay"),
    rendererId: stableId,
    routes: z.array(ExternalActionRouteSchema).min(1),
  })
  .strict()
  .superRefine((exit, context) => {
    const actionIds = new Set<string>();
    exit.routes.forEach((route, index) => {
      if (actionIds.has(route.actionId)) {
        context.addIssue({
          code: "custom",
          path: ["routes", index, "actionId"],
          message: `Duplicate external action route ${route.actionId}`,
        });
      }
      actionIds.add(route.actionId);
    });
  });

export const RuntimeEndingExitSchema = z
  .object({ kind: z.literal("ending"), endingId: stableId })
  .strict();

export const RuntimeEndingSchema = z
  .object({
    endingId: stableId,
    title: localizedText,
    summary: localizedText.optional(),
  })
  .strict();
export type RuntimeEnding = z.infer<typeof RuntimeEndingSchema>;

const VideoSequenceEndBehaviorSchema = z.discriminatedUnion("behavior", [
  z.object({ behavior: z.literal("advance") }).strict(),
  z
    .object({
      behavior: z.literal("hold-last-frame"),
      durationMs: z.number().int().min(100).max(10_000).optional(),
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
    sequence: z.array(VideoSequenceClipSchema).min(1),
    posterAssetId: stableId.optional(),
    // "native" is emitted for narrative (frame-profile-less) stories so inline
    // video keeps its intrinsic size instead of being cropped to a fixed frame.
    fit: z.enum(["cover", "contain", "native"]),
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

const TextPresentationSchema = z
  .object({
    kind: z.literal("text"),
    title: localizedText.optional(),
    body: localizedText,
    completion: z.enum(["continue", "passive"]),
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
  RuntimeExternalExitSchema,
  RuntimeEndingExitSchema,
]);

const SceneNodeSchema = z
  .object({
    nodeId: stableId,
    presentation: z.discriminatedUnion("kind", [
      VideoPresentationSchema,
      ImagePresentationSchema,
      TextPresentationSchema,
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
    exit: RuntimeNodeExitSchema,
  })
  .strict();

export const InteractiveFilmRuntimeNodeSchema = SceneNodeSchema;

export const InteractiveFilmReleaseSchema = z
  .object({
    schemaVersion: z.literal(INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION),
    channel: z.enum(["preview", "production"]),
    gameId: stableId,
    releaseId: stableId,
    contentVersion: stableId,
    entryNodeId: stableId,
    defaultLocale: stableId,
    locales: z.array(stableId).min(1),
    endings: z.array(RuntimeEndingSchema).default([]),
    media: z.array(RuntimeMediaAssetSchema).default([]),
    nodes: z.array(InteractiveFilmRuntimeNodeSchema).min(1),
  })
  .strict()
  .superRefine((release, context) => {
    const media = uniqueIndex(release.media, (asset) => asset.assetId, ["media"], context);
    const nodes = uniqueIndex(release.nodes, (node) => node.nodeId, ["nodes"], context);
    const endings = uniqueIndex(release.endings, (ending) => ending.endingId, ["endings"], context);
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

    release.endings.forEach((ending, endingIndex) => {
      requireLocaleCoverage(ending.title, ["endings", endingIndex, "title"]);
      if (ending.summary) {
        requireLocaleCoverage(ending.summary, ["endings", endingIndex, "summary"]);
      }
    });

    const requireEnding = (endingId: string, path: PropertyKey[]): void => {
      // Once a release declares an endings catalog, every graph ending must
      // resolve through it so a player never has to invent display copy.
      if (endings.size > 0 && !endings.has(endingId)) {
        context.addIssue({ code: "custom", path, message: `Unknown ending ${endingId}` });
      }
    };

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
        } else if (node.presentation.kind === "text") {
          if (node.presentation.title) {
            requireLocaleCoverage(node.presentation.title, [...presentationPath, "title"]);
          }
          requireLocaleCoverage(node.presentation.body, [...presentationPath, "body"]);
        } else {
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
      }

      const exitPath = ["nodes", nodeIndex, "exit"];
      if (node.exit.kind === "auto") {
        requireNode(node.exit.nextNodeId, [...exitPath, "nextNodeId"]);
      }
      if (node.exit.kind === "choice") {
        requireLocaleCoverage(node.exit.prompt, [...exitPath, "prompt"]);
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
          requireNode(choice.nextNodeId, [...exitPath, "choices", choiceIndex, "nextNodeId"]);
        });
      }
      if (node.exit.kind === "external-overlay") {
        node.exit.routes.forEach((route, routeIndex) => {
          if ("nextNodeId" in route) {
            requireNode(route.nextNodeId, [...exitPath, "routes", routeIndex, "nextNodeId"]);
          } else {
            requireEnding(route.endingId, [...exitPath, "routes", routeIndex, "endingId"]);
          }
        });
      }
      if (node.exit.kind === "ending") {
        requireEnding(node.exit.endingId, [...exitPath, "endingId"]);
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
          ? [node.exit.nextNodeId]
          : node.exit.kind === "choice"
            ? node.exit.choices.map((choice) => choice.nextNodeId)
            : node.exit.kind === "external-overlay"
              ? node.exit.routes.flatMap((route) =>
                  "nextNodeId" in route ? [route.nextNodeId] : []
                )
              : [];
      nextNodeIds.forEach((nextNodeId) => pending.push(nextNodeId));
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
    const hasReachableEnding = release.nodes.some((node) => {
      if (!reachable.has(node.nodeId)) return false;
      if (node.exit.kind === "ending") return true;
      return (
        node.exit.kind === "external-overlay" &&
        node.exit.routes.some((route) => "endingId" in route)
      );
    });
    if (!hasReachableEnding) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Release graph has no reachable ending",
      });
    }
  });

export type InteractiveFilmRelease = z.infer<typeof InteractiveFilmReleaseSchema>;
export type InteractiveFilmRuntimeNode = z.infer<typeof InteractiveFilmRuntimeNodeSchema>;
export type RuntimeAutoExit = z.infer<typeof RuntimeAutoExitSchema>;
export type RuntimeChoiceExit = z.infer<typeof RuntimeChoiceExitSchema>;
export type RuntimeExternalExit = z.infer<typeof RuntimeExternalExitSchema>;
export type RuntimeEndingExit = z.infer<typeof RuntimeEndingExitSchema>;
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
