"use client";

import { useCallback, useEffect, useState, useRef, useLayoutEffect } from "react";
import { STUDIO_SEED_STORAGE_KEY, type StudioSeed } from "@/src/types/studio-seed";

type CapturedSeed = { raw: string; projectId: string; seed: StudioSeed };
function readSeed(projectId: string): CapturedSeed | null {
  try {
    const raw = sessionStorage.getItem(STUDIO_SEED_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value?.projectId !== projectId) return null;
    const seed = value.seed;
    if (
      !seed ||
      typeof seed.prompt !== "string" ||
      ![null, "character", "episode", "prop", "scene", "scriptwriter", "storyboard"].includes(
        seed.agent
      )
    )
      return null;
    if (
      seed.attachment &&
      (typeof seed.attachment.ref !== "string" ||
        typeof seed.attachment.name !== "string" ||
        typeof seed.attachment.mimeType !== "string" ||
        !Number.isFinite(seed.attachment.size) ||
        seed.attachment.size < 0 ||
        (seed.attachment.excerpt !== undefined && typeof seed.attachment.excerpt !== "string"))
    )
      return null;
    return { raw, projectId, seed };
  } catch {
    return null;
  }
}

/** Read without consuming: only the active consumer may claim the exact stored value. */
export function useStudioSeed(projectId?: string | null) {
  const [captured, setCaptured] = useState<CapturedSeed | null>(null);
  const [readyScope, setReadyScope] = useState<string | null>(null);
  const scope = JSON.stringify([projectId]);
  useEffect(() => {
    let abandoned = false;
    void Promise.resolve().then(() => {
      if (abandoned) return;
      setCaptured(projectId ? readSeed(projectId) : null);
      setReadyScope(scope);
    });
    return () => {
      abandoned = true;
    };
  }, [projectId, scope]);
  const current = captured?.projectId === projectId ? captured : null;
  const active = useRef<typeof current>(null);
  useLayoutEffect(() => {
    active.current = current;
    return () => {
      active.current = null;
    };
  }, [current]);
  const claim = useCallback(() => {
    if (!current || active.current !== current) return false;
    try {
      if (sessionStorage.getItem(STUDIO_SEED_STORAGE_KEY) !== current.raw) return false;
      sessionStorage.removeItem(STUDIO_SEED_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }, [current]);
  return { seed: current?.seed ?? null, ready: readyScope === scope, claim };
}
