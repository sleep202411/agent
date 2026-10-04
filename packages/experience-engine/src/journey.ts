import {
  ExperienceJourneyAnchorSchema,
  ExperienceJourneyDeltaSchema,
  ExperienceJourneySchema,
  ExperienceJourneyWatchedMediaSchema,
  ExperienceJourneyAccessRefsSchema,
  ExperienceJourneyPathSchema,
  EXPERIENCE_JOURNEY_MAX_EDGES,
  EXPERIENCE_JOURNEY_MAX_NODES,
  EXPERIENCE_JOURNEY_MAX_ANCHORS,
  EXPERIENCE_JOURNEY_MAX_BYTES,
  EXPERIENCE_JOURNEY_MAX_DELTA_ANCHORS,
  EXPERIENCE_JOURNEY_MAX_DELTA_BYTES,
  ExperienceCoreVideoRendererConfigSchema,
  type ExperienceJourney,
  type ExperienceJourneyAnchor,
  type ExperienceJourneyDelta,
  type ExperienceJourneyEdge,
  type ExperienceJourneyWatchedMedia,
  type ExperienceJourneyAccessRef,
  type ExperienceAccessRequirement,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import { utf8ByteLength } from "@repo/shared/zod-serialized-size";
import {
  restoreExperienceRuntime,
  type ExperienceRuntimeEffect,
  type ExperienceRuntimeRestoreInput,
} from "./runtime.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const signatureCache = new WeakMap<ExperienceRuntimeManifest, string>();
const anchorSizeCache = new WeakMap<ExperienceJourney, number>();
const arraySizeCache = new WeakMap<readonly unknown[], number>();

function isPresentable(manifest: ExperienceRuntimeManifest, sceneId: string): boolean {
  const node = manifest.graph.nodes.find((candidate) => candidate.sceneId === sceneId);
  return node?.kind === "scene" && node.renderers.length > 0;
}

function serializedBytes(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function arrayBytes(values: readonly unknown[]): number {
  const cached = arraySizeCache.get(values);
  if (cached !== undefined) return cached;
  const bytes =
    2 +
    Math.max(0, values.length - 1) +
    values.reduce<number>((sum, value) => sum + serializedBytes(value), 0);
  arraySizeCache.set(values, bytes);
  return bytes;
}

function assertJourneyBudget(journey: ExperienceJourney, anchorBytes: number): void {
  if (
    journey.visitedNodeIds.length > EXPERIENCE_JOURNEY_MAX_NODES ||
    journey.traversedEdges.length > EXPERIENCE_JOURNEY_MAX_EDGES ||
    journey.traversedPaths.length > EXPERIENCE_JOURNEY_MAX_EDGES ||
    journey.watchedMedia.length > EXPERIENCE_JOURNEY_MAX_EDGES ||
    journey.anchors.length > EXPERIENCE_JOURNEY_MAX_ANCHORS ||
    journey.activeAccessRefs.length > EXPERIENCE_JOURNEY_MAX_EDGES
  )
    throw new Error("Story exploration exceeds its record limit.");
  const metadata = {
    version: journey.version,
    signature: journey.signature,
    visitedNodeIds: [],
    traversedEdges: [],
    traversedPaths: [],
    watchedMedia: [],
    activeAccessRefs: [],
  };
  const metadataBytes =
    serializedBytes(metadata) +
    [
      journey.visitedNodeIds,
      journey.traversedEdges,
      journey.traversedPaths,
      journey.watchedMedia,
      journey.activeAccessRefs,
    ].reduce((sum, values) => sum + arrayBytes(values) - 2, 0);
  if (anchorBytes + metadataBytes + 11 > EXPERIENCE_JOURNEY_MAX_BYTES)
    throw new Error("Story exploration exceeds its data limit.");
}

function assertWatchedMedia(
  manifest: ExperienceRuntimeManifest,
  media: ExperienceJourneyWatchedMedia
): void {
  const scene = manifest.graph.nodes.find((node) => node.sceneId === media.sceneId);
  const renderer =
    scene?.kind === "scene"
      ? scene.renderers.find(
          (candidate) =>
            candidate.instanceId === media.rendererInstanceId &&
            candidate.rendererId === "core.video"
        )
      : undefined;
  const config = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer?.config);
  const clip = config.success ? config.data.sequence[media.sequenceIndex] : undefined;
  if (
    !clip ||
    (clip.assetId !== media.assetId &&
      !(clip.endBehavior.behavior === "loop" && clip.endBehavior.assetId === media.assetId)) ||
    !manifest.assets.some((asset) => asset.assetId === media.assetId)
  )
    throw new Error("Saved viewing progress contains an unknown clip.");
}

/** Compatibility identity, never an entitlement or authorization credential. */
export function experienceJourneySignature(manifest: ExperienceRuntimeManifest): string {
  const cached = signatureCache.get(manifest);
  if (cached) return cached;
  const text = canonical({ graph: manifest.graph, stateDefinitions: manifest.stateDefinitions });
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    left = Math.imul(left ^ text.charCodeAt(index), 0x01000193);
    right = Math.imul(right ^ text.charCodeAt(index), 0x85ebca6b);
  }
  const value = `journey-v1:${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
  signatureCache.set(manifest, value);
  return value;
}

export function experienceJourneyEdgeId(edge: ExperienceJourneyEdge): string {
  return JSON.stringify([
    edge.fromSceneId,
    edge.bindingId,
    edge.routeId,
    "toSceneId" in edge ? "scene" : "ending",
    "toSceneId" in edge ? edge.toSceneId : edge.toEndingId,
  ]);
}

/** @ is forbidden in real scene IDs, keeping synthetic endings collision-free. */
export function experienceJourneyEndingNodeId(endingId: string): string {
  return `@ending:${endingId}`;
}

export function experienceJourneyMediaSignature(
  manifest: ExperienceRuntimeManifest,
  assetId: string
): string {
  const asset = manifest.assets.find((candidate) => candidate.assetId === assetId);
  let identity: unknown = asset ?? null;
  if (asset?.kind === "video")
    identity = {
      ...asset,
      variants: asset.variants.map(({ uri, ...variant }) => ({
        ...variant,
        ...(variant.sha256 ? {} : { uri }),
      })),
    };
  else if (asset && "sha256" in asset && asset.sha256 && "uri" in asset) {
    const { uri: _uri, ...bytesIdentity } = asset;
    identity = bytesIdentity;
  }
  let hash = 2166136261;
  const text = JSON.stringify(identity);
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

export function experienceJourneyWatchedMediaId(media: ExperienceJourneyWatchedMedia): string {
  return JSON.stringify([
    media.sceneId,
    media.rendererInstanceId,
    media.sequenceIndex,
    media.assetId,
    media.mediaSignature,
  ]);
}

function pathId(path: readonly ExperienceJourneyEdge[]): string {
  return JSON.stringify(path.map(experienceJourneyEdgeId));
}

function accessRefId(ref: ExperienceJourneyAccessRef): string {
  return JSON.stringify(
    ref.kind === "node" ? ["node", ref.sceneId] : ["route", ref.sceneId, ref.bindingId, ref.routeId]
  );
}

function resolveAccessRef(
  manifest: ExperienceRuntimeManifest,
  ref: ExperienceJourneyAccessRef
): ExperienceAccessRequirement | undefined {
  const node = manifest.graph.nodes.find((candidate) => candidate.sceneId === ref.sceneId);
  if (!node) throw new Error("Saved access boundary names an unknown scene.");
  if (ref.kind === "node") return node.access;
  const route = node.eventBindings
    .find((binding) => binding.bindingId === ref.bindingId)
    ?.routes.find((candidate) => candidate.routeId === ref.routeId);
  if (!route) throw new Error("Saved access boundary names an unknown route.");
  return route.access;
}

/** Resolve identifiers against the live manifest, never persisted entitlement values. */
export function getExperienceJourneyReplayAccess(
  manifest: ExperienceRuntimeManifest,
  journey: ExperienceJourney,
  sceneId: string
): ExperienceAccessRequirement[] {
  const anchor = journey.anchors.find((candidate) => candidate.sceneId === sceneId);
  if (!anchor || !journey.visitedNodeIds.includes(sceneId))
    throw new Error("This story node has no replayable entry save.");
  const requirements = new Map<string, ExperienceAccessRequirement>();
  for (const ref of [...anchor.requiredAccessRefs, { kind: "node" as const, sceneId }]) {
    const requirement = resolveAccessRef(manifest, ref);
    if (requirement) requirements.set(requirement.key, requirement);
  }
  return [...requirements.values()];
}

export function getExperienceJourneyActiveAccess(
  manifest: ExperienceRuntimeManifest,
  journey: ExperienceJourney
): ExperienceAccessRequirement[] {
  const requirements = new Map<string, ExperienceAccessRequirement>();
  for (const ref of journey.activeAccessRefs) {
    const requirement = resolveAccessRef(manifest, ref);
    if (requirement) requirements.set(requirement.key, requirement);
  }
  return [...requirements.values()];
}

/** Rewind current requirements while retaining exploration and other entry saves. */
export function rewindExperienceJourney(
  journey: ExperienceJourney,
  sceneId: string
): ExperienceJourney {
  const anchor = journey.anchors.find((candidate) => candidate.sceneId === sceneId);
  if (!anchor || !journey.visitedNodeIds.includes(sceneId))
    throw new Error("This story node has no replayable entry save.");
  const next = { ...journey, activeAccessRefs: anchor.requiredAccessRefs };
  const bytes = anchorSizeCache.get(journey);
  if (bytes !== undefined) anchorSizeCache.set(next, bytes);
  return next;
}

function graphEdges(manifest: ExperienceRuntimeManifest): ExperienceJourneyEdge[] {
  return manifest.graph.nodes.flatMap((node) =>
    node.eventBindings.flatMap((binding) =>
      binding.routes.flatMap((route) =>
        route.actions.flatMap((action): ExperienceJourneyEdge[] => {
          const source = {
            fromSceneId: node.sceneId,
            bindingId: binding.bindingId,
            routeId: route.routeId,
          };
          if (action.kind === "scene.goto") return [{ ...source, toSceneId: action.sceneId }];
          if (action.kind === "ending.complete")
            return [{ ...source, toEndingId: action.endingId }];
          return [];
        })
      )
    )
  );
}

export function createExperienceJourney(manifest: ExperienceRuntimeManifest): ExperienceJourney {
  const journey: ExperienceJourney = {
    version: 1,
    signature: experienceJourneySignature(manifest),
    visitedNodeIds: [],
    traversedEdges: [],
    traversedPaths: [],
    watchedMedia: [],
    activeAccessRefs: [],
    anchors: [],
  };
  anchorSizeCache.set(journey, 2);
  return journey;
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string): void {
  if (new Set(items.map(key)).size !== items.length)
    throw new Error("Journey contains duplicate records.");
}

/** Validate entry state without executing actions, and reject incompatible builds. */
export function validateExperienceJourney(
  manifest: ExperienceRuntimeManifest,
  value: unknown
): ExperienceJourney {
  const journey = ExperienceJourneySchema.parse(value);
  if (journey.signature !== experienceJourneySignature(manifest))
    throw new Error("Saved story exploration no longer matches this story.");
  assertUnique(journey.visitedNodeIds, (id) => id);
  assertUnique(journey.traversedEdges, experienceJourneyEdgeId);
  assertUnique(journey.traversedPaths, pathId);
  assertUnique(journey.watchedMedia, experienceJourneyWatchedMediaId);
  assertUnique(journey.anchors, (anchor) => anchor.sceneId);
  const nodeIds = new Set(manifest.graph.nodes.map((node) => node.sceneId));
  const endingIds = new Set(manifest.endings.map((ending) => ending.endingId));
  const allowedEdges = new Set(graphEdges(manifest).map(experienceJourneyEdgeId));
  const recordedEdges = new Set(journey.traversedEdges.map(experienceJourneyEdgeId));
  const visited = new Set(journey.visitedNodeIds);
  for (const id of visited) if (!nodeIds.has(id)) throw new Error(`Unknown explored scene ${id}.`);
  for (const edge of journey.traversedEdges) {
    if (
      !allowedEdges.has(experienceJourneyEdgeId(edge)) ||
      !visited.has(edge.fromSceneId) ||
      ("toSceneId" in edge && !visited.has(edge.toSceneId))
    )
      throw new Error("Saved exploration contains an unknown route.");
  }
  for (const path of journey.traversedPaths) {
    path.forEach((edge, index) => {
      const previous = path[index - 1];
      if (
        !recordedEdges.has(experienceJourneyEdgeId(edge)) ||
        (previous && (!("toSceneId" in previous) || previous.toSceneId !== edge.fromSceneId))
      )
        throw new Error("Saved exploration contains a disconnected path.");
    });
  }
  const assertAccessRefs = (refs: ExperienceJourneyAccessRef[]) => {
    assertUnique(refs, accessRefId);
    for (const ref of refs) {
      if (!visited.has(ref.sceneId) || !resolveAccessRef(manifest, ref))
        throw new Error("Saved entry references an unexplored access boundary.");
      if (ref.kind === "route") {
        const route = manifest.graph.nodes
          .find((node) => node.sceneId === ref.sceneId)
          ?.eventBindings.find((binding) => binding.bindingId === ref.bindingId)
          ?.routes.find((candidate) => candidate.routeId === ref.routeId);
        if (
          route?.actions.some(
            (action) => action.kind === "scene.goto" || action.kind === "ending.complete"
          ) &&
          !journey.traversedEdges.some(
            (edge) =>
              edge.fromSceneId === ref.sceneId &&
              edge.bindingId === ref.bindingId &&
              edge.routeId === ref.routeId
          )
        )
          throw new Error("Saved entry references an unexplored access boundary.");
      }
    }
  };
  assertAccessRefs(journey.activeAccessRefs);
  for (const anchor of journey.anchors) {
    const scene = manifest.graph.nodes.find((node) => node.sceneId === anchor.sceneId);
    if (
      !scene ||
      scene.kind !== "scene" ||
      !visited.has(anchor.sceneId) ||
      anchor.state.currentSceneId !== anchor.sceneId ||
      anchor.state.status !== "active" ||
      Object.hasOwn(anchor.state, "journey") ||
      (anchor.playback && Object.hasOwn(anchor.playback, "journey"))
    )
      throw new Error("Saved story entry is invalid.");
    const state = restoreExperienceRuntime(
      manifest,
      anchor.state as unknown as ExperienceRuntimeRestoreInput
    );
    assertAccessRefs(anchor.requiredAccessRefs);
    if (
      state.watchedAssetIds.some((id) => !manifest.assets.some((asset) => asset.assetId === id)) ||
      [...state.unlockedEndingIds, ...state.completedEndingIds].some((id) => !endingIds.has(id))
    )
      throw new Error("Saved story entry contains unknown progress.");
    for (const event of anchor.events) {
      if (
        typeof event.type !== "string" ||
        !event.type ||
        (event.sourceId !== undefined && typeof event.sourceId !== "string") ||
        (event.qualifierId !== undefined && typeof event.qualifierId !== "string")
      )
        throw new Error("Saved story entry contains an invalid event.");
    }
  }
  for (const media of journey.watchedMedia) {
    const scene = manifest.graph.nodes.find((node) => node.sceneId === media.sceneId);
    if (
      !scene ||
      scene.kind !== "scene" ||
      !visited.has(media.sceneId) ||
      !scene.renderers.some((renderer) => renderer.instanceId === media.rendererInstanceId) ||
      !manifest.assets.some((asset) => asset.assetId === media.assetId)
    )
      throw new Error("Saved viewing progress contains an unknown scene or asset.");
    assertWatchedMedia(manifest, media);
  }
  const cloned = structuredClone(journey);
  anchorSizeCache.set(cloned, serializedBytes(cloned.anchors));
  return cloned;
}

function upsertMedia(
  base: readonly ExperienceJourneyWatchedMedia[],
  changes: readonly ExperienceJourneyWatchedMedia[]
): ExperienceJourneyWatchedMedia[] {
  if (!changes.length) return base as ExperienceJourneyWatchedMedia[];
  const values = new Map(base.map((media) => [experienceJourneyWatchedMediaId(media), media]));
  for (const media of changes) {
    const key = experienceJourneyWatchedMediaId(media);
    const previous = values.get(key);
    if (!previous || previous.watchedUntilMs < media.watchedUntilMs) values.set(key, media);
  }
  return [...values.values()];
}

function unique<T>(base: readonly T[], changes: readonly T[], key: (item: T) => string): T[] {
  if (!changes.length) return base as T[];
  const existing = new Set(base.map(key));
  if (changes.every((item) => existing.has(key(item)))) return base as T[];
  return [...new Map([...base, ...changes].map((item) => [key(item), item])).values()];
}

/** Called only with a successfully committed queue; refused routes have no result. */
export function recordExperienceJourney(
  manifest: ExperienceRuntimeManifest,
  journey: ExperienceJourney,
  input: {
    sceneId?: string;
    effects?: readonly ExperienceRuntimeEffect[];
    anchor?: ExperienceJourneyAnchor;
    watchedMedia?: readonly ExperienceJourneyWatchedMedia[];
  }
): ExperienceJourney {
  if (journey.signature !== experienceJourneySignature(manifest))
    throw new Error("Story exploration signature changed.");
  const edges: ExperienceJourneyEdge[] = [];
  for (const effect of input.effects ?? []) {
    if (effect.kind === "scene.changed")
      edges.push({
        fromSceneId: effect.fromSceneId,
        bindingId: effect.bindingId,
        routeId: effect.routeId,
        toSceneId: effect.toSceneId,
      });
    if (effect.kind === "ending.completed")
      edges.push({
        fromSceneId: effect.fromSceneId,
        bindingId: effect.bindingId,
        routeId: effect.routeId,
        toEndingId: effect.endingId,
      });
  }
  const paths: ExperienceJourneyEdge[][] = [];
  let current: ExperienceJourneyEdge[] = [];
  for (const edge of edges) {
    const previous = current.at(-1);
    if (
      previous &&
      (!("toSceneId" in previous) ||
        previous.toSceneId !== edge.fromSceneId ||
        isPresentable(manifest, edge.fromSceneId))
    ) {
      paths.push(current);
      current = [];
    }
    current.push(edge);
  }
  if (current.length) paths.push(current);
  const visited = edges.flatMap((edge) =>
    "toSceneId" in edge ? [edge.fromSceneId, edge.toSceneId] : [edge.fromSceneId]
  );
  const checkedRefs = (input.effects ?? []).flatMap((effect) =>
    effect.kind === "access.checked" ? [effect.ref] : []
  );
  let activeAccessRefs = checkedRefs.length
    ? ExperienceJourneyAccessRefsSchema.parse(
        unique(journey.activeAccessRefs, checkedRefs, accessRefId)
      )
    : journey.activeAccessRefs;
  visited.push(...checkedRefs.map((ref) => ref.sceneId));
  if (input.sceneId) visited.push(input.sceneId);
  const anchors = new Map(journey.anchors.map((anchor) => [anchor.sceneId, anchor]));
  let anchorBytes = anchorSizeCache.get(journey) ?? serializedBytes(journey.anchors);
  let anchorChanged = false;
  if (input.anchor) {
    const rawAnchor = ExperienceJourneyAnchorSchema.parse(input.anchor);
    const refs: ExperienceJourneyAccessRef[] = [
      ...activeAccessRefs,
      ...rawAnchor.requiredAccessRefs,
    ];
    for (const edge of edges) {
      for (const id of [edge.fromSceneId, ...("toSceneId" in edge ? [edge.toSceneId] : [])])
        if (manifest.graph.nodes.find((node) => node.sceneId === id)?.access)
          refs.push({ kind: "node", sceneId: id });
      const ref: ExperienceJourneyAccessRef = {
        kind: "route",
        sceneId: edge.fromSceneId,
        bindingId: edge.bindingId,
        routeId: edge.routeId,
      };
      if (resolveAccessRef(manifest, ref)) refs.push(ref);
    }
    if (manifest.graph.nodes.find((node) => node.sceneId === rawAnchor.sceneId)?.access)
      refs.push({ kind: "node", sceneId: rawAnchor.sceneId });
    activeAccessRefs = ExperienceJourneyAccessRefsSchema.parse(unique([], refs, accessRefId));
    const anchor = ExperienceJourneyAnchorSchema.parse({
      ...rawAnchor,
      requiredAccessRefs: activeAccessRefs,
    });
    if (
      !isPresentable(manifest, anchor.sceneId) ||
      anchor.state.currentSceneId !== anchor.sceneId ||
      anchor.state.status !== "active" ||
      Object.hasOwn(anchor.state, "journey") ||
      (anchor.playback && Object.hasOwn(anchor.playback, "journey"))
    )
      throw new Error("Saved story entry is invalid.");
    restoreExperienceRuntime(manifest, anchor.state as unknown as ExperienceRuntimeRestoreInput);
    visited.push(anchor.sceneId);
    const previous = anchors.get(anchor.sceneId);
    if (!previous || canonical(previous) !== canonical(anchor)) {
      anchorBytes +=
        serializedBytes(anchor) -
        (previous ? serializedBytes(previous) : -Number(anchors.size > 0));
      anchors.set(anchor.sceneId, structuredClone(anchor));
      anchorChanged = true;
    }
  }
  const mediaChanges: ExperienceJourneyWatchedMedia[] = [];
  for (const candidate of input.watchedMedia ?? []) {
    const media = ExperienceJourneyWatchedMediaSchema.parse(candidate);
    const previous = journey.watchedMedia.find(
      (entry) => experienceJourneyWatchedMediaId(entry) === experienceJourneyWatchedMediaId(media)
    );
    if (previous && previous.watchedUntilMs >= media.watchedUntilMs) continue;
    assertWatchedMedia(manifest, media);
    if (media.mediaSignature !== experienceJourneyMediaSignature(manifest, media.assetId))
      throw new Error("Viewing progress no longer matches this clip.");
    visited.push(media.sceneId);
    mediaChanges.push(media);
  }
  const next = {
    ...journey,
    visitedNodeIds: unique(journey.visitedNodeIds, visited, (id) => id),
    traversedEdges: unique(journey.traversedEdges, edges, experienceJourneyEdgeId),
    traversedPaths: unique(
      journey.traversedPaths,
      paths.map((path) => ExperienceJourneyPathSchema.parse(path)),
      pathId
    ),
    watchedMedia: mediaChanges.length
      ? upsertMedia(journey.watchedMedia, mediaChanges)
      : journey.watchedMedia,
    anchors: anchorChanged ? [...anchors.values()] : journey.anchors,
    activeAccessRefs,
  };
  if (
    !anchorChanged &&
    !mediaChanges.length &&
    activeAccessRefs.length === journey.activeAccessRefs.length &&
    next.visitedNodeIds.length === journey.visitedNodeIds.length &&
    next.traversedEdges.length === journey.traversedEdges.length &&
    next.traversedPaths.length === journey.traversedPaths.length
  )
    return journey;
  assertJourneyBudget(next, anchorBytes);
  anchorSizeCache.set(next, anchorBytes);
  return next;
}

/** Next bounded upload chunk. Apply its acknowledgement, then diff again. */
export function diffExperienceJourney(
  base: ExperienceJourney | null | undefined,
  next: ExperienceJourney
): ExperienceJourneyDelta | undefined {
  const previous = base?.signature === next.signature ? base : undefined;
  const nodes = new Set(previous?.visitedNodeIds);
  const edges = new Set(previous?.traversedEdges.map(experienceJourneyEdgeId));
  const paths = new Set(previous?.traversedPaths.map(pathId));
  const media = new Map(
    previous?.watchedMedia.map((entry) => [
      experienceJourneyWatchedMediaId(entry),
      entry.watchedUntilMs,
    ])
  );
  const anchors = new Map(previous?.anchors.map((anchor) => [anchor.sceneId, anchor]));
  const changes = {
    version: 1 as const,
    signature: next.signature,
    addedVisitedNodeIds: next.visitedNodeIds.filter((id) => !nodes.has(id)),
    addedTraversedEdges: next.traversedEdges.filter(
      (edge) => !edges.has(experienceJourneyEdgeId(edge))
    ),
    addedTraversedPaths: next.traversedPaths.filter((path) => !paths.has(pathId(path))),
    addedWatchedMedia: next.watchedMedia.filter(
      (entry) => entry.watchedUntilMs > (media.get(experienceJourneyWatchedMediaId(entry)) ?? -1)
    ),
    anchors: next.anchors.filter((anchor) => {
      const old = anchors.get(anchor.sceneId);
      return old !== anchor && (!old || canonical(old) !== canonical(anchor));
    }),
    ...(previous && canonical(previous.activeAccessRefs) === canonical(next.activeAccessRefs)
      ? {}
      : { activeAccessRefs: next.activeAccessRefs }),
  };
  if (
    previous &&
    !changes.addedVisitedNodeIds.length &&
    !changes.addedTraversedEdges.length &&
    !changes.addedTraversedPaths.length &&
    !changes.addedWatchedMedia.length &&
    !changes.anchors.length &&
    !changes.activeAccessRefs
  )
    return undefined;
  const delta: ExperienceJourneyDelta = {
    version: 1,
    signature: next.signature,
    addedVisitedNodeIds: [],
    addedTraversedEdges: [],
    addedTraversedPaths: [],
    addedWatchedMedia: [],
    anchors: [],
    ...(changes.activeAccessRefs ? { activeAccessRefs: changes.activeAccessRefs } : {}),
  };
  let bytes = serializedBytes(delta);
  function append<T>(values: T[], value: T, maxCount: number): boolean {
    const addition = serializedBytes(value) + Number(values.length > 0);
    if (values.length >= maxCount || bytes + addition > EXPERIENCE_JOURNEY_MAX_DELTA_BYTES)
      return false;
    values.push(value);
    bytes += addition;
    return true;
  }
  const includedNodes = new Set(previous?.visitedNodeIds);
  const includedEdges = new Set(previous?.traversedEdges.map(experienceJourneyEdgeId));
  const addNode = (id: string) => {
    if (includedNodes.has(id)) return true;
    if (!append(delta.addedVisitedNodeIds, id, EXPERIENCE_JOURNEY_MAX_NODES)) return false;
    includedNodes.add(id);
    return true;
  };
  const addEdge = (edge: ExperienceJourneyEdge) => {
    const id = experienceJourneyEdgeId(edge);
    if (includedEdges.has(id)) return true;
    if (
      !includedNodes.has(edge.fromSceneId) ||
      ("toSceneId" in edge && !includedNodes.has(edge.toSceneId)) ||
      !append(delta.addedTraversedEdges, edge, EXPERIENCE_JOURNEY_MAX_EDGES)
    )
      return false;
    includedEdges.add(id);
    return true;
  };
  // Preserve first-visit order. The bounded ID list fits alongside the
  // current gate chain and its route dependencies in one update.
  for (const id of changes.addedVisitedNodeIds) addNode(id);
  // Current branch gates travel first, including their graph dependencies.
  // An interrupted upload must never leave a current public node ungated.
  for (const ref of changes.activeAccessRefs ?? []) {
    if (!addNode(ref.sceneId))
      throw new Error("Current access boundaries exceed the update limit.");
    if (ref.kind === "route")
      for (const edge of next.traversedEdges.filter(
        (candidate) =>
          candidate.fromSceneId === ref.sceneId &&
          candidate.bindingId === ref.bindingId &&
          candidate.routeId === ref.routeId
      )) {
        if (("toSceneId" in edge && !addNode(edge.toSceneId)) || !addEdge(edge))
          throw new Error("Current access boundaries exceed the update limit.");
      }
  }
  for (const edge of changes.addedTraversedEdges) addEdge(edge);
  for (const path of changes.addedTraversedPaths)
    if (path.every((edge) => includedEdges.has(experienceJourneyEdgeId(edge))))
      append(delta.addedTraversedPaths, path, EXPERIENCE_JOURNEY_MAX_EDGES);
  for (const media of changes.addedWatchedMedia)
    if (includedNodes.has(media.sceneId))
      append(delta.addedWatchedMedia, media, EXPERIENCE_JOURNEY_MAX_EDGES);
  for (const anchor of changes.anchors)
    if (
      includedNodes.has(anchor.sceneId) &&
      anchor.requiredAccessRefs.every(
        (ref) =>
          includedNodes.has(ref.sceneId) &&
          (ref.kind !== "route" ||
            next.traversedEdges
              .filter(
                (edge) =>
                  edge.fromSceneId === ref.sceneId &&
                  edge.bindingId === ref.bindingId &&
                  edge.routeId === ref.routeId
              )
              .every((edge) => includedEdges.has(experienceJourneyEdgeId(edge))))
      )
    )
      append(delta.anchors, anchor, EXPERIENCE_JOURNEY_MAX_DELTA_ANCHORS);
  if (
    previous &&
    !delta.activeAccessRefs &&
    !delta.addedVisitedNodeIds.length &&
    !delta.addedTraversedEdges.length &&
    !delta.addedTraversedPaths.length &&
    !delta.addedWatchedMedia.length &&
    !delta.anchors.length
  )
    throw new Error("An exploration record exceeds the update limit.");
  return ExperienceJourneyDeltaSchema.parse(delta);
}

export function applyExperienceJourneyDelta(
  base: ExperienceJourney | null | undefined,
  value: ExperienceJourneyDelta,
  options: { resetOnSignatureChange?: boolean } = {}
): ExperienceJourney {
  const delta = ExperienceJourneyDeltaSchema.parse(structuredClone(value));
  if (base && base.signature !== delta.signature && !options.resetOnSignatureChange)
    throw new Error("Story exploration signature changed.");
  const previous =
    base?.signature === delta.signature
      ? base
      : {
          version: 1 as const,
          signature: delta.signature,
          visitedNodeIds: [],
          traversedEdges: [],
          traversedPaths: [],
          watchedMedia: [],
          activeAccessRefs: [],
          anchors: [],
        };
  const anchors = new Map(previous.anchors.map((anchor) => [anchor.sceneId, anchor]));
  let anchorBytes = anchorSizeCache.get(previous) ?? arrayBytes(previous.anchors);
  for (const anchor of delta.anchors) {
    const old = anchors.get(anchor.sceneId);
    anchorBytes +=
      serializedBytes(anchor) - (old ? serializedBytes(old) : -Number(anchors.size > 0));
    anchors.set(anchor.sceneId, anchor);
  }
  const next = {
    ...previous,
    visitedNodeIds: unique(previous.visitedNodeIds, delta.addedVisitedNodeIds, (id) => id),
    traversedEdges: unique(
      previous.traversedEdges,
      delta.addedTraversedEdges,
      experienceJourneyEdgeId
    ),
    traversedPaths: unique(previous.traversedPaths, delta.addedTraversedPaths, pathId),
    watchedMedia: upsertMedia(previous.watchedMedia, delta.addedWatchedMedia),
    activeAccessRefs: delta.activeAccessRefs ?? previous.activeAccessRefs,
    anchors: delta.anchors.length ? [...anchors.values()] : previous.anchors,
  };
  assertJourneyBudget(next, anchorBytes);
  anchorSizeCache.set(next, anchorBytes);
  return next;
}

export interface ExperienceJourneyMapNode {
  sceneId: string;
  kind: "scene" | "ending";
  visited: boolean;
  replayable: boolean;
}
export interface ExperienceJourneyMapEdge {
  edgeId: string;
  fromSceneId: string;
  toSceneId: string;
  traversed: boolean;
  segments: ExperienceJourneyEdge[];
}
export interface ExperienceJourneyMapGraph {
  nodes: ExperienceJourneyMapNode[];
  edges: ExperienceJourneyMapEdge[];
  truncated: boolean;
}

/** Routers are hidden without turning condition truth into exploration history. */
export function projectExperienceJourneyGraph(
  manifest: ExperienceRuntimeManifest,
  journey: ExperienceJourney
): ExperienceJourneyMapGraph {
  const visited = new Set(journey.visitedNodeIds);
  const anchors = new Set(journey.anchors.map((anchor) => anchor.sceneId));
  const traversed = new Set(
    journey.traversedPaths.map((path) => {
      const contracted: ExperienceJourneyEdge[] = [];
      const positions = new Map<string, number>();
      for (const edge of path) {
        contracted.push(edge);
        if (!("toSceneId" in edge) || isPresentable(manifest, edge.toSceneId)) continue;
        const previousPosition = positions.get(edge.toSceneId);
        if (previousPosition !== undefined) {
          contracted.splice(previousPosition);
          for (const [id, position] of positions)
            if (position > previousPosition) positions.delete(id);
        } else positions.set(edge.toSceneId, contracted.length);
      }
      return pathId(contracted);
    })
  );
  const rawEdges = graphEdges(manifest);
  const nodes: ExperienceJourneyMapNode[] = manifest.graph.nodes
    .filter((node) => isPresentable(manifest, node.sceneId))
    .map((node) => ({
      sceneId: node.sceneId,
      kind: "scene",
      visited: visited.has(node.sceneId),
      replayable: visited.has(node.sceneId) && anchors.has(node.sceneId),
    }));
  for (const ending of manifest.endings)
    nodes.push({
      sceneId: experienceJourneyEndingNodeId(ending.endingId),
      kind: "ending",
      visited: journey.traversedEdges.some(
        (edge) => "toEndingId" in edge && edge.toEndingId === ending.endingId
      ),
      replayable: false,
    });
  const edges: ExperienceJourneyMapEdge[] = [];
  let truncated = false;
  for (const node of nodes.filter((candidate) => candidate.kind === "scene")) {
    const pending = rawEdges
      .filter((edge) => edge.fromSceneId === node.sceneId)
      .map((edge) => ({ path: [edge], routers: new Set<string>() }));
    let budget = EXPERIENCE_JOURNEY_MAX_EDGES;
    while (pending.length && budget-- > 0 && edges.length < EXPERIENCE_JOURNEY_MAX_EDGES) {
      const { path, routers } = pending.pop()!;
      const last = path.at(-1)!;
      const target =
        "toSceneId" in last
          ? manifest.graph.nodes.find((candidate) => candidate.sceneId === last.toSceneId)
          : undefined;
      if (target && !isPresentable(manifest, target.sceneId)) {
        if (routers.has(target.sceneId)) continue;
        const nextRouters = new Set([...routers, target.sceneId]);
        for (const next of rawEdges.filter((edge) => edge.fromSceneId === target.sceneId))
          pending.push({ path: [...path, next], routers: nextRouters });
      } else {
        const toSceneId =
          "toSceneId" in last ? last.toSceneId : experienceJourneyEndingNodeId(last.toEndingId);
        edges.push({
          edgeId: pathId(path),
          fromSceneId: node.sceneId,
          toSceneId,
          traversed: traversed.has(pathId(path)),
          segments: path,
        });
      }
    }
    if (pending.length) truncated = true;
  }
  return { nodes, edges, truncated };
}
