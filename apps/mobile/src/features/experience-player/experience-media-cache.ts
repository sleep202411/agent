import { Directory, File, Paths } from "expo-file-system";

import { absolutizeExperienceMediaUri, resolvePlayableMediaUrl } from "./experience-media";

const CACHE_DIR_NAME = "experience-media";
/** Full-file download stall — longer than URL resolve; short enough to unblock Start. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

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

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, CACHE_DIR_NAME);
}

function cacheFileFor(sourceUri: string): File {
  return new File(cacheDirectory(), `${stableSourceKey(sourceUri)}.mp4`);
}

/**
 * Downloads land here first and are moved into place only once complete, so a
 * concurrent reader can never pick up a half-written file. Android streams
 * straight into the destination otherwise (iOS already stages internally).
 */
function partialFileFor(sourceUri: string): File {
  return new File(cacheDirectory(), `${stableSourceKey(sourceUri)}.part`);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Concurrent cleanup / unreadable entry — nothing to recover.
  }
}

function ensureCacheDirectory(): void {
  const dir = cacheDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
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

/**
 * In-flight downloads by absolute source URI. A second request for a clip that
 * is already downloading joins the first instead of racing it onto the same
 * path — and therefore also inherits the first caller's abort signal.
 */
const inFlightDownloads = new Map<string, Promise<string>>();

/**
 * Download the playable remote URL into the on-device cache. Returns a `file://`
 * URI. Failures delete partial files so the next attempt starts clean.
 */
export function ensureMediaCached(sourceUri: string, signal?: AbortSignal): Promise<string> {
  const absolute = absolutizeExperienceMediaUri(sourceUri) ?? sourceUri.trim();
  const existing = peekCachedMediaUri(absolute);
  if (existing) return Promise.resolve(existing);

  const pending = inFlightDownloads.get(absolute);
  if (pending) return pending;

  const task = downloadToCache(absolute, signal).finally(() => {
    inFlightDownloads.delete(absolute);
  });
  inFlightDownloads.set(absolute, task);
  return task;
}

async function downloadToCache(absolute: string, signal?: AbortSignal): Promise<string> {
  const playable = await resolvePlayableMediaUrl(absolute, signal);
  if (playable.startsWith("file://")) return playable;

  ensureCacheDirectory();
  const destination = cacheFileFor(absolute);
  const partial = partialFileFor(absolute);
  // A leftover .part means a previous run was killed mid-download.
  deleteQuietly(partial);

  let timedOut = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DOWNLOAD_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  signal?.addEventListener("abort", onParentAbort);

  try {
    if (signal?.aborted) {
      throw new Error("Media download cancelled");
    }
    const output = await File.downloadFileAsync(playable, partial, {
      idempotent: true,
      signal: controller.signal,
    });
    if (!output.exists || output.size <= 0) {
      throw new Error("Media download produced an empty file");
    }
    deleteQuietly(destination);
    await output.move(destination);
    return destination.uri;
  } catch (error) {
    deleteQuietly(partial);
    if (timedOut) {
      throw new Error("Media download timed out");
    }
    if (signal?.aborted || controller.signal.aborted) {
      throw new Error("Media download cancelled");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

/** Prefer a warm local file; otherwise return the signed remote playable URL. */
export async function resolvePlaybackUri(sourceUri: string, signal?: AbortSignal): Promise<string> {
  const cached = peekCachedMediaUri(sourceUri);
  if (cached) return cached;
  return resolvePlayableMediaUrl(sourceUri, signal);
}
