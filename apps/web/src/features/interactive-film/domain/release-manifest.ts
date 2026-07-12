import { z } from "zod";

export const INTERACTIVE_FILM_RELEASE_SCHEMA_VERSION = 1 as const;

const stableId = z.string().trim().min(1).max(120);
const localizedText = z.record(z.string().trim().min(2), z.string().trim().min(1));
const positiveInteger = z.number().int().positive();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Media hashes must be lowercase SHA-256");

const SessionValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const FilmConditionSchema: z.ZodType<FilmCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("flag"), flag: stableId, equals: z.boolean() }).strict(),
    z.object({ kind: z.literal("variable"), key: stableId, equals: SessionValueSchema }).strict(),
    z
      .object({
        kind: z.literal("relationship-at-least"),
        characterId: stableId,
        value: z.number().finite(),
      })
      .strict(),
    z.object({ kind: z.literal("all"), conditions: z.array(FilmConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal("any"), conditions: z.array(FilmConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal("not"), condition: FilmConditionSchema }).strict(),
  ])
);

export type FilmCondition =
  | { kind: "flag"; flag: string; equals: boolean }
  | { kind: "variable"; key: string; equals: string | number | boolean | null }
  | { kind: "relationship-at-least"; characterId: string; value: number }
  | { kind: "all"; conditions: FilmCondition[] }
  | { kind: "any"; conditions: FilmCondition[] }
  | { kind: "not"; condition: FilmCondition };

const SessionEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set_variable"), key: stableId, value: SessionValueSchema }).strict(),
  z
    .object({ kind: z.literal("increment_variable"), key: stableId, amount: z.number().finite() })
    .strict(),
  z.object({ kind: z.literal("set_flag"), flag: stableId, value: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("adjust_relationship"),
      characterId: stableId,
      amount: z.number().finite(),
    })
    .strict(),
  z.object({ kind: z.literal("mark_asset_watched"), assetId: stableId }).strict(),
  z.object({ kind: z.literal("unlock_ending"), endingId: stableId }).strict(),
]);

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
  framesPerSecond: FramesPerSecondSchema,
  codec: z.enum(["h264", "h265", "av1"]),
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
    audio: z.enum(["none", "embedded"]),
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

const InteractionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("media-ended") }).strict(),
  z.object({ kind: z.literal("timecode"), atSeconds: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal("overlay-ready") }).strict(),
]);

const ChoiceSchema = z
  .object({
    choiceId: stableId,
    label: localizedText,
    accessibilityLabel: localizedText.optional(),
    visibleWhen: FilmConditionSchema.optional(),
    effects: z.array(SessionEffectSchema).default([]),
    nextNodeId: stableId,
    afterSelect: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("play"), reactionAssetId: stableId }).strict(),
      z.object({ kind: z.literal("immediate") }).strict(),
    ]),
  })
  .strict();

const AutoExitSchema = z
  .object({
    kind: z.literal("auto"),
    routes: z
      .array(z.object({ nextNodeId: stableId, when: FilmConditionSchema.optional() }).strict())
      .min(1),
  })
  .strict();

const ChoiceExitSchema = z
  .object({
    kind: z.literal("choice"),
    trigger: InteractionTriggerSchema,
    choices: z.array(ChoiceSchema).min(2).max(6),
  })
  .strict();

const ExternalActionRouteSchema = z.union([
  z
    .object({
      actionId: stableId,
      effects: z.array(SessionEffectSchema).default([]),
      nextNodeId: stableId,
    })
    .strict(),
  z
    .object({
      actionId: stableId,
      effects: z.array(SessionEffectSchema).default([]),
      endingId: stableId,
    })
    .strict(),
]);

const ExternalExitSchema = z
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

const EndingExitSchema = z.object({ kind: z.literal("ending"), endingId: stableId }).strict();

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
    posterAssetId: stableId,
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

const ExtensionPresentationSchema = z
  .object({
    kind: z.literal("extension"),
    rendererId: stableId,
    configAssetId: stableId,
    accessibleFallbackAssetId: stableId,
    narrativePurpose: z.string().trim().min(20),
  })
  .strict();

