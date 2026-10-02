import {
  EXPERIENCE_HLS_START_BANDWIDTH,
  experiencePrefersNativeHls,
  type ExperienceDeclaredSource,
  type ExperiencePlaybackDelivery,
} from "./experience-playback-delivery";

/** Long enough for a clip's opening on mobile data; past it the warm gives up. */
const PROGRESSIVE_WARM_TIMEOUT_MS = 8_000;

export interface ExperienceHlsVariant {
  /** Absolute URL of the rendition playlist. */
  uri: string;
  height: number | null;
  bandwidth: number | null;
}

/**
 * Fetches the opening of one clip so the cut into it does not wait on the
 * network — and nothing more.
 *
 * - HLS: one rendition's playlist and its first segment, in full. The rendition
 *   is the one hls.js will open on (the delivery pins its start level to it),
 *   so the warmed bytes are the bytes that play.
 * - Native HLS on Apple: negotiation only. WebKit chooses and buffers its own
 *   renditions, so a fetched segment would not be the one it plays.
 * - Progressive: a detached, muted element told to preload, released as soon as
 *   it can play through — the HTTP cache keeps the ranges it fetched.
 *
 * Rejects when the clip could not be warmed; the caller decides what that
 * means. The stage's own element stays the authority on whether a clip plays.
 */
export async function warmExperienceMedia(
  media: ExperienceDeclaredSource,
  delivery: ExperiencePlaybackDelivery,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const source = await delivery.resolve(media);
  signal.throwIfAborted();
  if (source.delivery === "hls") {
    if (experiencePrefersNativeHls()) return;
    await warmHlsOpening(source.src, delivery, signal);
    return;
  }
  await warmProgressive(source.src, signal);
}

async function warmHlsOpening(
  masterUrl: string,
  delivery: ExperiencePlaybackDelivery,
  signal: AbortSignal
): Promise<void> {
  let playlistUrl = masterUrl;
  let playlist = await fetchCdnText(masterUrl, signal);
  const variants = parseHlsVariants(playlist, masterUrl);
  // A master lists renditions; a playlist without any is itself the only one.
  if (variants.length > 0) {
    const variant = chooseWarmVariant(variants, delivery.lastLevelHeight);
    delivery.recordWarmedVariant(masterUrl, variant.uri);
    playlistUrl = variant.uri;
    playlist = await fetchCdnText(variant.uri, signal);
  }
  const segment = firstHlsSegment(playlist, playlistUrl);
  if (!segment) throw new Error(`HLS playlist lists no segments: ${playlistUrl}`);
  const response = await fetchCdn(segment, signal);
  await response.arrayBuffer();
}

/**
 * The rendition to warm: the one the network last held, else the best one
 * below it, else the best one inside the cold-start budget hls.js assumes,
 * else the lightest.
 */
export function chooseWarmVariant(
  variants: readonly ExperienceHlsVariant[],
  lastLevelHeight: number | null
): ExperienceHlsVariant {
  if (variants.length === 0) throw new Error("An HLS master must list at least one rendition.");
  if (lastLevelHeight !== null) {
    const held = variants.find((variant) => variant.height === lastLevelHeight);
    if (held) return held;
    const below = highest(variants, (variant) =>
      variant.height !== null && variant.height < lastLevelHeight ? variant.height : null
    );
    if (below) return below;
  }
  const affordable = highest(variants, (variant) =>
    variant.bandwidth !== null && variant.bandwidth <= EXPERIENCE_HLS_START_BANDWIDTH
      ? variant.bandwidth
      : null
  );
  if (affordable) return affordable;
  return [...variants].sort(
    (left, right) =>
      (left.bandwidth ?? Number.POSITIVE_INFINITY) -
        (right.bandwidth ?? Number.POSITIVE_INFINITY) ||
      (left.height ?? Number.POSITIVE_INFINITY) - (right.height ?? Number.POSITIVE_INFINITY)
  )[0]!;
}

/** `EXT-X-STREAM-INF` renditions of a master playlist, URIs resolved against it. */
export function parseHlsVariants(playlist: string, playlistUrl: string): ExperienceHlsVariant[] {
  const variants: ExperienceHlsVariant[] = [];
  let pending: Map<string, string> | null = null;
  for (const line of playlistLines(playlist)) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pending = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
      continue;
    }
    if (!pending || line.startsWith("#")) continue;
    const resolution = /^(\d+)x(\d+)$/i.exec(pending.get("RESOLUTION") ?? "");
    const bandwidth = Number.parseInt(pending.get("BANDWIDTH") ?? "", 10);
    variants.push({
      uri: new URL(line, playlistUrl).href,
      height: resolution ? Number(resolution[2]) : null,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : null,
    });
    pending = null;
  }
  return variants;
}

/** The first media segment of a rendition playlist, resolved against it. */
export function firstHlsSegment(playlist: string, playlistUrl: string): string | null {
  let inSegment = false;
  for (const line of playlistLines(playlist)) {
    if (line.startsWith("#EXTINF:")) {
      inSegment = true;
      continue;
    }
    if (inSegment && !line.startsWith("#")) return new URL(line, playlistUrl).href;
  }
  return null;
}

function playlistLines(playlist: string): string[] {
  return playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** An HLS attribute list; quoted values may themselves contain commas. */
function parseAttributeList(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    const [, name, value] = match;
    if (name && value !== undefined) attributes.set(name, value.replace(/^"(.*)"$/, "$1"));
  }
  return attributes;
}

function highest<T>(items: readonly T[], score: (item: T) => number | null): T | undefined {
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const value = score(item);
    if (value !== null && (!best || value > best.score)) best = { item, score: value };
  }
  return best?.item;
}

/**
 * The media CDN answers HLS with `Access-Control-Allow-Origin: *`, so the warm
 * goes out as a credential-less CORS request — the request hls.js itself makes,
 * which is what lets the player reuse the cached response.
 */
async function fetchCdn(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { mode: "cors", credentials: "omit", signal });
  if (!response.ok) throw new Error(`HLS warm-up failed (HTTP ${response.status}): ${url}`);
  return response;
}

async function fetchCdnText(url: string, signal: AbortSignal): Promise<string> {
  return (await fetchCdn(url, signal)).text();
}

function warmProgressive(src: string, signal: AbortSignal): Promise<void> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  return new Promise<void>((resolve, reject) => {
    const settle = (failure?: unknown) => {
      window.clearTimeout(timer);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (failure === undefined) resolve();
      else reject(failure);
    };
    const onReady = () => settle();
    const onError = () =>
      settle(new Error(video.error?.message || `Progressive warm-up failed: ${src}`));
    const onAbort = () => settle(signal.reason);
    const timer = window.setTimeout(
      () =>
        settle(
          new Error(`Progressive warm-up timed out after ${PROGRESSIVE_WARM_TIMEOUT_MS} ms: ${src}`)
        ),
      PROGRESSIVE_WARM_TIMEOUT_MS
    );
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);
    video.src = src;
    video.load();
  }).finally(() => {
    // Releases the element's decoder and connection; the fetched ranges stay in
    // the HTTP cache for the stage element to pick up.
    video.removeAttribute("src");
    video.load();
  });
}
