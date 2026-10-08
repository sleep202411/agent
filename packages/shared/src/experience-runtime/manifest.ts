import { z } from "zod";
import { ExperienceAppearanceSchema } from "./appearance.js";
import { GameUIArtifactSchema } from "./game-ui.js";
import { ExperienceRuntimeAssetSchema, type ExperienceRuntimeAsset } from "./assets.js";
import { ExperienceAudioDefinitionSchema } from "./audio.js";
import {
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  EXPERIENCE_SEMANTIC_RULES_VERSION,
  ExperienceEventTypeSchema,
  ExperienceLocaleSchema,
  ExperienceLocalizedTextSchema,
  ExperienceStableIdSchema,
  type ExperienceValueExpression,
  uniqueById,
} from "./common.js";
import { type ExperienceEventBinding, type ExperienceRuntimeAction } from "./logic.js";
import { ExperienceRendererRequirementSchema } from "./renderer.js";
import {
  ExperienceEndingSchema,
  ExperienceGraphSchema,
  type ExperienceGraphNode,
} from "./scene.js";
import {
  ExperienceStateDefinitionSchema,
  type ExperienceCondition,
  type ExperienceStateDefinition,
} from "./state.js";
import { EXPERIENCE_GESTURE_CAPABILITY, ExperienceInputActionDefinitionSchema } from "./spatial.js";
import { ExperienceThemeReferenceSchema } from "./theme.js";

export const ExperienceProfileSchema = z.enum(["cinematic", "narrative"]);
export type ExperienceProfile = z.infer<typeof ExperienceProfileSchema>;

const ExperienceMetadataSchema = z
  .object({
    title: ExperienceLocalizedTextSchema,
    summary: ExperienceLocalizedTextSchema.optional(),
    coverAssetId: ExperienceStableIdSchema.optional(),
    experienceProfile: ExperienceProfileSchema.optional(),
  })
  .strict();

const ExperienceCompatibilitySchema = z
  .object({
    engineApiVersion: ExperienceStableIdSchema,
    experienceApiVersion: ExperienceStableIdSchema,
    semanticRulesVersion: z.literal(EXPERIENCE_SEMANTIC_RULES_VERSION),
    requiredCapabilities: z.array(ExperienceStableIdSchema).default([]),
  })
  .strict();

const ExperienceLocalizationSchema = z
  .object({
    defaultLocale: ExperienceLocaleSchema,
    locales: z.array(ExperienceLocaleSchema).min(1),
  })
  .strict();

const ExperienceTelemetryFieldSchema = z
  .object({
    field: ExperienceStableIdSchema,
    valueType: z.enum(["string", "number", "boolean", "duration-ms", "id", "json"]),
    required: z.boolean().default(false),
    classification: z.enum(["functional", "analytics"]),
  })
  .strict();

export const ExperienceTelemetryDefinitionSchema = z
  .object({
    eventName: ExperienceEventTypeSchema,
    fields: z.array(ExperienceTelemetryFieldSchema).default([]),
  })
  .strict()
  .superRefine((definition, context) => {
    uniqueById(definition.fields, (field) => field.field, ["fields"], context);
  });

const ExperienceRuntimeManifestBaseSchema = z
  .object({
    manifestType: z.literal("fizzdragon.experience"),
    schemaVersion: z.literal(EXPERIENCE_RUNTIME_SCHEMA_VERSION),
    channel: z.enum(["preview", "production"]),
    gameId: ExperienceStableIdSchema,
    buildId: ExperienceStableIdSchema,
    contentVersion: ExperienceStableIdSchema,
    completionPolicy: z.enum(["finite", "open-ended"]),
    metadata: ExperienceMetadataSchema,
    compatibility: ExperienceCompatibilitySchema,
    localization: ExperienceLocalizationSchema,
    stateDefinitions: z.array(ExperienceStateDefinitionSchema).default([]),
    inputActions: z.array(ExperienceInputActionDefinitionSchema).default([]),
    rendererRequirements: z.array(ExperienceRendererRequirementSchema).min(1),
    assets: z.array(ExperienceRuntimeAssetSchema).default([]),
    theme: ExperienceThemeReferenceSchema,
    appearance: ExperienceAppearanceSchema.optional(),
    gameUi: GameUIArtifactSchema.optional(),
    audio: ExperienceAudioDefinitionSchema.optional(),
    telemetryDefinitions: z.array(ExperienceTelemetryDefinitionSchema).default([]),
    endings: z.array(ExperienceEndingSchema).default([]),
    graph: ExperienceGraphSchema,
  })
  .strict();

type ManifestDraft = z.infer<typeof ExperienceRuntimeManifestBaseSchema>;

function requireLocalizedCoverage(
  value: Record<string, string>,
  locales: readonly string[],
  path: PropertyKey[],
  context: z.RefinementCtx
): void {
  locales.forEach((locale) => {
    if (value[locale]) return;
    context.addIssue({
      code: "custom",
      path: [...path, locale],
      message: `Missing localized text for ${locale}`,
    });
  });
}

function stateDefinitionForPath(
  path: string,
  definitions: ReadonlyMap<string, ExperienceStateDefinition>
): ExperienceStateDefinition | undefined {
  const exact = definitions.get(path);
  if (exact) return exact;
  return [...definitions.values()].find(
    (definition) => definition.valueType === "json" && path.startsWith(`${definition.key}.`)
  );
}