const SceneNodeSchema = z
  .object({
    nodeId: stableId,
    presentation: z.discriminatedUnion("kind", [
      VideoPresentationSchema,
      ImagePresentationSchema,
      ExtensionPresentationSchema,
    ]),
    overlays: z.array(OverlaySchema).default([]),
    exit: z.discriminatedUnion("kind", [
      AutoExitSchema,
      ChoiceExitSchema,
      ExternalExitSchema,
      EndingExitSchema,
    ]),
  })
  .strict();

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
    media: z.array(RuntimeMediaAssetSchema).min(1),
    nodes: z.array(SceneNodeSchema).min(1),
  })
  .strict()
  .superRefine((release, context) => {
    const media = uniqueIndex(release.media, (asset) => asset.assetId, ["media"], context);
    const nodes = uniqueIndex(release.nodes, (node) => node.nodeId, ["nodes"], context);

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

    release.nodes.forEach((node, nodeIndex) => {
      const presentationPath = ["nodes", nodeIndex, "presentation"];
      if (node.presentation.kind === "video") {
        node.presentation.sequence.forEach((clip, clipIndex) => {
          const clipPath = [...presentationPath, "sequence", clipIndex];
          requireAsset(clip.assetId, ["video"], [...clipPath, "assetId"]);
          if (clip.posterAssetId) {
            requireAsset(clip.posterAssetId, ["image"], [...clipPath, "posterAssetId"]);
          }
          const clipAsset = media.get(clip.assetId);
          if (clip.endBehavior.behavior === "loop-tail" && clipAsset?.kind === "video") {
            if (clipAsset.audio !== "none") {
              context.addIssue({
                code: "custom",
                path: [...clipPath, "endBehavior"],
                message: "Tail loops require a silent picture asset so dialogue is never repeated",
              });
            }
          }
          if (clip.endBehavior.behavior === "loop") {
            requireAsset(
              clip.endBehavior.assetId,
              ["video"],
              [...clipPath, "endBehavior", "assetId"]
            );
            const loopAsset = media.get(clip.endBehavior.assetId);
            if (loopAsset?.kind === "video" && loopAsset.audio !== "none") {
              context.addIssue({
                code: "custom",
                path: [...clipPath, "endBehavior", "assetId"],
                message: "Wait-loop assets must be silent so dialogue is never repeated",
              });
            }
          }
        });
        requireAsset(
          node.presentation.posterAssetId,
          ["image"],
          [...presentationPath, "posterAssetId"]
        );
      } else if (node.presentation.kind === "image") {
        requireAsset(node.presentation.assetId, ["image"], [...presentationPath, "assetId"]);
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

      const exitPath = ["nodes", nodeIndex, "exit"];
      if (node.exit.kind === "auto") {
        node.exit.routes.forEach((route, routeIndex) =>
          requireNode(route.nextNodeId, [...exitPath, "routes", routeIndex, "nextNodeId"])
        );
      }
      if (node.exit.kind === "choice") {
        if (node.exit.trigger.kind === "timecode") {
          if (node.presentation.kind !== "video") {
            context.addIssue({
              code: "custom",
              path: [...exitPath, "trigger"],
              message: "Timecode triggers require a video presentation",
            });
          } else {
            const authoredDuration = node.presentation.sequence.reduce((total, clip) => {
              const asset = media.get(clip.assetId);
              if (asset?.kind !== "video") return total;
              const durations = Object.values(asset.variants).flatMap((variant) =>
                variant ? [variant.durationSeconds] : []
              );
              const clipDuration = Math.min(...durations);
              const holdDuration =
                clip.endBehavior.behavior === "hold-last-frame" && clip.endBehavior.durationMs
                  ? clip.endBehavior.durationMs / 1_000
                  : 0;
              return total + clipDuration + holdDuration;
            }, 0);
            if (node.exit.trigger.atSeconds > authoredDuration) {
              context.addIssue({
                code: "custom",
                path: [...exitPath, "trigger", "atSeconds"],
                message: `Choice timecode exceeds the ${authoredDuration}s authored sequence`,
              });
            }
          }
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
          if (choice.accessibilityLabel) {
            requireLocaleCoverage(choice.accessibilityLabel, [
              ...exitPath,
              "choices",
              choiceIndex,
              "accessibilityLabel",
            ]);
          }
          requireNode(choice.nextNodeId, [...exitPath, "choices", choiceIndex, "nextNodeId"]);
          if (choice.afterSelect.kind === "play") {
            requireAsset(
              choice.afterSelect.reactionAssetId,
              ["video"],
              [...exitPath, "choices", choiceIndex, "afterSelect", "reactionAssetId"]
            );
          }
        });
      }
      if (node.exit.kind === "external-overlay") {
        node.exit.routes.forEach((route, routeIndex) => {
          if ("nextNodeId" in route) {
            requireNode(route.nextNodeId, [...exitPath, "routes", routeIndex, "nextNodeId"]);
          }
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
          ? node.exit.routes.map((route) => route.nextNodeId)
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
export type InteractiveFilmSceneNode = z.infer<typeof SceneNodeSchema>;
export type RuntimeVideoSequenceClip = z.infer<typeof VideoSequenceClipSchema>;

export function parseInteractiveFilmRelease(input: unknown): InteractiveFilmRelease {
  return InteractiveFilmReleaseSchema.parse(input);
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
