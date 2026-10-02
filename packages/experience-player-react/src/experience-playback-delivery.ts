import { createContext } from "react";
import {
  HLSProviderLoader,
  canPlayHLSNatively,
  isHLSProvider,
  type HLSConstructor,
  type MediaProviderAdapter,
} from "@vidstack/react";
import type Hls from "hls.js";
import {
  STORY_PLAYBACK_HLS_MIME_TYPE,
  StoryBuildAssetPlaybackResponseSchema,
} from "@repo/shared/story-playback";
import { buildMediaEndpoint } from "./experience-build-media-uri";

/** A clip as the manifest declares it: the frozen file and its MIME type. */
export interface ExperienceDeclaredSource {
  src: string;
  type: string | null;
}

/** What the media element is actually given for a declared clip. */
export interface ExperiencePlaybackSource {
  readonly src: string;
  readonly type: string | null;
  readonly delivery: "hls" | "progressive";
  /** The manifest URI this source stands in for — the key the player tracks it by. */
  readonly declaredSrc: string;
}

export interface ExperiencePlaybackDeliveryOptions {
  /** Ask `/playback` about build clips. Off, every clip plays its declared file. */
  adaptive: boolean;
  fetch?: typeof fetch;
  /** Whether this browser can play an HLS answer at all. Asked once. */
  acceptsHls?: () => boolean;
}

/**
 * The bandwidth hls.js assumes before it has measured any, and the ceiling the
 * look-ahead warms under when it has no rendition to follow yet. 1.5 Mbps sits
 * between the 480p and 720p tiers of the transcode ladder, so a cold start
 * opens on a tier a phone on mobile data can hold.
 */
export const EXPERIENCE_HLS_START_BANDWIDTH = 1_500_000;

/** Distinct clips remembered per player. A manifest holds far fewer. */
const PLAYBACK_MEMORY_LIMIT = 256;

/**
 * Decides, per declared clip, what the media element plays — and remembers what
 * the player has already put on stage or warmed, so the look-ahead never fetches
 * the same opening twice.
 *
 * A frozen build clip may have a ready HLS rendition next to its progressive
 * file. The manifest only ever names the progressive `/content` URI, so the
 * sibling `/playback` endpoint is asked which one to play. That answer is the
 * only thing negotiated: a refused or malformed answer is an error the player
 * shows verbatim, never a silent switch back to the progressive file, and a
 * failure is not remembered so the next attempt asks again.
 *
 * One instance lives as long as the player, across "play again", so a replay
 * starts from answers it already has.
 */
export class ExperiencePlaybackDelivery {
  private readonly adaptive: boolean;
  private readonly request: typeof fetch;
  private readonly acceptsHlsProbe: () => boolean;
  private acceptsHlsAnswer: boolean | undefined;
  private readonly settled = new Map<string, ExperiencePlaybackSource>();
  private readonly inflight = new Map<string, Promise<ExperiencePlaybackSource>>();
  private readonly primed = new Map<string, true>();
  private readonly warmedVariants = new Map<string, string>();
  private levelHeight: number | null = null;
  private hlsConstructor: HLSConstructor | undefined;

  constructor(options: ExperiencePlaybackDeliveryOptions) {
    this.adaptive = options.adaptive;
    // Never stored bare: `window.fetch` called as a method of this object throws
    // "Illegal invocation".
    this.request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.acceptsHlsProbe = options.acceptsHls ?? browserAcceptsHls;
  }

  /**
   * The answer this player already has for a clip, without waiting: the
   * declared file wherever nothing is negotiated, the remembered answer for a
   * build clip that has settled, and undefined while one still has to be asked.
   * The same object is returned every time, so it can key a render.
   */
  peek(declared: ExperienceDeclaredSource): ExperiencePlaybackSource | undefined {
    const known = recall(this.settled, declared.src);
    if (known && (known.delivery === "hls" || known.type === declared.type)) return known;
    if (this.negotiates(declared)) return undefined;
    const source = progressiveSource(declared);
    remember(this.settled, declared.src, source, PLAYBACK_MEMORY_LIMIT);
    return source;
  }

