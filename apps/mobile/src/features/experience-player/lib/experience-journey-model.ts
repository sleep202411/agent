import {
  ExperienceJourneyAnchorSchema,
  type ExperienceJourney,
  type ExperienceJourneyAnchor,
  type ExperienceJsonObject,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  ExperienceAccessRequiredError,
  restoreExperienceRuntime,
  validateExperienceJourney,
  getExperienceJourneyReplayAccess,
  type ExperienceAccessCheck,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeRestoreInput,
  type ExperienceRuntimeState,
} from "@repo/experience-engine";
import {
  validateExperiencePlaybackCheckpoint,
  type ExperiencePlaybackCheckpoint,
} from "./experience-playback-checkpoint";

export {
  applyExperienceJourneyDelta,
  createExperienceJourney,
  diffExperienceJourney,
  experienceJourneySignature,
  experienceJourneyEdgeId,
  experienceJourneyEndingNodeId,
  experienceJourneyMediaSignature,
  getExperienceJourneyReplayAccess,
  getExperienceJourneyActiveAccess,
  rewindExperienceJourney,
  experienceJourneyWatchedMediaId,
  projectExperienceJourneyGraph,
  recordExperienceJourney,
  validateExperienceJourney,
  type ExperienceJourneyMapNode,
  type ExperienceJourneyMapEdge,
  type ExperienceJourneyMapGraph,
} from "@repo/experience-engine";
export type {
  ExperienceJourney,
  ExperienceJourneyAnchor,
  ExperienceJourneyDelta,
  ExperienceJourneyWatchedMedia,
} from "@repo/shared/experience-runtime";

export interface ExperienceJourneyEntryCheckpoint {
  state: ExperienceRuntimeState;
  events: ExperienceRuntimeEvent[];
  playback?: ExperiencePlaybackCheckpoint;
}

function validateEntry(
  manifest: ExperienceRuntimeManifest,
  value: ExperienceJourneyAnchor
): ExperienceJourneyEntryCheckpoint {
  const anchor = ExperienceJourneyAnchorSchema.parse(value);
  const scene = manifest.graph.nodes.find((node) => node.sceneId === anchor.sceneId);
  if (
    !scene ||
    scene.kind !== "scene" ||
    anchor.state.currentSceneId !== scene.sceneId ||
    anchor.state.status !== "active" ||
    Object.hasOwn(anchor.state, "journey") ||
    (anchor.playback && Object.hasOwn(anchor.playback, "journey"))
  )
    throw new Error("Saved story entry is invalid.");
  const state = restoreExperienceRuntime(
    manifest,
    anchor.state as unknown as ExperienceRuntimeRestoreInput
  );
  for (const event of anchor.events) {
    if (
      typeof event.type !== "string" ||
      !event.type ||
      (event.sourceId !== undefined && typeof event.sourceId !== "string") ||
      (event.qualifierId !== undefined && typeof event.qualifierId !== "string") ||
      [event.payload, event.context].some(
        (payload) =>
          payload !== undefined &&
          (typeof payload !== "object" || payload === null || Array.isArray(payload))
      )
    )
      throw new Error("Saved story entry contains an invalid event.");
  }
  const playback = validateExperiencePlaybackCheckpoint(manifest, scene.sceneId, anchor.playback);
  return {
    state,
    events: structuredClone(anchor.events) as unknown as ExperienceRuntimeEvent[],
    ...(playback ? { playback } : {}),
  };
}

/** Pick checkpoint fields explicitly: storing its journey would recurse. */
export function createExperienceJourneyAnchor(
  manifest: ExperienceRuntimeManifest,
  input: {
    state: ExperienceRuntimeState;
    events: readonly ExperienceRuntimeEvent[];
    playback?: ExperiencePlaybackCheckpoint;
  }
): ExperienceJourneyAnchor {
  const state = restoreExperienceRuntime(manifest, input.state);
  const anchor = ExperienceJourneyAnchorSchema.parse({
    sceneId: state.currentSceneId,
    state: state as unknown as ExperienceJsonObject,
    events: input.events as unknown as ExperienceJsonObject[],
    ...(input.playback ? { playback: input.playback as unknown as ExperienceJsonObject } : {}),
  });
  validateEntry(manifest, anchor);
  return structuredClone(anchor);
}

/** Recheck current access; previously explored never means currently entitled. */
export function restoreExperienceJourneyAnchor(
  manifest: ExperienceRuntimeManifest,
  journey: ExperienceJourney,
  sceneId: string,
  options: {
    canAccess?: ExperienceAccessCheck;
    watchedAssetIds?: readonly string[];
  } = {}
): ExperienceJourneyEntryCheckpoint {
  const valid = validateExperienceJourney(manifest, journey);
  const anchor = valid.anchors.find((entry) => entry.sceneId === sceneId);
  if (!anchor || !valid.visitedNodeIds.includes(sceneId))
    throw new Error("This story node has no replayable entry save.");
  const scene = manifest.graph.nodes.find((node) => node.sceneId === sceneId);
  if (!scene || scene.kind !== "scene") throw new Error("This story node cannot be replayed.");
  for (const requirement of getExperienceJourneyReplayAccess(manifest, valid, sceneId)) {
    if (!options.canAccess?.(requirement)) throw new ExperienceAccessRequiredError(requirement);
  }
  const checkpoint = validateEntry(manifest, anchor);
  if (options.watchedAssetIds) {
    const assets = new Set(manifest.assets.map((asset) => asset.assetId));
    if (options.watchedAssetIds.some((id) => !assets.has(id)))
      throw new Error("Saved viewing progress contains an unknown asset.");
    checkpoint.state.watchedAssetIds = [
      ...new Set([...checkpoint.state.watchedAssetIds, ...options.watchedAssetIds]),
    ];
  }
  return checkpoint;
}
