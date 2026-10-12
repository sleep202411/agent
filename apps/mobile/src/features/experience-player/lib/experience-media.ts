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
type ResolveTask = { promise: Promise<string>; controller: AbortController; users: number };
const RESOLVE_IN_FLIGHT = new Map<string, ResolveTask>();
function mediaAbortError() {
  const error = new Error("Media request cancelled");
  error.name = "AbortError";
  return error;
}
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
  if (signal?.aborted) throw mediaAbortError();
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

  // Share transport, but let each caller retire independently.
  let task = RESOLVE_IN_FLIGHT.get(absolute);
  if (!task) {
    const controller = new AbortController();
    const created: ResolveTask = { controller, users: 0, promise: Promise.resolve("") };
    created.promise = signPlayableUrl(absolute, controller.signal).finally(() => {
      if (RESOLVE_IN_FLIGHT.get(absolute) === created) RESOLVE_IN_FLIGHT.delete(absolute);
    });
    RESOLVE_IN_FLIGHT.set(absolute, created);
    task = created;
  }
  const shared = task;
  shared.users += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      shared.users -= 1;
      if (shared.users === 0) {
        shared.controller.abort();
        if (RESOLVE_IN_FLIGHT.get(absolute) === shared) RESOLVE_IN_FLIGHT.delete(absolute);
      }
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(mediaAbortError());
    signal?.addEventListener("abort", abort, { once: true });
    shared.promise.then(
      (value) => finish(undefined, value),
      (error) => finish(error)
    );
    if (signal?.aborted) abort();
  });
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
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  try {
    if (controller.signal.aborted) throw mediaAbortError();
    const response = await fetch(absolute, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });

    if (controller.signal.aborted) {
      void response.body?.cancel?.().catch(() => {});
      throw mediaAbortError();
    }
    if (!response.ok && response.status !== 206) {
      try {
        void response.body?.cancel?.().catch(() => {});
      } catch {
        // Keep the HTTP failure if this platform cannot cancel the probe body.
      }
      throw new Error(`Media unavailable (${response.status})`);
    }

    const playable = (response.url || absolute).trim();
    const reusableUntilMs = signatureReusableUntilMs(playable);
    if (reusableUntilMs > Date.now()) {
      PLAYABLE_URL_CACHE.set(absolute, { url: playable, reusableUntilMs });
    }

    // Drop the probe body — we only needed the redirected Location / final URL.
    try {
      void response.body?.cancel?.().catch(() => {});
    } catch {
      // ignore
    }

    return playable;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) throw mediaAbortError();
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
 * (`Expires`), OSS V4 (`x-oss-date` + `x-oss-expires`) and SigV4 (`X-Amz-Date` + `X-Amz-Expires`) — minus a safety margin.
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

  // OSS V4 expires is a lifetime measured from x-oss-date, not Unix time.
  if (params.has("x-oss-expires")) {
    const signedAt = parseAmzDate(params.get("x-oss-date"));
    const lifetimeSeconds = Number(params.get("x-oss-expires"));
    if (signedAt === null || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) return 0;
    const expiresAt = signedAt + lifetimeSeconds * 1_000;
    return Number.isFinite(expiresAt) ? expiresAt : 0;
  }

  const epochSeconds = params.get("Expires");
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

/** Stills are video-kind assets with an image MIME — the compiler emits them that way. */
export function isStillVideoVariant(mediaType: string | undefined): boolean {
  return Boolean(mediaType?.toLowerCase().startsWith("image/"));
}

/**
 * How near its declared end a clip counts as finished. Matches the web player.
 * A file often runs a little past the authored duration.
 */
const CLIP_END_MARGIN_SECONDS = 0.15;

/** True when playback has reached the clip's declared end, within one breath. */
export function clipPlaybackReachedEnd(currentTimeSeconds: number, endSeconds: number): boolean {
  if (!(endSeconds > 0) || !Number.isFinite(endSeconds) || !Number.isFinite(currentTimeSeconds)) {
    return false;
  }
  return endSeconds - currentTimeSeconds < CLIP_END_MARGIN_SECONDS;
}

/**
 * How long a clip that has already reached its last moments may sit still
 * before the sequence moves on. iOS sometimes never emits `playToEnd`.
 * A freeze in the middle of the shot is not the end.
 */