  /** The answer for a clip, asking `/playback` once however many callers wait on it. */
  resolve(declared: ExperienceDeclaredSource): Promise<ExperiencePlaybackSource> {
    const known = this.peek(declared);
    if (known) return Promise.resolve(known);
    const pending = this.inflight.get(declared.src);
    if (pending) return pending;
    const endpoint = buildMediaEndpoint(declared.src, "playback");
    if (!endpoint) {
      // `peek` negotiates only URIs this resolves, so this is a broken invariant.
      return Promise.reject(new Error(`No playback endpoint for ${declared.src}.`));
    }
    const request = this.negotiate(declared, endpoint);
    this.inflight.set(declared.src, request);
    // Registered before any caller can attach, so the answer is remembered by
    // the time anyone resumes on it. A failure is dropped, not remembered.
    request.then(
      (source) => {
        this.inflight.delete(declared.src);
        remember(this.settled, declared.src, source, PLAYBACK_MEMORY_LIMIT);
      },
      () => this.inflight.delete(declared.src)
    );
    return request;
  }

  /**
   * Drops the answer for a clip, so the next player to load it asks again. Called
   * when a negotiated stream fails fatally: the master it named is not replayed.
   */
  forget(declaredSrc: string): void {
    this.settled.delete(declaredSrc);
    this.primed.delete(declaredSrc);
  }

  /** The clip has been handed to a media element. */
  markStaged(declaredSrc: string): void {
    remember(this.primed, declaredSrc, true, PLAYBACK_MEMORY_LIMIT);
  }

  /** The look-ahead finished fetching the clip's opening. */
  markWarmed(declaredSrc: string): void {
    remember(this.primed, declaredSrc, true, PLAYBACK_MEMORY_LIMIT);
  }

  hasStagedOrWarmed(declaredSrc: string): boolean {
    return this.primed.has(declaredSrc);
  }

  /** The rendition whose opening the look-ahead fetched for an HLS master. */
  recordWarmedVariant(masterUrl: string, variantUrl: string): void {
    remember(
      this.warmedVariants,
      normalizeUrl(masterUrl),
      normalizeUrl(variantUrl),
      PLAYBACK_MEMORY_LIMIT
    );
  }

  warmedVariantFor(masterUrl: string): string | undefined {
    return recall(this.warmedVariants, normalizeUrl(masterUrl));
  }

  /** Height of the rendition hls.js last switched to — what the network held. */
  recordLevelHeight(height: number | undefined): void {
    if (height !== undefined && Number.isFinite(height) && height > 0) this.levelHeight = height;
  }

  get lastLevelHeight(): number | null {
    return this.levelHeight;
  }

  /** The bundled hls.js, once imported for an HLS answer (see `negotiate`). */
  get hlsLibrary(): HLSConstructor | undefined {
    return this.hlsConstructor;
  }

  /** `onProviderChange` for players bound to this delivery. */
  readonly configureProvider = (provider: MediaProviderAdapter | null): void => {
    configureExperienceMediaProvider(provider, this);
  };

  private negotiates(declared: ExperienceDeclaredSource): boolean {
    if (!this.adaptive || buildMediaEndpoint(declared.src, "playback") === null) return false;
    // Asked lazily and on the client only: the server cannot play anything.
    if (typeof document === "undefined") return false;
    this.acceptsHlsAnswer ??= this.acceptsHlsProbe();
    return this.acceptsHlsAnswer;
  }

  private async negotiate(
    declared: ExperienceDeclaredSource,
    endpoint: string
  ): Promise<ExperiencePlaybackSource> {
    const response = await this.request(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        upstreamMessage(body) ?? `Playback negotiation failed (HTTP ${response.status})`
      );
    }
    const parsed = StoryBuildAssetPlaybackResponseSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.map(String).join(".") || "(root)";
      throw new Error(
        `Playback negotiation returned an invalid response: ${path}: ${issue?.message ?? "invalid"}`
      );
    }
    const playback = parsed.data.data;
    if (!playback) return progressiveSource(declared);
    // An answer hls.js will play goes out once hls.js is in, so Vidstack can be
    // handed the constructor itself. Handed a loader, it offers the element the
    // stream as a `<source>` while the import is on its way; Chrome, which
    // answers "maybe" for HLS, starts playing it natively, and hls.js then tears
    // that down — stalling a clip the host had already started.
    if (!experiencePrefersNativeHls()) this.hlsConstructor ??= (await import("hls.js")).default;
    return {
      src: playback.url,
      type: STORY_PLAYBACK_HLS_MIME_TYPE,
      delivery: "hls",
      declaredSrc: declared.src,
    };
  }
}