function validateExpression(
  expression: ExperienceValueExpression,
  definitions: ReadonlyMap<string, ExperienceStateDefinition>,
  path: PropertyKey[],
  context: z.RefinementCtx,
  allowEvent = true
): void {
  if (!allowEvent && expression.kind === "event") {
    context.addIssue({
      code: "custom",
      path,
      message: "Persistent renderer and gesture expressions cannot read transient event payloads",
    });
    return;
  }
  if (expression.kind !== "state") return;
  if (stateDefinitionForPath(expression.path, definitions)) return;
  context.addIssue({
    code: "custom",
    path,
    message: `Unknown state path ${expression.path}`,
  });
}

function validateCondition(
  condition: ExperienceCondition,
  definitions: ReadonlyMap<string, ExperienceStateDefinition>,
  path: PropertyKey[],
  context: z.RefinementCtx,
  allowEvent = true
): void {
  if (condition.kind === "compare") {
    validateExpression(condition.left, definitions, [...path, "left"], context, allowEvent);
    validateExpression(condition.right, definitions, [...path, "right"], context, allowEvent);
    return;
  }
  if (condition.kind === "exists") {
    validateExpression(condition.value, definitions, [...path, "value"], context, allowEvent);
    return;
  }
  if (condition.kind === "not") {
    validateCondition(
      condition.condition,
      definitions,
      [...path, "condition"],
      context,
      allowEvent
    );
    return;
  }
  condition.conditions.forEach((child, index) =>
    validateCondition(child, definitions, [...path, "conditions", index], context, allowEvent)
  );
}

function runtimeAssetOfKind(
  assets: ReadonlyMap<string, ExperienceRuntimeAsset>,
  assetId: string,
  kinds: readonly ExperienceRuntimeAsset["kind"][],
  path: PropertyKey[],
  context: z.RefinementCtx
): ExperienceRuntimeAsset | undefined {
  const asset = assets.get(assetId);
  if (!asset) {
    context.addIssue({ code: "custom", path, message: `Unknown asset ${assetId}` });
    return undefined;
  }
  if (!kinds.includes(asset.kind)) {
    context.addIssue({
      code: "custom",
      path,
      message: `Asset ${assetId} must be ${kinds.join(" or ")}, received ${asset.kind}`,
    });
    return undefined;
  }
  return asset;
}

function bindingsFor(node: ExperienceGraphNode): readonly ExperienceEventBinding[] {
  return node.eventBindings;
}

function eventSelectorsOverlap(
  left: ExperienceEventBinding["on"],
  right: ExperienceEventBinding["on"]
): boolean {
  if (left.type !== right.type) return false;
  const sourceOverlaps =
    left.sourceId === undefined || right.sourceId === undefined || left.sourceId === right.sourceId;
  const qualifierOverlaps =
    left.qualifierId === undefined ||
    right.qualifierId === undefined ||
    left.qualifierId === right.qualifierId;
  return sourceOverlaps && qualifierOverlaps;
}

