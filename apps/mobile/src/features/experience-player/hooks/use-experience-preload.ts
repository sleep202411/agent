import { adaptivePlaybackEndpoint } from "../lib/experience-playback-delivery";
import { useEffect, useMemo, useState } from "react";

import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";

import {
  EXPERIENCE_MEDIA_BUDGET_BYTES,
  cachedMediaBytes,
  clearExperienceMediaPins,
  ensureMediaCached,
  maintainExperienceMediaCache,
  pinExperienceMediaSources,
} from "../lib/experience-media-cache";
import { EXPERIENCE_PLAY_ORIENTATION, orderVideoUrisFromScene } from "../lib/experience-media";

/** Nobody is watching anything but the progress bar — use the whole pipe. */
const GATE_CONCURRENCY = 4;
/**
 * A clip that fails gets one more go from the same worker. Most failures here are
 * transient — a stall abort on a flaky link, or the app being backgrounded long
 * enough for the stall window to lapse — and a clip left uncached is a black
 * screen mid-film, which is the whole thing this gate exists to prevent.
 */
const MAX_ATTEMPTS_PER_CLIP = 2;
/** Breathing room before a retry, so a flapping link is not hammered. */
const RETRY_DELAY_MS = 1_500;
/**
 * Ceiling for one chapter's share of the cache pool. The chapter being played is
 * pinned against eviction, so without a ceiling a chapter larger than the pool
 * would grow the cache without bound *and* never satisfy the gate. Hitting it
 * stops prefetch and opens the gate: an oversized chapter plays progressively,
 * streaming whatever did not fit, instead of never starting.
 */
const CHAPTER_BYTE_CEILING = EXPERIENCE_MEDIA_BUDGET_BYTES * 0.9;

/**
 * Downloads the chapter's clips to on-device cache and gates Start on all of
 * them, so no scene transition mid-film waits on the network. Nothing downloads
 * behind playback: by the time Start opens there is nothing left to fetch.
 *
 * Uses HTTP file download rather than AVPlayer warm-up: avoids native track
 * probe timeouts, and leaves real bytes on disk for playback to hit. A clip that
 * keeps failing still counts as settled — one bad URI cannot permanently lock
 * Start, and playback falls back to streaming that clip.
 *
 * `percent` is byte-accurate within each clip and weights clips equally, so the
 * bar moves continuously rather than in one step per finished file.
 */
export function useExperiencePreload(manifest: ExperienceRuntimeManifest): {
  percent: number;
  done: boolean;
} {
  const chapterUris = useMemo(
    () =>
      orderVideoUrisFromScene(manifest, manifest.graph.entrySceneId, EXPERIENCE_PLAY_ORIENTATION)
        // Native adaptive clips negotiate on entry; do not download the progressive chapter first.
        .filter((uri) => adaptivePlaybackEndpoint(uri) === null),
    [manifest]
  );
  const [chapterKey, setChapterKey] = useState(chapterUris);
  const [percent, setPercent] = useState(0);
  const [done, setDone] = useState(() => chapterUris.length === 0);
  if (chapterUris !== chapterKey) {
    setChapterKey(chapterUris);
    setPercent(0);
    setDone(chapterUris.length === 0);
  }

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    // Shield this chapter from the pool's LRU before anything downloads, then
    // run a budget pass so stale chapters give up their room first.
    pinExperienceMediaSources(chapterUris);
    void maintainExperienceMediaCache().catch(() => undefined);

    const settledUris = new Set<string>();
    const activeUris = new Set<string>();
    const fractions = new Map<string, number>();
    /** URIs already counted toward `chapterBytes`, so nothing is counted twice. */
    const countedUris = new Set<string>();
    let chapterBytes = 0;
    for (const uri of chapterUris) {
      const bytes = cachedMediaBytes(uri);
      if (bytes <= 0) continue;
      countedUris.add(uri);
      chapterBytes += bytes;
    }
    let stopped = chapterBytes >= CHAPTER_BYTE_CEILING;
    let gateOpen = chapterUris.length === 0;

    const publishPercent = () => {
      if (cancelled || gateOpen) return;
      const warmed = chapterUris.reduce(
        (total, uri) => total + (settledUris.has(uri) ? 1 : (fractions.get(uri) ?? 0)),
        0
      );
      // Capped below 100, and monotonic: a restarted download must not rewind a
      // bar the viewer is already watching.
      const next = Math.min(99, Math.floor((warmed / chapterUris.length) * 100));
      setPercent((current) => (current >= next ? current : next));
    };

    const openGate = () => {
      if (gateOpen || cancelled) return;
      gateOpen = true;
      setDone(true);
    };

    const countBytes = (uri: string) => {
      if (countedUris.has(uri)) return;
      const bytes = cachedMediaBytes(uri);
      if (bytes <= 0) return;
      countedUris.add(uri);
      chapterBytes += bytes;
    };

    const claimNextUri = () => {
      const claimed = chapterUris.find((uri) => !settledUris.has(uri) && !activeUris.has(uri));
      if (claimed !== undefined) activeUris.add(claimed);
      return claimed;
    };

    const waitToRetry = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, RETRY_DELAY_MS);
        abort.signal.addEventListener("abort", finish, { once: true });
        if (abort.signal.aborted) finish();
      });

    /**
     * One worker owns a clip until it is cached or out of attempts. Handing a
     * retry back to the shared queue would let the last worker exit while a
     * clip is still owed one, and the gate would open on a hole.
     */
    const warmUntilSettled = async (uri: string) => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CLIP; attempt += 1) {
        if (cancelled) return;
        try {
          await ensureMediaCached(uri, {
            signal: abort.signal,
            onProgress: (fraction) => {
              fractions.set(uri, fraction);
              publishPercent();
            },
          });
          return;
        } catch {
          if (cancelled || attempt === MAX_ATTEMPTS_PER_CLIP) return;
          await waitToRetry();
        }
      }
    };

    const worker = async () => {
      while (!cancelled && !stopped) {
        const uri = claimNextUri();
        if (uri === undefined) return;
        await warmUntilSettled(uri);
        if (cancelled) return;
        activeUris.delete(uri);
        // Settled either way: a clip that never arrived is streamed by playback
        // rather than holding Start shut.
        settledUris.add(uri);
        countBytes(uri);
        publishPercent();
        if (chapterBytes >= CHAPTER_BYTE_CEILING) {
          stopped = true;
          openGate();
        }
      }
    };

    void (async () => {
      await Promise.all(
        Array.from({ length: Math.min(GATE_CONCURRENCY, chapterUris.length) }, () => worker())
      );
      if (cancelled) return;
      openGate();
    })();

    return () => {
      cancelled = true;
      abort.abort();
      clearExperienceMediaPins();
    };
  }, [chapterUris]);

  return { percent, done };
}
