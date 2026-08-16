import { File } from "expo-file-system";

import { subscribeAppActive } from "@/hooks/use-app-active";

import { createDiskCachePool, deleteQuietly } from "./experience-disk-cache";
import { absolutizeExperienceMediaUri, resolvePlayableMediaUrl } from "./experience-media";

/**
 * Stall window, not a total deadline: a large clip on a slow link is allowed to
 * take as long as it takes, but 30s without a single byte is a dead transfer.
 */
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
/**
 * How far a background download must have got before playback waits for it
 * instead of streaming. Past the halfway mark, finishing the file is both
 * quicker and cheaper than re-fetching the whole clip over the stream.
 */
const DOWNLOAD_JOIN_THRESHOLD = 0.5;
/**
 * Soft ceiling for on-device clip storage. Chapters share one pool; LRU drops
 * the oldest accessed `.mp4` files when a download would push past this.
 * 800 MiB ≈ one long chapter plus headroom for a second without wiping the first.
 */
const CACHE_BUDGET_BYTES = 800 * 1024 * 1024;

export const EXPERIENCE_MEDIA_BUDGET_BYTES = CACHE_BUDGET_BYTES;

/**
 * Clips belonging to the chapter being played. LRU alone would let a long
 * chapter evict its own opening while still downloading its ending — the pin
 * keeps eviction pointed at *other* chapters for as long as this one is loaded.
 */
let pinnedFileNames: ReadonlySet<string> = new Set();

const pool = createDiskCachePool({
  dirName: "experience-media",
  budgetBytes: CACHE_BUDGET_BYTES,
  isManaged: (name) => name.endsWith(".mp4"),
  isScratch: (name) => name.endsWith(".part"),
  protectedFileNames: () => new Set([...pinnedFileNames, ...liveStagingFileNames()]),
});

/** Staging files of downloads that are still running — orphans they are not. */
function liveStagingFileNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of inFlightDownloads.values()) {
    names.add(entry.stagingName);
  }
  return names;
}

/** Replaces the pin set — one chapter is loaded at a time. */
export function pinExperienceMediaSources(sourceUris: readonly string[]): void {
  pinnedFileNames = new Set(
    sourceUris.map((uri) => cacheFileFor(absolutizeExperienceMediaUri(uri) ?? uri.trim()).name)
  );
}

export function clearExperienceMediaPins(): void {
  pinnedFileNames = new Set();
}

function stableSourceKey(sourceUri: string): string {
  let key = sourceUri.trim();
  try {
    const parsed = new URL(key);
    key = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Relative / path-only URIs — use as-is.
  }
  // FNV-1a 32-bit — stable, dependency-free content key (query/SAS stripped above).
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cacheFileFor(sourceUri: string): File {
  return pool.file(`${stableSourceKey(sourceUri)}.mp4`);
}

let stagingSerial = 0;

/**
 * Downloads land here first and are moved into place only once complete, so a
 * concurrent reader can never pick up a half-written file. Android streams
 * straight into the destination otherwise (iOS already stages internally).
 *
 * The serial makes every attempt's staging file its own: a clip whose download
 * was cancelled and immediately restarted would otherwise have the new attempt
 * delete the file the cancelled one is still unwinding from.
 */
function nextStagingFileFor(sourceUri: string): File {
  stagingSerial += 1;
  return pool.file(`${stableSourceKey(sourceUri)}.${stagingSerial}.part`);
}

/**
 * Local file URI if this source was already downloaded. Keys on the stable
 * Aurora/path URI (not the rotating SAS query string).
 */
export function peekCachedMediaUri(sourceUri: string): string | null {
  const absolute = absolutizeExperienceMediaUri(sourceUri) ?? sourceUri.trim();
  const file = cacheFileFor(absolute);
  try {
    if (file.exists && file.size > 0) return file.uri;
  } catch {
    // Missing / unreadable — treat as cache miss.
  }
  return null;
}

/** Bytes this source occupies on disk, or 0 when it is not cached. */
export function cachedMediaBytes(sourceUri: string): number {
  const absolute = absolutizeExperienceMediaUri(sourceUri) ?? sourceUri.trim();
  try {
    const file = cacheFileFor(absolute);
    if (!file.exists) return 0;
    return Math.max(0, file.size ?? 0);
  } catch {
    return 0;
  }
}

type DownloadProgressState = { bytesWritten: number; totalBytes: number };

type InFlightDownload = {
  promise: Promise<string>;
  /** Owned by the download, so a playback claim can cancel it specifically. */
  controller: AbortController;
  progress: DownloadProgressState;
  stagingName: string;
};

/**
 * In-flight downloads by absolute source URI. A second request for a clip that
 * is already downloading joins the first instead of racing it onto the same
 * path — and therefore also inherits the first caller's abort signal.
 */
const inFlightDownloads = new Map<string, InFlightDownload>();

export type EnsureMediaCachedOptions = {
  signal?: AbortSignal;
  /** 0–1 of this clip's bytes; never called for a caller that joined a download. */
  onProgress?: (fraction: number) => void;
};

/**
 * Download the playable remote URL into the on-device cache. Returns a `file://`
 * URI. Failures delete partial files so the next attempt starts clean.
 */
export function ensureMediaCached(
  sourceUri: string,
  options: EnsureMediaCachedOptions = {}
): Promise<string> {
  const absolute = absolutizeExperienceMediaUri(sourceUri) ?? sourceUri.trim();
  const existing = peekCachedMediaUri(absolute);
  if (existing) {
    pool.touch(cacheFileFor(absolute).name);
    return Promise.resolve(existing);
  }

  const pending = inFlightDownloads.get(absolute);
  // An aborted entry is still registered until its native cancel round-trips;
  // joining it would hand this caller a rejection that is not about its request.
  if (pending && !pending.controller.signal.aborted) return pending.promise;

  const controller = new AbortController();
  const progress: DownloadProgressState = { bytesWritten: 0, totalBytes: -1 };
  const staging = nextStagingFileFor(absolute);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort);

  const promise = downloadToCache(
    absolute,
    staging,
    controller,
    progress,
    options.onProgress
  ).finally(() => {
    options.signal?.removeEventListener("abort", forwardAbort);
    // Only retire our own entry: an aborted download can be superseded by a
    // fresh attempt for the same clip before this settles.
    if (inFlightDownloads.get(absolute)?.controller === controller) {
      inFlightDownloads.delete(absolute);
    }
  });
  inFlightDownloads.set(absolute, {
    promise,
    controller,
    progress,
    stagingName: staging.name,
  });
  return promise;
}

