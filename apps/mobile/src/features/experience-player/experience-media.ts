import type {
  ExperienceCoreVideoRendererConfig,
  ExperienceGraphNode,
  ExperienceImageAsset,
  ExperienceOrientation,
  ExperienceRuntimeAsset,
  ExperienceRuntimeManifest,
  ExperienceVideoAsset,
} from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  ExperienceCoreVideoRendererConfigSchema,
} from "@repo/shared/experience-runtime";

import { resolveExperienceAssetUrl } from "@/config";

/** Cinematic interactive films play in landscape on mobile. */
export const EXPERIENCE_PLAY_ORIENTATION: ExperienceOrientation = "landscape";

const PLAYABLE_URL_CACHE = new Map<string, string>();
const RESOLVE_TIMEOUT_MS = 15_000;

export function absolutizeExperienceMediaUri(uri: string): string | undefined {
  const resolved = resolveExperienceAssetUrl(uri.trim());
  return resolved || undefined;
}

/**
 * Aurora `/story-projects/.../content` returns 302 → signed OSS.
 * Browsers follow that for `<video>`; AVPlayer often hangs/times out on the
 * API hop. Resolve to the final URL once, then cache.
 */
export async function resolvePlayableMediaUrl(uri: string, signal?: AbortSignal): Promise<string> {
  const absolute = absolutizeExperienceMediaUri(uri);
  if (!absolute) {
    throw new Error("Invalid media URI");
  }
  if (!isAuroraBuildContentUrl(absolute)) {
    return absolute;
  }

  const cached = PLAYABLE_URL_CACHE.get(absolute);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(absolute, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Media unavailable (${response.status})`);
    }

    const playable = (response.url || absolute).trim();
    PLAYABLE_URL_CACHE.set(absolute, playable);

    // Drop the probe body — we only needed the redirected Location / final URL.
    try {
      await response.body?.cancel?.();
    } catch {
      // ignore
    }

    return playable;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Media request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function isAuroraBuildContentUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return pathname.includes("/story-projects/") && pathname.endsWith("/content");
  } catch {
    return false;
  }
}

export function resolveVideoMedia(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): { asset: ExperienceVideoAsset; variant: ExperienceVideoAsset["variants"][number] } | null {
  const asset = assets.find(
    (candidate): candidate is ExperienceVideoAsset =>
      candidate.assetId === assetId && candidate.kind === "video"
  );
  if (!asset) return null;
  const variant =
    asset.variants.find((candidate) => candidate.orientation === orientation) ?? asset.variants[0];
  if (!variant) return null;
  const absoluteUri = absolutizeExperienceMediaUri(variant.uri);
  if (!absoluteUri) return null;
  return {
    asset,
    variant: { ...variant, uri: absoluteUri },
  };
}

export function resolveImageUri(
  assets: readonly ExperienceRuntimeAsset[],
  assetId: string,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): string | undefined {
  const asset = assets.find(
    (candidate): candidate is ExperienceImageAsset =>
      candidate.assetId === assetId && candidate.kind === "image"
  );
  if (!asset) return undefined;
  const raw =
    asset.variants.find((candidate) => candidate.orientation === orientation)?.uri ??
    asset.variants[0]?.uri;
  return raw ? absolutizeExperienceMediaUri(raw) : undefined;
}

export function sequenceTimelineOffsetMs(
  assets: readonly ExperienceRuntimeAsset[],
  config: ExperienceCoreVideoRendererConfig,
  sequenceIndex: number,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): number {
  return config.sequence.slice(0, sequenceIndex).reduce((total, clip) => {
    const media = resolveVideoMedia(assets, clip.assetId, orientation);
    return total + (media?.variant.durationMs ?? 0);
  }, 0);
}

/**
 * Clips Start waits for: the one that plays first plus its successor, so the
 * opening cut is on disk and the next is already there when it ends. Anything
 * beyond that has the whole runtime of those clips to arrive.
 */
const START_GATE_CLIP_COUNT = 2;

export type ExperienceClipPlan = {
  /** Start waits on these and nothing else. */
  critical: readonly string[];
  /** The rest of the chapter, in play order, warmed behind playback. */
  deferred: readonly string[];
};

/**
 * Split the chapter's core-video clips into what Start must wait for and what
 * can keep downloading behind playback.
 *
 * Web can afford to gate Start on the whole catalogue because a clip there only
 * needs to reach `canplaythrough`; here a clip means a completed file download,
 * so waiting on branches the viewer may never take is a wait for nothing.
 * Ordering is play order — sequence order within a scene, graph distance from
 * the entry scene across scenes — so the clip needed next is fetched next.
 */
export function planCatalogueVideoUris(
  manifest: ExperienceRuntimeManifest,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): ExperienceClipPlan {
  const nodesById = new Map(manifest.graph.nodes.map((node) => [node.sceneId, node]));
  const visited = new Set<string>();
  const queue: string[] = [manifest.graph.entrySceneId];
  const ordered: string[] = [];

  const push = (node: ExperienceGraphNode) => {
    if (node.kind !== "scene") return;
    ordered.push(...sceneVideoUris(node, manifest.assets, orientation));
  };

  while (queue.length > 0) {
    const sceneId = queue.shift();
    if (sceneId === undefined || visited.has(sceneId)) continue;
    visited.add(sceneId);
    const node = nodesById.get(sceneId);
    if (!node) continue;
    push(node);
    queue.push(...sceneGotoTargets(node));
  }

  // Scenes the static walk cannot reach still belong in the catalogue — a route
  // condition can name a target this traversal has no way to evaluate.
  for (const node of manifest.graph.nodes) {
    if (visited.has(node.sceneId)) continue;
    push(node);
  }

  const unique = [...new Set(ordered)];
  return {
    critical: unique.slice(0, START_GATE_CLIP_COUNT),
    deferred: unique.slice(START_GATE_CLIP_COUNT),
  };
}

function sceneVideoUris(
  scene: Extract<ExperienceGraphNode, { kind: "scene" }>,
  assets: readonly ExperienceRuntimeAsset[],
  orientation: ExperienceOrientation
): string[] {
  const uris: string[] = [];
  for (const renderer of scene.renderers) {
    if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) continue;
    const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
    if (!parsed.success) continue;
    for (const clip of parsed.data.sequence) {
      const media = resolveVideoMedia(assets, clip.assetId, orientation);
      if (media) uris.push(media.variant.uri);
    }
  }
  return uris;
}

function sceneGotoTargets(node: ExperienceGraphNode): string[] {
  return node.eventBindings.flatMap((binding) =>
    binding.routes.flatMap((route) =>
      route.actions.flatMap((action) => (action.kind === "scene.goto" ? [action.sceneId] : []))
    )
  );
}
