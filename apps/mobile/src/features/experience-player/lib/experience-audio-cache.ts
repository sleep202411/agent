import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { resolveExperienceAssetUrl } from "@/config";

import { createDiskCachePool, deleteQuietly } from "./experience-disk-cache";

/**
 * Audio cues are small next to video but there are many of them per chapter;
 * 128 MiB holds several chapters' worth of stingers, loops and VO.
 */
const CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

const pool = createDiskCachePool({
  dirName: "experience-audio",
  budgetBytes: CACHE_BUDGET_BYTES,
  // `<sha256>.<ext>` only — staging files end in `.part` and are scratch.
  isManaged: (name) => /^[0-9a-f]{64}\.[a-z0-9]+$/.test(name),
  isScratch: (name) => name.endsWith(".part"),
  // A cue finishing must not scrub the staging file of one still writing.
  protectedFileNames: () => new Set([...inFlight.keys()].map(stagingNameFor)),
});

/**
 * Cache files are named by the manifest's expected SHA-256, so a file that
 * exists under that name *is* the verified bytes. That makes the second play of
 * a cue a pure disk hit: no fetch, and no full-buffer hash on the JS heap
 * (Hermes has no WebCrypto, so verification means holding the whole asset in
 * memory — worth paying exactly once per asset per device).
 */
function cacheFileName(expectedSha256: string, uri: string): string {
  return `${expectedSha256}.${extensionFor(uri)}`;
}

function stagingNameFor(cacheName: string): string {
  return `${cacheName}.part`;
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Local `file://` URI for a manifest audio variant, downloading and integrity
 * checking it on first use.
 */
export function ensureAudioCached(uri: string, expectedSha256: string): Promise<string> {
  const absolute = resolveExperienceAssetUrl(uri);
  const name = cacheFileName(expectedSha256, absolute);
  const cached = peekCachedAudioUri(name);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(name);
  if (pending) return pending;

  const task = downloadVerified(absolute, expectedSha256, name).finally(() => {
    inFlight.delete(name);
  });
  inFlight.set(name, task);
  return task;
}

function peekCachedAudioUri(name: string): string | null {
  const file = pool.file(name);
  try {
    if (file.exists && file.size > 0) {
      pool.touch(name);
      return file.uri;
    }
  } catch {
    // Missing / unreadable — treat as cache miss.
  }
  return null;
}

async function downloadVerified(
  absolute: string,
  expectedSha256: string,
  name: string
): Promise<string> {
  const response = await fetch(absolute);
  if (!response.ok) {
    throw new Error(`Audio asset could not be loaded (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytesToHex(sha256(bytes)) !== expectedSha256) {
    throw new Error(`Audio asset ${absolute} failed integrity validation`);
  }

  pool.ensureDirectory();
  const destination = pool.file(name);
  const partial = pool.file(stagingNameFor(name));
  deleteQuietly(partial);
  try {
    partial.create({ intermediates: true, overwrite: true });
    partial.write(bytes);
    deleteQuietly(destination);
    await partial.move(destination);
  } catch (error) {
    deleteQuietly(partial);
    throw error;
  }
  pool.touch(name);
  void pool.enqueueEviction(new Set([name])).catch(() => undefined);
  return destination.uri;
}

function extensionFor(uri: string): string {
  try {
    const path = new URL(uri).pathname;
    const match = path.match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) return match[1].toLowerCase();
  } catch {
    // Relative URI without a recognisable extension.
  }
  return "m4a";
}

/** Opportunistic housekeeping — drop orphan `.part` files and enforce the budget. */
export function maintainExperienceAudioCache(): Promise<void> {
  return pool.enqueueEviction();
}
