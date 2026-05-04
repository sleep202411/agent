"use client";

import { useEffect, useRef, useState } from "react";
import { STUDIO_SEED_STORAGE_KEY, type StudioSeed } from "@/src/types/studio-seed";

interface StoredSeedEnvelope {
  projectId: string;
  worldId?: string;
  seed: StudioSeed;
}

/**
 * Picks up the studio composer's seed for the project workspace.
 *
 * The composer (`/art-studio` home) writes
 *   `{ projectId, worldId, seed }`
 * into `sessionStorage[STUDIO_SEED_STORAGE_KEY]` and navigates here.
 * On mount we read once, clear the slot, and surface the seed if its
 * projectId matches the current page. This replaces the legacy iframe
 * postMessage protocol that was used when /art-studio lived inside
 * fizzdragon-web — same-origin Next.js doesn't need the round-trip.
 */
export function useStudioSeed(projectId?: string | null): {
  seed: StudioSeed | null;
  ready: boolean;
} {
  const [seed, setSeed] = useState<StudioSeed | null>(null);
  const [ready, setReady] = useState(false);
  const consumedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (consumedRef.current) return;
    consumedRef.current = true;

    let payload: StoredSeedEnvelope | null = null;
    try {
      const raw = sessionStorage.getItem(STUDIO_SEED_STORAGE_KEY);
      if (raw) payload = JSON.parse(raw) as StoredSeedEnvelope;
    } catch (err) {
      console.warn("[studio-seed] sessionStorage read failed", err);
    }

    if (!payload) {
      setReady(true);
      return;
    }

    // Only consume the seed when it was written for THIS project.
    // Mismatch means the user navigated away mid-flow or opened an
    // unrelated project — leave the slot alone for the right page.
    if (projectId && payload.projectId !== projectId) {
      setReady(true);
      return;
    }

    sessionStorage.removeItem(STUDIO_SEED_STORAGE_KEY);
    console.info("[studio-seed] consumed from sessionStorage", payload);
    setSeed(payload.seed);
    setReady(true);
  }, [projectId]);

  return { seed, ready };
}