async function downloadToCache(
  absolute: string,
  staging: File,
  controller: AbortController,
  progress: DownloadProgressState,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const playable = await resolvePlayableMediaUrl(absolute, controller.signal);
  if (playable.startsWith("file://")) return playable;

  pool.ensureDirectory();
  const destination = cacheFileFor(absolute);

  let stalled = false;
  let lastProgressAtMs = Date.now();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStallTimer = () => {
    if (stallTimer !== null) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      // Timers do not run while the app is suspended and fire late on resume, so
      // re-check against the clock instead of trusting the callback as proof of
      // a dead transfer — otherwise every download dies on the way back from a
      // backgrounded gate.
      const idleMs = Date.now() - lastProgressAtMs;
      if (idleMs < DOWNLOAD_STALL_TIMEOUT_MS) {
        armStallTimer();
        return;
      }
      stalled = true;
      controller.abort();
    }, DOWNLOAD_STALL_TIMEOUT_MS);
  };
  armStallTimer();
  // Coming back from the background is not evidence of a stalled transfer: JS was
  // suspended, so no progress could have been reported. Start the window over.
  const unsubscribeAppActive = subscribeAppActive((active) => {
    if (!active) return;
    lastProgressAtMs = Date.now();
    armStallTimer();
  });

  try {
    if (controller.signal.aborted) {
      throw new Error("Media download cancelled");
    }
    const output = await File.downloadFileAsync(playable, staging, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        progress.bytesWritten = bytesWritten;
        progress.totalBytes = totalBytes;
        lastProgressAtMs = Date.now();
        armStallTimer();
        onProgress?.(downloadFraction(progress));
      },
    });
    if (!output.exists || output.size <= 0) {
      throw new Error("Media download produced an empty file");
    }
    deleteQuietly(destination);
    await output.move(destination);
    pool.touch(destination.name);
    onProgress?.(1);
    // Protect the file we just wrote so a concurrent eviction cannot drop it
    // before the next access touch lands on disk.
    void pool.enqueueEviction(new Set([destination.name])).catch(() => undefined);
    return destination.uri;
  } catch (error) {
    deleteQuietly(staging);
    if (stalled) {
      throw new Error("Media download timed out");
    }
    if (controller.signal.aborted) {
      throw new Error("Media download cancelled");
    }
    throw error;
  } finally {
    unsubscribeAppActive();
    if (stallTimer !== null) clearTimeout(stallTimer);
  }
}

/** `-1` total means the server sent no `Content-Length` — progress is unknowable. */
function downloadFraction(progress: DownloadProgressState): number {
  if (progress.totalBytes <= 0) return 0;
  return Math.min(1, progress.bytesWritten / progress.totalBytes);
}

/**
 * What playback hands to the video player: a warm local file if there is one,
 * otherwise a signed remote URL.
 *
 * Start gates on the whole chapter, so a cache miss here means the clip either
 * failed to download or did not fit the chapter's byte ceiling. If a download
 * for it is somehow still running, the clip the viewer has reached *now*
 * outranks it: past the join threshold that download is worth waiting for, and
 * below it it is cancelled so the stream is not racing a second copy of its own
 * bytes.
 */
export async function resolvePlaybackUri(sourceUri: string, signal?: AbortSignal): Promise<string> {
  const absolute = absolutizeExperienceMediaUri(sourceUri) ?? sourceUri.trim();
  const cached = peekCachedMediaUri(absolute);
  if (cached) {
    pool.touch(cacheFileFor(absolute).name);
    return cached;
  }

  const inFlight = inFlightDownloads.get(absolute);
  if (inFlight) {
    if (downloadFraction(inFlight.progress) >= DOWNLOAD_JOIN_THRESHOLD) {
      try {
        return await inFlight.promise;
      } catch {
        // Joined download failed — stream it below.
      }
    } else {
      inFlight.controller.abort();
      // Let the cancellation settle before re-resolving: the download may have
      // been in its signing step, and that shared sign task is only retired once
      // it rejects. Re-resolving now would join the rejection we just caused.
      await inFlight.promise.catch(() => undefined);
    }
  }
  return resolvePlayableMediaUrl(sourceUri, signal);
}

/**
 * Opportunistic housekeeping: drop orphan `.part` files and enforce the budget.
 * Safe to call on player mount — work is serialised with post-download eviction.
 */
export function maintainExperienceMediaCache(): Promise<void> {
  return pool.enqueueEviction();
}