export const CLIP_PLAYBACK_STALL_MS = 1_500;
const CLIP_STALL_MOVE_SECONDS = 0.05;
const CLIP_STALL_END_GAP_SECONDS = 0.5;

/**
 * The end this player should measure to. A fresh player reports its own file
 * length, which is trustworthy. The file often runs a little past the authored
 * duration, and the authored duration is sometimes longer than the file.
 */
export function clipPlaybackEndSeconds(
  authoredMs: number | undefined,
  playerDurationSeconds: number
): number {
  const authored = authoredMs && authoredMs > 0 ? authoredMs / 1_000 : 0;
  const native =
    Number.isFinite(playerDurationSeconds) && playerDurationSeconds > 0 ? playerDurationSeconds : 0;
  if (authored > 0 && native > 0) return Math.min(authored, native);
  return authored || native;
}

/**
 * True when a clip that already started has stopped within a breath of its end.
 * A host pause and a playhead that never left the start do not count.
 */
export function clipPlaybackStalled(input: {
  currentTimeSeconds: number;
  anchoredTimeSeconds: number;
  anchoredForMs: number;
  endSeconds: number;
  moved: boolean;
  held: boolean;
}): boolean {
  if (input.held || !input.moved) return false;
  if (!Number.isFinite(input.currentTimeSeconds) || !Number.isFinite(input.anchoredTimeSeconds)) {
    return false;
  }
  if (!Number.isFinite(input.endSeconds) || !(input.endSeconds > 0)) return false;
  if (input.endSeconds - input.currentTimeSeconds > CLIP_STALL_END_GAP_SECONDS) return false;
  if (Math.abs(input.currentTimeSeconds - input.anchoredTimeSeconds) > CLIP_STALL_MOVE_SECONDS) {
    return false;
  }
  return input.anchoredForMs >= CLIP_PLAYBACK_STALL_MS;
}

/**
 * What the player should open. A file already on disk plays at once. Otherwise
 * the signed media URL plays immediately — the same bytes the web player uses —
 * and the download continues in the background for the next visit. Waiting for
 * the whole file before the cut is what freezes the shot.
 */
export async function resolveClipPlaybackUri(
  sourceUri: string,
  signal: AbortSignal,
  io: {
    cached: (sourceUri: string) => string | null;
    sign: (sourceUri: string, signal: AbortSignal) => Promise<string>;
    warm: (sourceUri: string) => void;
  }
): Promise<string | null> {
  if (signal.aborted) return null;
  const cached = io.cached(sourceUri);
  if (cached) return cached;
  const signed = await io.sign(sourceUri, signal);
  if (signal.aborted) return null;
  io.warm(sourceUri);
  return signed;
}

const EMPTY_SEQUENCE_HOLD_MS = 6_000;

/**
 * A still's screen time. The sequence expresses it as the clip's held
 * duration, which the compiler always emits for a still; the fallback only
 * covers a hand-authored manifest that held a frame indefinitely.
 */
export function stillClipDurationMs(clip: {
  endBehavior: { behavior: string; durationMs?: number };
}): number {
  return clip.endBehavior.behavior === "hold-last-frame" && clip.endBehavior.durationMs
    ? clip.endBehavior.durationMs
    : EMPTY_SEQUENCE_HOLD_MS;
}

export function sequenceTimelineOffsetMs(
  assets: readonly ExperienceRuntimeAsset[],
  config: ExperienceCoreVideoRendererConfig,
  sequenceIndex: number,
  orientation: ExperienceOrientation = EXPERIENCE_PLAY_ORIENTATION
): number {
  return config.sequence.slice(0, sequenceIndex).reduce((total, clip) => {
    const media = resolveVideoMedia(assets, clip.assetId, orientation);
    // A still carries no media duration — its screen time is the held
    // duration on the clip. Reading only the variant would under-count it and
    // shift every later clip's interaction window earlier.
    if (media && isStillVideoVariant(media.variant.mediaType)) {
      return total + stillClipDurationMs(clip);
    }
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
    // The on-device clip cache is mp4-only. Stills paint through expo-image
    // and must not be stored (or probed) as footage.
    if (media && !isStillVideoVariant(media.variant.mediaType)) {
      uris.push(media.variant.uri);
    }
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
