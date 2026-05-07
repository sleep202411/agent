"use client";

/**
 * Produce-mode seed — the spark-analysis snapshot the create-world
 * dialog hands off when launching a new project into the production
 * pipeline. Persisted in sessionStorage keyed by `projectId` so:
 *   - It can re-seed Step 1 if the user reloads before confirming.
 *   - The generated Step 1 draft itself is not stored here; refreshing
 *     discards that draft and starts a new analysis if the seed remains.
 *   - Two projects can hold their own seeds without collision.
 *
 * sessionStorage is the right primitive for now: this is a one-shot
 * hand-off, not durable state. When the consult/save endpoint lands
 * we'll persist the analysis server-side against `projectId` and
 * read from there instead — at which point this module becomes the
 * client-side cache for that read.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

export interface ProduceSeed {
  worldId?: string;
  worldName: string;
  description: string;
  /** Themes / genre tags surfaced by spark, e.g. ["战国","墨家","科幻"]. */
  tags: string[];
  episodeCount?: number;
  runtimeMinutes?: number;
  language?: string;
  roleCount?: number;
  sceneCount?: number;
  propCount?: number;
  sourceFile?: {
    name: string;
    size: number;
    mimeType: string;
    path: string;
    textRef?: string;
    chars?: number;
    excerpt?: string;
  };
  /** Epoch ms — lets the consumer warn if the seed is unexpectedly old. */
  createdAt: number;
}

export interface ProduceCommittedAsset {
  clientRefId: string;
  assetType: "role" | "scene" | "prop";
  assetId: string;
  name: string;
  description: string;
  prompt: string;
}

export interface ProduceCommittedResult {
  projectId: string;
  worldId: string;
  title?: string;
  committedAt: number;
  episodes: Array<{
    clientRefId: string;
    episodeId: string;
    no: number;
    title: string;
    scriptChars: number;
    shotCount: number;
  }>;
  assets: {
    characters: ProduceCommittedAsset[];
    scenes: ProduceCommittedAsset[];
    props: ProduceCommittedAsset[];
  };
  totals: {
    episodeCount: number;
    characterCount: number;
    sceneCount: number;
    propCount: number;
    shotCount: number;
  };
}

function seedKey(projectId: string): string {
  return `produce-seed:${projectId}`;
}

function committedKey(projectId: string): string {
  return `produce-committed:${projectId}`;
}

const PRODUCE_STORAGE_EVENT = "produce-storage-change";

function notifyStorageKey(key: string): void {
  window.dispatchEvent(new CustomEvent(PRODUCE_STORAGE_EVENT, { detail: { key } }));
}

export function saveProduceSeed(projectId: string, seed: ProduceSeed): void {
  if (typeof window === "undefined") return;
  try {
    const key = seedKey(projectId);
    window.sessionStorage.setItem(key, JSON.stringify(seed));
    notifyStorageKey(key);
  } catch (err) {
    console.warn("[produce] saveProduceSeed failed:", err);
  }
}

export function loadProduceSeed(projectId: string): ProduceSeed | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(seedKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as ProduceSeed;
  } catch (err) {
    console.warn("[produce] loadProduceSeed failed:", err);
    return null;
  }
}

export function clearProduceSeed(projectId: string): void {
  if (typeof window === "undefined") return;
  const key = seedKey(projectId);
  window.sessionStorage.removeItem(key);
  notifyStorageKey(key);
}

/**
 * Atomically read+remove the seed. Used by `useProducePipeline`'s mount
 * effect to bootstrap an in-memory run from the dialog hand-off. After
 * the page mount consumes it, sessionStorage is empty — refresh /
 * direct nav from then on shows the upload card. The pipeline keeps
 * its own React-state copy so the same seed survives retry without
 * leaving state behind across page navigations.
 */
export function consumeProduceSeed(projectId: string): ProduceSeed | null {
  if (typeof window === "undefined") return null;
  try {
    const key = seedKey(projectId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    notifyStorageKey(key);
    return JSON.parse(raw) as ProduceSeed;
  } catch (err) {
    console.warn("[produce] consumeProduceSeed failed:", err);
    return null;
  }
}

export function saveProduceCommittedResult(
  projectId: string,
  result: ProduceCommittedResult
): void {
  if (typeof window === "undefined") return;
  const key = committedKey(projectId);
  window.sessionStorage.setItem(key, JSON.stringify(result));
  notifyStorageKey(key);
}

export function loadProduceCommittedResult(projectId: string): ProduceCommittedResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(committedKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as ProduceCommittedResult;
  } catch (err) {
    console.warn("[produce] loadProduceCommittedResult failed:", err);
    return null;
  }
}

/**
 * Hook variant — reads the seed once on mount and exposes it as
 * state so the consumer can render synchronously after hydration.
 * Reads on the client only (sessionStorage is undefined during SSR).
 */
export function useProduceSeed(projectId: string): ProduceSeed | null {
  const raw = useSessionStorageRaw(projectId ? seedKey(projectId) : null);
  return useMemo(() => parseJson<ProduceSeed>(raw), [raw]);
}

export function useProduceCommittedResult(
  projectId: string,
  enabled = true
): ProduceCommittedResult | null {
  const raw = useSessionStorageRaw(projectId ? committedKey(projectId) : null);
  const cachedResult = useMemo(() => parseJson<ProduceCommittedResult>(raw), [raw]);
  const [remoteResult, setRemoteResult] = useState<ProduceCommittedResult | null>(null);
  const result = cachedResult ?? remoteResult;

  useEffect(() => {
    if (!enabled || !projectId || result) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/aurora/produce/script-draft/committed", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          ok?: boolean;
          result?: ProduceCommittedResult;
        };
        if (!cancelled && body.result) {
          saveProduceCommittedResult(projectId, body.result);
          setRemoteResult(body.result);
        }
      } catch {
        // Empty state is acceptable; Step 1 is the canonical entry point.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, result]);

  return result;
}

function useSessionStorageRaw(key: string | null): string | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => undefined;
      const onStorage = (event: StorageEvent) => {
        if (!key || event.key === key) onStoreChange();
      };
      const onCustom = (event: Event) => {
        const detail = (event as CustomEvent<{ key?: string }>).detail;
        if (!key || detail?.key === key) onStoreChange();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(PRODUCE_STORAGE_EVENT, onCustom);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(PRODUCE_STORAGE_EVENT, onCustom);
      };
    },
    [key]
  );

  const getSnapshot = useCallback(() => {
    if (!key || typeof window === "undefined") return null;
    return window.sessionStorage.getItem(key);
  }, [key]);

  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
