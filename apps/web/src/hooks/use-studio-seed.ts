"use client";

import { useEffect, useState } from "react";
import { STUDIO_SEED_STORAGE_KEY, type StudioSeed } from "@/src/types/studio-seed";

interface StoredSeedEnvelope {
  projectId: string;
  worldId?: string;
  seed: StudioSeed;
}

/**
 * Module-level cache for the seed read.
 *
 * Why module-scope (not `useRef`): React 18 Strict Mode in dev double-
 * mounts components. With a per-instance ref guard, the first effect
 * read sessionStorage and **cleared it**; the second remount then saw
 * nothing and ended up with `seed === null`. By caching at module
 * scope, both invocations of the hook (across the strict-mode
 * mount/unmount/remount) share the same single read, and the seed
 * survives intact.
 *
 *   undefined = "haven't tried reading yet"
 *   null      = "tried, no seed (or unparseable)"
 *   {...}     = "successful read"
 *
 * The cache persists for the lifetime of the page (until full reload).
 * That's fine because the seed is single-use anyway: once a project
 * page consumes it, subsequent navigations will see a non-matching
 * `projectId` and skip it.
 */
let _seedCache: StoredSeedEnvelope | null | undefined;

function readSeedFromStorage(): StoredSeedEnvelope | null {
  if (_seedCache !== undefined) return _seedCache;
  if (typeof window === "undefined") {
    _seedCache = null;
    return null;
  }
  try {
    const raw = sessionStorage.getItem(STUDIO_SEED_STORAGE_KEY);
    if (!raw) {
      _seedCache = null;
      return null;
    }
    const payload = JSON.parse(raw) as StoredSeedEnvelope;
    // Clear the slot immediately so a hard refresh of the project
    // page doesn't try to consume the seed a second time.
    sessionStorage.removeItem(STUDIO_SEED_STORAGE_KEY);
    _seedCache = payload;
    console.info("[studio-seed] consumed from sessionStorage", payload);
    return payload;
  } catch (err) {
    console.warn("[studio-seed] sessionStorage read failed", err);
    _seedCache = null;
    return null;
  }
}

/**
 * Picks up the studio composer's seed for the project workspace.
 *
 * The composer (`/art-studio` home) writes
 *   `{ projectId, worldId, seed }`
 * into `sessionStorage[STUDIO_SEED_STORAGE_KEY]` and navigates here.
 * On mount we read once (via the module-level cache, see above) and
 * surface the seed if its projectId matches the current page.
 * This replaces the legacy iframe postMessage protocol that was used
 * when /art-studio lived inside fizzdragon-web — same-origin Next.js
 * doesn't need the round-trip.
 */
export function useStudioSeed(projectId?: string | null): {
  seed: StudioSeed | null;
  ready: boolean;
} {
  const [seed, setSeed] = useState<StudioSeed | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const payload = readSeedFromStorage();
    if (!payload) {
      setReady(true);
      return;
    }

    // Only surface the seed when it was written for THIS project.
    // Mismatch means the user navigated to a different project than
    // the one the seed was minted for — skip silently.
    if (projectId && payload.projectId !== projectId) {
      setReady(true);
      return;
    }

    setSeed(payload.seed);
    setReady(true);
  }, [projectId]);

  return { seed, ready };
}
