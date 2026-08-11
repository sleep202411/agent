import { useEffect, useMemo, useState } from "react";

import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";

import { ensureMediaCached } from "./experience-media-cache";
import { EXPERIENCE_PLAY_ORIENTATION, planCatalogueVideoUris } from "./experience-media";

/** Opening scene gets the bandwidth — the viewer is watching a progress bar. */
const CRITICAL_CONCURRENCY = 2;
/** Behind playback: one at a time so it never starves the clip on screen. */
const DEFERRED_CONCURRENCY = 1;

const NOTHING_SETTLED: ReadonlySet<string> = new Set();

/**
 * Downloads the chapter's clips to on-device cache. Start is gated on the
 * opening scene only; the rest keeps warming while the viewer watches, so a
 * branch that is never taken is never waited for.
 *
 * Uses HTTP file download rather than AVPlayer warm-up: avoids native track
 * probe timeouts, and leaves real bytes on disk for playback to hit. A clip
 * that fails or times out still counts as settled — one bad URI cannot
 * permanently lock Start, and playback surfaces its own error.
 */
export function useExperiencePreload(manifest: ExperienceRuntimeManifest): {
  total: number;
  loaded: number;
  done: boolean;
} {
  const plan = useMemo(
    () => planCatalogueVideoUris(manifest, EXPERIENCE_PLAY_ORIENTATION),
    [manifest]
  );
  // Keyed by URI rather than counted: a manifest swap needs no reset pass, and
  // a clip that is already on disk stays settled.
  const [settled, setSettled] = useState(NOTHING_SETTLED);

  const total = plan.critical.length;
  const loaded = useMemo(
    () => plan.critical.reduce((count, uri) => (settled.has(uri) ? count + 1 : count), 0),
    [plan.critical, settled]
  );

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    const markSettled = (uri: string) => {
      if (cancelled) return;
      setSettled((current) => {
        if (current.has(uri)) return current;
        const next = new Set(current);
        next.add(uri);
        return next;
      });
    };

    const warm = async (uris: readonly string[], concurrency: number) => {
      let nextIndex = 0;
      const worker = async () => {
        while (!cancelled) {
          const uri = uris[nextIndex];
          nextIndex += 1;
          if (uri === undefined) return;
          try {
            await ensureMediaCached(uri, abort.signal);
          } catch {
            // Settled-but-failed: playback falls back to the remote URL.
          }
          markSettled(uri);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, uris.length) }, () => worker()));
    };

    void (async () => {
      await warm(plan.critical, CRITICAL_CONCURRENCY);
      if (cancelled) return;
      await warm(plan.deferred, DEFERRED_CONCURRENCY);
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [plan]);

  return { total, loaded, done: total === 0 || loaded >= total };
}
