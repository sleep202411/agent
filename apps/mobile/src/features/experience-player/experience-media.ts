import type {
  ExperienceCoreVideoRendererConfig,
  ExperienceGraphNode,
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

type PlayableUrl = { url: string; reusableUntilMs: number };

const PLAYABLE_URL_CACHE = new Map<string, PlayableUrl>();
const RESOLVE_IN_FLIGHT = new Map<string, Promise<string>>();
const RESOLVE_TIMEOUT_MS = 15_000;
/**
 * Signed URLs are short-lived (the Aurora blob SAS runs ~6 minutes), and a
 * cached one that outlives its signature fails as `-1102 no permission` inside
 * AVPlayer. Stop reusing a signature this long before it dies so the clip it is
 * handed to can still start and buffer.
 */
const SIGNATURE_SAFETY_MARGIN_MS = 60_000;
/** Reuse window for URLs whose expiry cannot be read off the query string. */
const OPAQUE_URL_TTL_MS = 5 * 60_000;

export function absolutizeExperienceMediaUri(uri: string): string | undefined {
  const resolved = resolveExperienceAssetUrl(uri.trim());
  return resolved || undefined;
}

/**
 * Aurora `/story-projects/.../content` returns 302 → signed OSS.
 * Browsers follow that for `<video>`; AVPlayer often hangs/times out on the
 * API hop. Resolve to the final URL and reuse it for as long as its signature
 * is good for.
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
  if (cached && cached.reusableUntilMs > Date.now()) return cached.url;
  PLAYABLE_URL_CACHE.delete(absolute);

  // A second caller for the same clip joins the resolve in flight rather than
  // signing a competing URL — and so inherits the first caller's abort signal.
  const pending = RESOLVE_IN_FLIGHT.get(absolute);
  if (pending) return pending;
  const task = signPlayableUrl(absolute, signal).finally(() => {
    RESOLVE_IN_FLIGHT.delete(absolute);
  });
  RESOLVE_IN_FLIGHT.set(absolute, task);
  return task;
}

/** Forget a signature that playback rejected, so the next attempt signs afresh. */
export function invalidatePlayableMediaUrl(uri: string): void {
  const absolute = absolutizeExperienceMediaUri(uri);
  if (absolute) PLAYABLE_URL_CACHE.delete(absolute);
}

async function signPlayableUrl(absolute: string, signal?: AbortSignal): Promise<string> {
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
    const reusableUntilMs = signatureReusableUntilMs(playable);
    if (reusableUntilMs > Date.now()) {
      PLAYABLE_URL_CACHE.set(absolute, { url: playable, reusableUntilMs });
    }

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

/**
 * How long a freshly signed URL stays reusable. Read from the signature itself
 * where the provider exposes it — Azure blob SAS (`se`), OSS / classic S3
 * (`Expires`), SigV4 (`X-Amz-Date` + `X-Amz-Expires`) — minus a safety margin.
 */
function signatureReusableUntilMs(url: string): number {
  const expiresAtMs = signatureExpiresAtMs(url);
  if (expiresAtMs === null) return Date.now() + OPAQUE_URL_TTL_MS;
  return expiresAtMs - SIGNATURE_SAFETY_MARGIN_MS;
}

function signatureExpiresAtMs(url: string): number | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }

  const iso = params.get("se");
  if (iso) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return parsed;
  }

  const epochSeconds = params.get("Expires") ?? params.get("x-oss-expires");
  if (epochSeconds) {
    const parsed = Number(epochSeconds);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 1_000;
  }

  const signedAt = parseAmzDate(params.get("X-Amz-Date"));
  const lifetimeSeconds = Number(params.get("X-Amz-Expires"));
  if (signedAt !== null && Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0) {
    return signedAt + lifetimeSeconds * 1_000;
  }

  return null;
}

/** SigV4 basic ISO-8601 (`20260811T095254Z`) — `Date.parse` does not take it. */
function parseAmzDate(value: string | null): number | null {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(parsed) ? parsed : null;
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
 * Every clip in the chapter, ordered by graph distance from `startSceneId`.
 *
 * Start waits for this whole list: on a phone a clip means a completed file
 * download, and anything short of the full chapter leaves a scene transition
 * mid-film waiting on the network with a black screen up. Ordering still matters
 * even though the gate needs all of it — it decides what the viewer's progress
 * bar is spending its first bytes on, and which clips are already there if the
 * gate has to open early.
 *
 * Prefetch re-asks for this whenever the viewer changes scene: the static walk
 * from the entry scene is only a guess at the route, and once a choice is made
 * the clips one hop from *here* matter more than the ones the guess put first.
 */
export function orderVideoUrisFromScene(
  manifest: ExperienceRuntimeManifest,
  startSceneId: string,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): string[] {
  const nodesById = new Map(manifest.graph.nodes.map((node) => [node.sceneId, node]));
  const start = nodesById.has(startSceneId) ? startSceneId : manifest.graph.entrySceneId;
  const visited = new Set<string>();
  const queue: string[] = [start];
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

  return [...new Set(ordered)];
}

function sceneVideoUris(
  scene: Extract<ExperienceGraphNode, { kind: "scene" }>,
  assets: readonly ExperienceRuntimeAsset[],
  orientation: ExperienceOrientation
): string[] {
  const uris: string[] = [];
  const pushAsset = (assetId: string) => {
    const media = resolveVideoMedia(assets, assetId, orientation);
    if (media) uris.push(media.variant.uri);
  };
  for (const renderer of scene.renderers) {
    if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) continue;
    const parsed = ExperienceCoreVideoRendererConfigSchema.safeParse(renderer.config);
    if (!parsed.success) continue;
    for (const clip of parsed.data.sequence) {
      pushAsset(clip.assetId);
      // A `loop` end behaviour plays a second asset that the sequence itself
      // never lists — it is what the scene sits on while it waits for a choice,
      // so leaving it out means the wait is where the film stalls.
      if (clip.endBehavior.behavior === "loop") pushAsset(clip.endBehavior.assetId);
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