/** The delivery players below it negotiate through. Null plays every clip as declared. */
export const ExperiencePlaybackDeliveryContext = createContext<ExperiencePlaybackDelivery | null>(
  null
);

const configuredProviders = new WeakSet<object>();

/**
 * Prepares an HLS provider before Vidstack sets it up.
 *
 * Applied to every player, delivery or not: without a `library`, Vidstack loads
 * hls.js from jsDelivr, which the China cell cannot depend on. It is the
 * constructor once the delivery has imported it, and until then a loader — an
 * arrow function on purpose: Vidstack treats any function that has a
 * `prototype` as the hls.js constructor itself and would call it as one.
 *
 * With a delivery, two hls.js events feed it: the rendition the network settles
 * on (so the look-ahead warms the tier that will actually play), and, at
 * MANIFEST_PARSED, the start level pinned to the rendition the look-ahead
 * already warmed — hls.js resets its start level on every manifest and would
 * otherwise open on a tier whose segment is not in the cache.
 */
export function configureExperienceMediaProvider(
  provider: MediaProviderAdapter | null,
  delivery: ExperiencePlaybackDelivery | null
): void {
  if (!isHLSProvider(provider) || configuredProviders.has(provider)) return;
  configuredProviders.add(provider);
  provider.library = delivery?.hlsLibrary ?? (() => import("hls.js"));
  provider.config = {
    capLevelToPlayerSize: true,
    abrEwmaDefaultEstimate: EXPERIENCE_HLS_START_BANDWIDTH,
  };
  provider.onInstance((hls) => {
    const { Events } = hls.constructor as typeof Hls;
    hls.on(Events.LEVEL_SWITCHED, (_event, data) => {
      delivery?.recordLevelHeight(hls.levels[data.level]?.height);
    });
    hls.on(Events.MANIFEST_PARSED, (_event, data) => {
      const warmed = hls.url ? delivery?.warmedVariantFor(hls.url) : undefined;
      if (!warmed) return;
      const index = data.levels.findIndex((level) => normalizeUrl(level.uri) === warmed);
      if (index >= 0) hls.startLevel = index;
    });
  });
}

let prefersNativeHls: boolean | undefined;

/**
 * Apple WebKit plays HLS natively, and on iPhone that is the one path every
 * device has (MediaSource arrived late there, and only in its managed form), so
 * an HLS answer goes to the native element on Apple and to the bundled hls.js
 * everywhere else. Read off the vendor as well as `canPlayType`: Chrome on
 * Android also answers "maybe" for HLS, and there the hls.js path — the one the
 * start-level and rendition hooks above attach to — has to stay in charge.
 */
export function experiencePrefersNativeHls(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  prefersNativeHls ??= /Apple/.test(navigator.vendor) && canPlayHLSNatively();
  return prefersNativeHls;
}

function browserAcceptsHls(): boolean {
  return HLSProviderLoader.supported || canPlayHLSNatively();
}

function progressiveSource(declared: ExperienceDeclaredSource): ExperiencePlaybackSource {
  return {
    src: declared.src,
    type: declared.type,
    delivery: "progressive",
    declaredSrc: declared.src,
  };
}

/** Nest answers `{ code, message }`, the Java gateway `{ code, msg }`. */
function upstreamMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { message, msg } = body as { message?: unknown; msg?: unknown };
  const text = Array.isArray(message) ? message.filter(isText).join("; ") : message;
  if (isText(text)) return text;
  return isText(msg) ? msg : null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/** Reads an entry and marks it most recently used. */
function recall<V>(memory: Map<string, V>, key: string): V | undefined {
  const value = memory.get(key);
  if (value === undefined) return undefined;
  memory.delete(key);
  memory.set(key, value);
  return value;
}

/** Writes an entry, evicting the least recently used past the limit. */
function remember<V>(memory: Map<string, V>, key: string, value: V, limit: number): void {
  memory.delete(key);
  memory.set(key, value);
  while (memory.size > limit) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) return;
    memory.delete(oldest);
  }
}