export const ExperienceRuntimeManifestSchema = ExperienceRuntimeManifestBaseSchema.superRefine(
  (manifest, context) => {
    const stateDefinitions = uniqueById(
      manifest.stateDefinitions,
      (definition) => definition.key,
      ["stateDefinitions"],
      context
    );
    const inputActions = uniqueById(
      manifest.inputActions,
      (action) => action.actionId,
      ["inputActions"],
      context
    );
    const rendererRequirements = uniqueById(
      manifest.rendererRequirements,
      (renderer) => renderer.rendererId,
      ["rendererRequirements"],
      context
    );
    const assets = uniqueById(manifest.assets, (asset) => asset.assetId, ["assets"], context);
    const endings = uniqueById(manifest.endings, (ending) => ending.endingId, ["endings"], context);
    const nodes = uniqueById(
      manifest.graph.nodes,
      (node) => node.sceneId,
      ["graph", "nodes"],
      context
    );
    const telemetryDefinitions = uniqueById(
      manifest.telemetryDefinitions,
      (definition) => definition.eventName,
      ["telemetryDefinitions"],
      context
    );

    const accessPrices = new Map<string, number>();
    manifest.graph.nodes.forEach((node, index) => {
      const requirements = [
        node.access,
        ...node.eventBindings.flatMap((binding) => binding.routes.map((route) => route.access)),
      ];
      for (const access of requirements) {
        if (!access) continue;
        if (!manifest.compatibility.requiredCapabilities.includes("commerce.community-points"))
          context.addIssue({
            code: "custom",
            path: ["graph", "nodes", index],
            message: "Paid content requires commerce.community-points capability",
          });
        if (
          accessPrices.has(access.key) &&
          accessPrices.get(access.key) !== access.communityPointPrice
        )
          context.addIssue({
            code: "custom",
            path: ["graph", "nodes", index],
            message: `Conflicting prices for ${access.key}`,
          });
        accessPrices.set(access.key, access.communityPointPrice);
      }
    });
    const requiredCapabilities = new Set<string>();
    manifest.compatibility.requiredCapabilities.forEach((capability, index) => {
      if (requiredCapabilities.has(capability)) {
        context.addIssue({
          code: "custom",
          path: ["compatibility", "requiredCapabilities", index],
          message: `Duplicate required capability ${capability}`,
        });
      }
      requiredCapabilities.add(capability);
    });
    const assertRequiredCapability = (capability: string, path: PropertyKey[]): void => {
      if (requiredCapabilities.has(capability)) return;
      context.addIssue({
        code: "custom",
        path,
        message: `Manifest feature requires capability ${capability}`,
      });
    };

    manifest.stateDefinitions.forEach((definition) => {
      if (definition.valueType !== "json") return;
      manifest.stateDefinitions.forEach((candidate, candidateIndex) => {
        if (candidate.key === definition.key) return;
        if (!candidate.key.startsWith(`${definition.key}.`)) return;
        context.addIssue({
          code: "custom",
          path: ["stateDefinitions", candidateIndex, "key"],
          message: `State definition ${candidate.key} overlaps JSON root ${definition.key}`,
        });
      });
    });

    const localeSet = new Set(manifest.localization.locales);
    if (localeSet.size !== manifest.localization.locales.length) {
      context.addIssue({
        code: "custom",
        path: ["localization", "locales"],
        message: "Locales must be unique",
      });
    }
    if (!localeSet.has(manifest.localization.defaultLocale)) {
      context.addIssue({
        code: "custom",
        path: ["localization", "defaultLocale"],
        message: "defaultLocale must be included in locales",
      });
    }
    requireLocalizedCoverage(
      manifest.metadata.title,
      manifest.localization.locales,
      ["metadata", "title"],
      context
    );
    if (manifest.metadata.summary) {
      requireLocalizedCoverage(
        manifest.metadata.summary,
        manifest.localization.locales,
        ["metadata", "summary"],
        context
      );
    }
    if (manifest.metadata.coverAssetId) {
      runtimeAssetOfKind(
        assets,
        manifest.metadata.coverAssetId,
        ["image"],
        ["metadata", "coverAssetId"],
        context
      );
    }
    const themeConfigAsset = runtimeAssetOfKind(
      assets,
      manifest.theme.configAssetId,
      ["data"],
      ["theme", "configAssetId"],
      context
    );
    if (themeConfigAsset?.kind === "data" && themeConfigAsset.format !== "json") {
      context.addIssue({
        code: "custom",
        path: ["theme", "configAssetId"],
        message: "Theme configuration assets must use JSON format",
      });
    }

    manifest.inputActions.forEach((action, index) => {
      requireLocalizedCoverage(
        action.label,
        manifest.localization.locales,
        ["inputActions", index, "label"],
        context
      );
      if (action.accessibilityDescription) {
        requireLocalizedCoverage(
          action.accessibilityDescription,
          manifest.localization.locales,
          ["inputActions", index, "accessibilityDescription"],
          context
        );
      }
    });

    manifest.endings.forEach((ending, index) => {
      requireLocalizedCoverage(
        ending.title,
        manifest.localization.locales,
        ["endings", index, "title"],
        context
      );
      if (ending.summary) {
        requireLocalizedCoverage(
          ending.summary,
          manifest.localization.locales,
          ["endings", index, "summary"],
          context
        );
      }
    });
    if (manifest.completionPolicy === "finite" && manifest.endings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["endings"],
        message: "Finite experiences must declare at least one ending",
      });
    }

    manifest.rendererRequirements.forEach((requirement, requirementIndex) => {
      requirement.requiredCapabilities.forEach((capability, capabilityIndex) => {
        if (requiredCapabilities.has(capability)) return;
        context.addIssue({
          code: "custom",
          path: ["rendererRequirements", requirementIndex, "requiredCapabilities", capabilityIndex],
          message: `Renderer capability ${capability} must be declared by manifest compatibility`,
        });
      });
      uniqueById(
        requirement.outcomes,
        (outcome) => outcome.outcomeType,
        ["rendererRequirements", requirementIndex, "outcomes"],
        context
      );
      uniqueById(
        requirement.commands,
        (command) => command.commandType,
        ["rendererRequirements", requirementIndex, "commands"],
        context
      );
      requirement.outcomes.forEach((outcome, outcomeIndex) => {
        if (!outcome.payloadSchemaAssetId) return;
        const payloadSchema = runtimeAssetOfKind(
          assets,
          outcome.payloadSchemaAssetId,
          ["data"],
          [
            "rendererRequirements",
            requirementIndex,
            "outcomes",
            outcomeIndex,
            "payloadSchemaAssetId",
          ],
          context
        );
        if (payloadSchema?.kind === "data" && payloadSchema.format !== "json") {
          context.addIssue({
            code: "custom",
            path: [
              "rendererRequirements",
              requirementIndex,
              "outcomes",
              outcomeIndex,
              "payloadSchemaAssetId",
            ],
            message: "Renderer outcome payload schemas must use JSON format",
          });
        }
      });
      requirement.commands.forEach((command, commandIndex) => {
        if (!command.payloadSchemaAssetId) return;
        const payloadSchema = runtimeAssetOfKind(
          assets,
          command.payloadSchemaAssetId,
          ["data"],
          [
            "rendererRequirements",
            requirementIndex,
            "commands",
            commandIndex,
            "payloadSchemaAssetId",
          ],
          context
        );
        if (payloadSchema?.kind === "data" && payloadSchema.format !== "json") {
          context.addIssue({
            code: "custom",
            path: [
              "rendererRequirements",
              requirementIndex,
              "commands",
              commandIndex,
              "payloadSchemaAssetId",
            ],
            message: "Renderer command payload schemas must use JSON format",
          });
        }
      });
    });

    if (!nodes.has(manifest.graph.entrySceneId)) {
      context.addIssue({
        code: "custom",
        path: ["graph", "entrySceneId"],
        message: `Unknown entry scene ${manifest.graph.entrySceneId}`,
      });
    }

    const rendererInstances = new Map<
      string,
      { rendererId: string; nodeId: string; path: PropertyKey[] }
    >();
    const anchors = new Map<string, { nodeId: string; path: PropertyKey[] }>();
    const gestures = new Map<string, { nodeId: string; path: PropertyKey[] }>();

    manifest.graph.nodes.forEach((node, nodeIndex) => {
      const nodePath = ["graph", "nodes", nodeIndex];
      if (node.kind !== "scene") return;
      node.renderers.forEach((renderer, rendererIndex) => {
        const rendererPath = [...nodePath, "renderers", rendererIndex];
        if (rendererInstances.has(renderer.instanceId)) {
          context.addIssue({
            code: "custom",
            path: [...rendererPath, "instanceId"],
            message: `Renderer instance IDs must be globally unique: ${renderer.instanceId}`,
          });
        }
        rendererInstances.set(renderer.instanceId, {
          rendererId: renderer.rendererId,
          nodeId: node.sceneId,
          path: rendererPath,
        });
        if (!rendererRequirements.has(renderer.rendererId)) {
          context.addIssue({
            code: "custom",
            path: [...rendererPath, "rendererId"],
            message: `Missing renderer requirement ${renderer.rendererId}`,
          });
        }
        if (
          renderer.accessibleFallback &&
          !rendererRequirements.has(renderer.accessibleFallback.rendererId)
        ) {
          context.addIssue({
            code: "custom",
            path: [...rendererPath, "accessibleFallback", "rendererId"],
            message: `Missing fallback renderer requirement ${renderer.accessibleFallback.rendererId}`,
          });
        }
        Object.entries(renderer.bindings).forEach(([binding, expression]) =>
          validateExpression(
            expression,
            stateDefinitions,
            [...rendererPath, "bindings", binding],
            context,
            false
          )
        );
        if (renderer.visibleWhen) {
          validateCondition(
            renderer.visibleWhen,
            stateDefinitions,
            [...rendererPath, "visibleWhen"],
            context,
            false
          );
        }
      });
      node.anchors.forEach((anchor, anchorIndex) => {
        const anchorPath = [...nodePath, "anchors", anchorIndex];
        assertRequiredCapability("spatial.anchor", anchorPath);
        if (anchor.space.kind === "renderer-content") {
          assertRequiredCapability("spatial.renderer-content", [...anchorPath, "space"]);
        }
        if (anchor.motion.kind === "keyframes") {
          assertRequiredCapability("spatial.keyframes", [...anchorPath, "motion"]);
        }
        if (anchor.motion.kind === "tracked") {
          assertRequiredCapability("spatial.tracked", [...anchorPath, "motion"]);
        }
        if (anchors.has(anchor.anchorId)) {
          context.addIssue({
            code: "custom",
            path: [...anchorPath, "anchorId"],
            message: `Spatial anchor IDs must be globally unique: ${anchor.anchorId}`,
          });
        }
        anchors.set(anchor.anchorId, { nodeId: node.sceneId, path: anchorPath });
      });
      node.gestures.forEach((gesture, gestureIndex) => {
        const gesturePath = [...nodePath, "gestures", gestureIndex];
        if (gestures.has(gesture.gestureId)) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "gestureId"],
            message: `Gesture IDs must be globally unique: ${gesture.gestureId}`,
          });
        }
        gestures.set(gesture.gestureId, { nodeId: node.sceneId, path: gesturePath });
        const gestureCapability = EXPERIENCE_GESTURE_CAPABILITY[gesture.kind];
        if (!requiredCapabilities.has(gestureCapability)) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "kind"],
            message: `Gesture ${gesture.kind} requires capability ${gestureCapability}`,
          });
        }
        if (!inputActions.has(gesture.inputActionId)) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "inputActionId"],
            message: `Unknown input action ${gesture.inputActionId}`,
          });
        }
        if (
          gesture.accessibleAlternativeActionId &&
          !inputActions.has(gesture.accessibleAlternativeActionId)
        ) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "accessibleAlternativeActionId"],
            message: `Unknown accessible input action ${gesture.accessibleAlternativeActionId}`,
          });
        }
        if (gesture.enabledWhen) {
          validateCondition(
            gesture.enabledWhen,
            stateDefinitions,
            [...gesturePath, "enabledWhen"],
            context,
            false
          );
        }
        if (
          gesture.kind === "press-hold" &&
          gesture.activeWindow &&
          gesture.durationMs > gesture.activeWindow.endMs - gesture.activeWindow.startMs
        ) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "durationMs"],
            message: "Press-hold duration must fit inside its active interaction window",
          });
        }
      });
      if (node.clock.kind === "fixed") {
        const durationMs = node.clock.durationMs;
        node.timeline.cues.forEach((cue, cueIndex) => {
          if (cue.atMs <= durationMs) return;
          context.addIssue({
            code: "custom",
            path: [...nodePath, "timeline", "cues", cueIndex, "atMs"],
            message: `Timeline cue exceeds the ${durationMs}ms scene clock`,
          });
        });
        node.gestures.forEach((gesture, gestureIndex) => {
          if (!gesture.activeWindow || gesture.activeWindow.endMs <= durationMs) return;
          context.addIssue({
            code: "custom",
            path: [...nodePath, "gestures", gestureIndex, "activeWindow", "endMs"],
            message: `Interaction window exceeds the ${durationMs}ms scene clock`,
          });
        });
      }
    });

    manifest.graph.nodes.forEach((node, nodeIndex) => {
      if (node.kind !== "scene") return;
      const nodePath = ["graph", "nodes", nodeIndex];
      if (
        node.clock.kind === "renderer" &&
        rendererInstances.get(node.clock.rendererInstanceId)?.nodeId !== node.sceneId
      ) {
        context.addIssue({
          code: "custom",
          path: [...nodePath, "clock", "rendererInstanceId"],
          message: "A scene clock must reference a renderer in the same scene",
        });
      }
      node.renderers.forEach((renderer, rendererIndex) => {
        if (!renderer.anchorId) return;
        if (anchors.get(renderer.anchorId)?.nodeId === node.sceneId) return;
        context.addIssue({
          code: "custom",
          path: [...nodePath, "renderers", rendererIndex, "anchorId"],
          message: `Renderer anchor ${renderer.anchorId} must exist in the same scene`,
        });
      });
      node.anchors.forEach((anchor, anchorIndex) => {
        if (
          anchor.space.kind === "renderer-content" &&
          rendererInstances.get(anchor.space.rendererInstanceId)?.nodeId !== node.sceneId
        ) {
          context.addIssue({
            code: "custom",
            path: [...nodePath, "anchors", anchorIndex, "space", "rendererInstanceId"],
            message: "A renderer-content anchor must reference a renderer in the same scene",
          });
        }
        if (anchor.space.kind === "renderer-content") {
          const target = rendererInstances.get(anchor.space.rendererInstanceId);
          if (
            target &&
            !rendererRequirements
              .get(target.rendererId)
              ?.requiredCapabilities.includes("renderer.content-transform")
          ) {
            context.addIssue({
              code: "custom",
              path: [...nodePath, "anchors", anchorIndex, "space", "rendererInstanceId"],
              message: `Renderer ${target.rendererId} must provide renderer.content-transform`,
            });
          }
        }
        if (anchor.motion.kind === "tracked") {
          const trackingAsset = runtimeAssetOfKind(
            assets,
            anchor.motion.trackingAssetId,
            ["data"],
            [...nodePath, "anchors", anchorIndex, "motion", "trackingAssetId"],
            context
          );
          if (trackingAsset?.kind === "data" && trackingAsset.format !== "tracking") {
            context.addIssue({
              code: "custom",
              path: [...nodePath, "anchors", anchorIndex, "motion", "trackingAssetId"],
              message: "Tracked anchors require a tracking data asset",
            });
          }
        }
        if (anchor.motion.kind === "keyframes") {
          const first = anchor.motion.keyframes[0];
          anchor.motion.keyframes.forEach((keyframe, keyframeIndex) => {
            if (node.clock.kind === "fixed" && keyframe.atMs > node.clock.durationMs) {
              context.addIssue({
                code: "custom",
                path: [
                  ...nodePath,
                  "anchors",
                  anchorIndex,
                  "motion",
                  "keyframes",
                  keyframeIndex,
                  "atMs",
                ],
                message: `Spatial keyframe exceeds the ${node.clock.durationMs}ms scene clock`,
              });
            }
            if (!first) return;
            (["landscape", "portrait", "square"] as const).forEach((variant) => {
              const canonical = first.geometry[variant] ?? first.geometry.default;
              const candidate = keyframe.geometry[variant] ?? keyframe.geometry.default;
              if (!canonical || !candidate) return;
              if (canonical.kind !== candidate.kind) {
                context.addIssue({
                  code: "custom",
                  path: [
                    ...nodePath,
                    "anchors",
                    anchorIndex,
                    "motion",
                    "keyframes",
                    keyframeIndex,
                    "geometry",
                    variant,
                  ],
                  message: "Spatial keyframes must preserve geometry kind per orientation",
                });
              }
              if (
                canonical.kind === "polygon" &&
                candidate.kind === "polygon" &&
                canonical.points.length !== candidate.points.length
              ) {
                context.addIssue({
                  code: "custom",
                  path: [
                    ...nodePath,
                    "anchors",
                    anchorIndex,
                    "motion",
                    "keyframes",
                    keyframeIndex,
                    "geometry",
                    variant,
                  ],
                  message: "Polygon keyframes must preserve point count",
                });
              }
            });
          });
        }
      });
      node.gestures.forEach((gesture, gestureIndex) => {
        const gesturePath = [...nodePath, "gestures", gestureIndex];
        if (anchors.get(gesture.anchorId)?.nodeId !== node.sceneId) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "anchorId"],
            message: `Gesture anchor ${gesture.anchorId} must exist in the same scene`,
          });
        }
        if (
          gesture.feedbackRendererInstanceId &&
          rendererInstances.get(gesture.feedbackRendererInstanceId)?.nodeId !== node.sceneId
        ) {
          context.addIssue({
            code: "custom",
            path: [...gesturePath, "feedbackRendererInstanceId"],
            message: "Gesture feedback renderer must exist in the same scene",
          });
        }
        if (gesture.kind === "drag") {
          gesture.targetAnchorIds.forEach((anchorId, targetIndex) => {
            if (anchors.get(anchorId)?.nodeId === node.sceneId) return;
            context.addIssue({
              code: "custom",
              path: [...gesturePath, "targetAnchorIds", targetIndex],
              message: `Drag target ${anchorId} must exist in the same scene`,
            });
          });
        }
      });
    });

    const audioBuses = manifest.audio
      ? uniqueById(manifest.audio.buses, (bus) => bus.busId, ["audio", "buses"], context)
      : new Map();
    const audioCues = manifest.audio
      ? uniqueById(manifest.audio.cues, (cue) => cue.cueId, ["audio", "cues"], context)
      : new Map();
    const audioSnapshots = manifest.audio
      ? uniqueById(
          manifest.audio.snapshots,
          (snapshot) => snapshot.snapshotId,
          ["audio", "snapshots"],
          context
        )
      : new Map();

    if (manifest.audio) {
      assertRequiredCapability("audio.core", ["audio"]);
      const masterBuses = manifest.audio.buses.filter((bus) => bus.role === "master");
      if (masterBuses.length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["audio", "buses"],
          message: "Audio definitions must declare exactly one master bus",
        });
      }
      manifest.audio.buses.forEach((bus, busIndex) => {
        if (bus.role === "master" && bus.parentBusId) {
          context.addIssue({
            code: "custom",
            path: ["audio", "buses", busIndex, "parentBusId"],
            message: "The master bus cannot have a parent",
          });
        }
        if (bus.role !== "master" && !bus.parentBusId) {
          context.addIssue({
            code: "custom",
            path: ["audio", "buses", busIndex, "parentBusId"],
            message: "Non-master audio buses require a parent",
          });
        }
        if (bus.parentBusId && !audioBuses.has(bus.parentBusId)) {
          context.addIssue({
            code: "custom",
            path: ["audio", "buses", busIndex, "parentBusId"],
            message: `Unknown parent audio bus ${bus.parentBusId}`,
          });
        }
        const visited = new Set<string>();
        let current = bus;
        while (current.parentBusId) {
          if (visited.has(current.busId)) {
            context.addIssue({
              code: "custom",
              path: ["audio", "buses", busIndex, "parentBusId"],
              message: "Audio bus hierarchy must be acyclic",
            });
            break;
          }
          visited.add(current.busId);
          const parent = audioBuses.get(current.parentBusId);
          if (!parent) break;
          current = parent;
        }
      });
      manifest.audio.cues.forEach((cue, cueIndex) => {
        if (!audioBuses.has(cue.busId)) {
          context.addIssue({
            code: "custom",
            path: ["audio", "cues", cueIndex, "busId"],
            message: `Unknown audio bus ${cue.busId}`,
          });
        }
        cue.assetIds.forEach((assetId, assetIndex) =>
          runtimeAssetOfKind(
            assets,
            assetId,
            ["audio"],
            ["audio", "cues", cueIndex, "assetIds", assetIndex],
            context
          )
        );
        if (cue.spatialAnchorId && !anchors.has(cue.spatialAnchorId)) {
          context.addIssue({
            code: "custom",
            path: ["audio", "cues", cueIndex, "spatialAnchorId"],
            message: `Unknown spatial audio anchor ${cue.spatialAnchorId}`,
          });
        }
        if (cue.spatialAnchorId) {
          assertRequiredCapability("audio.spatial", ["audio", "cues", cueIndex]);
        }
        if (cue.selection === "random" || cue.playbackRate.minimum !== cue.playbackRate.maximum) {
          assertRequiredCapability("audio.deterministic-selection", ["audio", "cues", cueIndex]);
        }
      });
      manifest.audio.snapshots.forEach((snapshot, snapshotIndex) => {
        Object.keys(snapshot.busGains).forEach((busId) => {
          if (audioBuses.has(busId)) return;
          context.addIssue({
            code: "custom",
            path: ["audio", "snapshots", snapshotIndex, "busGains", busId],
            message: `Unknown audio bus ${busId}`,
          });
        });
      });
      manifest.audio.duckingRules.forEach((rule, ruleIndex) => {
        if (!audioBuses.has(rule.triggerBusId)) {
          context.addIssue({
            code: "custom",
            path: ["audio", "duckingRules", ruleIndex, "triggerBusId"],
            message: `Unknown trigger audio bus ${rule.triggerBusId}`,
          });
        }
        if (!audioBuses.has(rule.targetBusId)) {
          context.addIssue({
            code: "custom",
            path: ["audio", "duckingRules", ruleIndex, "targetBusId"],
            message: `Unknown target audio bus ${rule.targetBusId}`,
          });
        }
      });
    }

    const outgoing = new Map<string, Set<string>>();
    const endingScenes = new Set<string>();

    const validateAction = (
      action: ExperienceRuntimeAction,
      node: ExperienceGraphNode,
      path: PropertyKey[]
    ): void => {
      if (action.kind === "state.set" || action.kind === "state.increment") {
        const definition = stateDefinitionForPath(action.path, stateDefinitions);
        if (!definition) {
          context.addIssue({
            code: "custom",
            path: [...path, "path"],
            message: `Unknown state path ${action.path}`,
          });
        }
        if (action.kind === "state.increment" && definition?.valueType !== "number") {
          context.addIssue({
            code: "custom",
            path: [...path, "path"],
            message: "state.increment requires a number state definition",
          });
        }
        validateExpression(
          action.kind === "state.set" ? action.value : action.amount,
          stateDefinitions,
          [...path, action.kind === "state.set" ? "value" : "amount"],
          context
        );
        const expression = action.kind === "state.set" ? action.value : action.amount;
        if (expression.kind === "literal") {
          if (action.kind === "state.increment" && typeof expression.value !== "number") {
            context.addIssue({
              code: "custom",
              path: [...path, "amount"],
              message: "state.increment requires a numeric amount",
            });
          }
          if (action.kind === "state.set" && definition?.key === action.path) {
            const valueMatches =
              definition.valueType === "json"
                ? typeof expression.value === "object" &&
                  expression.value !== null &&
                  !Array.isArray(expression.value)
                : typeof expression.value === definition.valueType;
            if (!valueMatches) {
              context.addIssue({
                code: "custom",
                path: [...path, "value"],
                message: `state.set ${action.path} requires ${definition.valueType}`,
              });
            }
          }
        }
      }
      if (action.kind === "scene.goto") {
        if (!nodes.has(action.sceneId)) {
          context.addIssue({
            code: "custom",
            path: [...path, "sceneId"],
            message: `Unknown target scene ${action.sceneId}`,
          });
        }
        const targets = outgoing.get(node.sceneId) ?? new Set<string>();
        targets.add(action.sceneId);
        outgoing.set(node.sceneId, targets);
      }
      if (action.kind === "ending.complete") {
        if (!endings.has(action.endingId)) {
          context.addIssue({
            code: "custom",
            path: [...path, "endingId"],
            message: `Unknown ending ${action.endingId}`,
          });
        }
        endingScenes.add(node.sceneId);
      }
      if (action.kind === "renderer.command") {
        const instance = rendererInstances.get(action.instanceId);
        if (!instance || instance.nodeId !== node.sceneId) {
          context.addIssue({
            code: "custom",
            path: [...path, "instanceId"],
            message: "Renderer commands must target an instance in the same scene",
          });
        } else {
          const requirement = rendererRequirements.get(instance.rendererId);
          if (
            !requirement?.commands.some((command) => command.commandType === action.commandType)
          ) {
            context.addIssue({
              code: "custom",
              path: [...path, "commandType"],
              message: `Renderer ${instance.rendererId} does not declare command ${action.commandType}`,
            });
          }
        }
        Object.entries(action.payload).forEach(([key, expression]) =>
          validateExpression(expression, stateDefinitions, [...path, "payload", key], context)
        );
      }
      if (action.kind === "audio.play") {
        const cue = audioCues.get(action.cueId);
        if (!cue) {
          context.addIssue({
            code: "custom",
            path: [...path, "cueId"],
            message: `Unknown audio cue ${action.cueId}`,
          });
        } else if (
          cue.spatialAnchorId &&
          anchors.get(cue.spatialAnchorId)?.nodeId !== node.sceneId
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, "cueId"],
            message: `Spatial audio cue ${action.cueId} requires its anchor in the same scene`,
          });
        }
      }
      if (action.kind === "audio.stop") {
        if (action.target === "cue" && !audioCues.has(action.targetId)) {
          context.addIssue({
            code: "custom",
            path: [...path, "targetId"],
            message: `Unknown audio cue ${action.targetId}`,
          });
        }
      }
      if (action.kind === "audio.fade-bus" && !audioBuses.has(action.busId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "busId"],
          message: `Unknown audio bus ${action.busId}`,
        });
      }
      if (action.kind === "audio.apply-snapshot" && !audioSnapshots.has(action.snapshotId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "snapshotId"],
          message: `Unknown audio snapshot ${action.snapshotId}`,
        });
      }
      if (action.kind === "event.emit" || action.kind === "telemetry.emit") {
        Object.entries(action.payload).forEach(([key, expression]) =>
          validateExpression(expression, stateDefinitions, [...path, "payload", key], context)
        );
      }
      if (action.kind === "telemetry.emit") {
        const definition = telemetryDefinitions.get(action.eventName);
        if (!definition) {
          context.addIssue({
            code: "custom",
            path: [...path, "eventName"],
            message: `Unknown telemetry event ${action.eventName}`,
          });
        } else {
          const fields = new Map(definition.fields.map((field) => [field.field, field]));
          definition.fields.forEach((field) => {
            if (!field.required || action.payload[field.field]) return;
            context.addIssue({
              code: "custom",
              path: [...path, "payload", field.field],
              message: `Required telemetry field ${field.field} is missing`,
            });
          });
          Object.entries(action.payload).forEach(([fieldName, expression]) => {
            const field = fields.get(fieldName);
            if (!field) {
              context.addIssue({
                code: "custom",
                path: [...path, "payload", fieldName],
                message: `Telemetry field ${fieldName} is not declared`,
              });
              return;
            }
            if (expression.kind === "state") {
              const stateDefinition = stateDefinitionForPath(expression.path, stateDefinitions);
              if (stateDefinition?.sensitive) {
                context.addIssue({
                  code: "custom",
                  path: [...path, "payload", fieldName],
                  message: `Sensitive state ${expression.path} cannot be emitted as telemetry`,
                });
              }
              const expectedType =
                field.valueType === "duration-ms"
                  ? "number"
                  : field.valueType === "id"
                    ? "string"
                    : field.valueType;
              if (
                stateDefinition &&
                expectedType !== "json" &&
                stateDefinition.valueType !== "json" &&
                stateDefinition.valueType !== expectedType
              ) {
                context.addIssue({
                  code: "custom",
                  path: [...path, "payload", fieldName],
                  message: `Telemetry field ${fieldName} expects ${field.valueType}`,
                });
              }
            }
            if (expression.kind === "literal") {
              const expectedType =
                field.valueType === "duration-ms"
                  ? "number"
                  : field.valueType === "id"
                    ? "string"
                    : field.valueType;
              if (expectedType !== "json" && typeof expression.value !== expectedType) {
                context.addIssue({
                  code: "custom",
                  path: [...path, "payload", fieldName],
                  message: `Telemetry field ${fieldName} expects ${field.valueType}`,
                });
              }
            }
          });
        }
      }
      if (action.kind === "progress.mark-asset-watched" && !assets.has(action.assetId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "assetId"],
          message: `Unknown asset ${action.assetId}`,
        });
      }
      if (action.kind === "progress.unlock-ending" && !endings.has(action.endingId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "endingId"],
          message: `Unknown ending ${action.endingId}`,
        });
      }
    };

    manifest.graph.nodes.forEach((node, nodeIndex) => {
      const bindings = bindingsFor(node);
      uniqueById(
        bindings,
        (binding) => binding.bindingId,
        ["graph", "nodes", nodeIndex, "eventBindings"],
        context
      );
      bindings.forEach((binding, bindingIndex) => {
        const overlappingIndex = bindings.findIndex(
          (candidate, candidateIndex) =>
            candidateIndex < bindingIndex && eventSelectorsOverlap(candidate.on, binding.on)
        );
        if (overlappingIndex >= 0) {
          context.addIssue({
            code: "custom",
            path: ["graph", "nodes", nodeIndex, "eventBindings", bindingIndex, "on"],
            message: `Event selector overlaps binding ${bindings[overlappingIndex]?.bindingId ?? overlappingIndex} in the same scene`,
          });
        }

        if (binding.on.type === "renderer.outcome") {
          const instance = binding.on.sourceId
            ? rendererInstances.get(binding.on.sourceId)
            : undefined;
          if (!instance || instance.nodeId !== node.sceneId) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", nodeIndex, "eventBindings", bindingIndex, "on", "sourceId"],
              message: "renderer.outcome requires a renderer instance in the same scene",
            });
          } else if (
            !binding.on.qualifierId ||
            !rendererRequirements
              .get(instance.rendererId)
              ?.outcomes.some((outcome) => outcome.outcomeType === binding.on.qualifierId)
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "graph",
                "nodes",
                nodeIndex,
                "eventBindings",
                bindingIndex,
                "on",
                "qualifierId",
              ],
              message: `Renderer ${instance.rendererId} does not declare this outcome`,
            });
          }
        }
        if (binding.on.type.startsWith("gesture.")) {
          const gesture = binding.on.sourceId ? gestures.get(binding.on.sourceId) : undefined;
          if (!gesture || gesture.nodeId !== node.sceneId) {
            context.addIssue({
              code: "custom",
              path: ["graph", "nodes", nodeIndex, "eventBindings", bindingIndex, "on", "sourceId"],
              message: `${binding.on.type} requires a gesture in the same scene`,
            });
          }
        }
        if (binding.on.type === "timeline.cue") {
          const cueExists =
            node.kind === "scene" &&
            binding.on.qualifierId !== undefined &&
            node.timeline.cues.some((cue) => cue.cueId === binding.on.qualifierId);
          if (!cueExists) {
            context.addIssue({
              code: "custom",
              path: [
                "graph",
                "nodes",
                nodeIndex,
                "eventBindings",
                bindingIndex,
                "on",
                "qualifierId",
              ],
              message: "timeline.cue requires a cue from the same scene",
            });
          }
        }
        uniqueById(
          binding.routes,
          (route) => route.routeId,
          ["graph", "nodes", nodeIndex, "eventBindings", bindingIndex, "routes"],
          context
        );
        binding.routes.forEach((route, routeIndex) => {
          if (route.when) {
            validateCondition(
              route.when,
              stateDefinitions,
              [
                "graph",
                "nodes",
                nodeIndex,
                "eventBindings",
                bindingIndex,
                "routes",
                routeIndex,
                "when",
              ],
              context
            );
          }
          route.actions.forEach((action, actionIndex) =>
            validateAction(action, node, [
              "graph",
              "nodes",
              nodeIndex,
              "eventBindings",
              bindingIndex,
              "routes",
              routeIndex,
              "actions",
              actionIndex,
            ])
          );
        });
      });
    });

    const reachable = new Set<string>();
    const pending = [manifest.graph.entrySceneId];
    while (pending.length > 0) {
      const sceneId = pending.pop();
      if (!sceneId || reachable.has(sceneId)) continue;
      reachable.add(sceneId);
      outgoing.get(sceneId)?.forEach((target) => pending.push(target));
    }
    manifest.graph.nodes.forEach((node, nodeIndex) => {
      if (reachable.has(node.sceneId)) return;
      context.addIssue({
        code: "custom",
        path: ["graph", "nodes", nodeIndex, "sceneId"],
        message: `Scene ${node.sceneId} is unreachable from ${manifest.graph.entrySceneId}`,
      });
    });
    if (
      manifest.completionPolicy === "finite" &&
      ![...endingScenes].some((sceneId) => reachable.has(sceneId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["graph", "nodes"],
        message: "Finite experiences must have a reachable ending action",
      });
    }
  }
);

export type ExperienceRuntimeManifest = z.infer<typeof ExperienceRuntimeManifestSchema>;

export function parseExperienceRuntimeManifest(input: unknown): ExperienceRuntimeManifest {
  return ExperienceRuntimeManifestSchema.parse(input);
}

export function safeParseExperienceRuntimeManifest(input: unknown) {
  return ExperienceRuntimeManifestSchema.safeParse(input);
}

export type ExperienceRuntimeManifestDraft = ManifestDraft;
