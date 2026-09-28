"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";

/**
 * A node's production coverage, read straight from its storyboard sequence —
 * the plot tree and the storyboard are two views of one entity, so the node
 * card paints the sequence's media state instead of carrying its own copy.
 */
export interface StoryboardNodeCoverage {
  total: number;
  ready: number;
  thumbnailUrl: string | null;
  previewVideoUrl: string | null;
  /** The sequence's planned running time — the scene's interaction timeline. */
  durationMs: number;
}

const VIDEO_FILE = /\.(m4v|mov|mp4|webm)(\?|#|$)/i;

export function storyboardCoverageByNode(
  sequences: readonly StoryStoryboardSequence[]
): ReadonlyMap<string, StoryboardNodeCoverage> {
  const map = new Map<string, StoryboardNodeCoverage>();
  for (const sequence of sequences) {
    let ready = 0;
    let thumbnailUrl: string | null = null;
    let previewVideoUrl: string | null = null;
    for (const clip of sequence.clips) {
      const media = clip.selectedMediaVersion;
      if (!media) continue;
      ready += 1;
      thumbnailUrl ??= media.thumbnailUrl ?? media.previewUrl ?? null;
      if (clip.kind === "video") previewVideoUrl ??= media.previewUrl ?? null;
    }
    map.set(sequence.plotNodeId, {
      total: sequence.clips.length,
      ready,
      thumbnailUrl,
      previewVideoUrl,
      durationMs: sequence.durationMs,
    });
  }
  return map;
}

/** Image URL safe to put in an `<img>`. Video files are not stills. */
export function storyboardStillUrl(
  coverage: StoryboardNodeCoverage | null | undefined
): string | null {
  const url = coverage?.thumbnailUrl;
  if (!url || VIDEO_FILE.test(url)) return null;
  return url;
}

function sameCoverage(
  left: StoryboardNodeCoverage | null,
  right: StoryboardNodeCoverage | null
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.total === right.total &&
    left.ready === right.ready &&
    left.thumbnailUrl === right.thumbnailUrl &&
    left.previewVideoUrl === right.previewVideoUrl &&
    left.durationMs === right.durationMs
  );
}

/**
 * Per-node coverage. A storyboard refetch must wake only the cards whose
 * media actually changed — the plot tree otherwise reconciles every visible
 * editor when one upload lands.
 */
export class StoryboardCoverageStore {
  private map: ReadonlyMap<string, StoryboardNodeCoverage> = new Map();
  private listeners = new Map<string, Set<() => void>>();
  private snapshots = new Map<string, StoryboardNodeCoverage | null>();

  replace(next: ReadonlyMap<string, StoryboardNodeCoverage>) {
    const ids = new Set<string>([...this.map.keys(), ...next.keys()]);
    const changed: string[] = [];
    for (const id of ids) {
      const previous = this.snapshots.has(id)
        ? (this.snapshots.get(id) ?? null)
        : (this.map.get(id) ?? null);
      const value = next.get(id) ?? null;
      if (sameCoverage(previous, value)) continue;
      this.snapshots.set(id, value);
      changed.push(id);
    }
    this.map = next;
    for (const id of changed) {
      const listeners = this.listeners.get(id);
      if (!listeners) continue;
      for (const listener of listeners) listener();
    }
  }

  subscribe = (nodeId: string, listener: () => void) => {
    let listeners = this.listeners.get(nodeId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(nodeId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(nodeId);
    };
  };

  get = (nodeId: string): StoryboardNodeCoverage | null => {
    if (!this.snapshots.has(nodeId)) {
      this.snapshots.set(nodeId, this.map.get(nodeId) ?? null);
    }
    return this.snapshots.get(nodeId) ?? null;
  };
}

export const StoryCanvasStoryboardCoverageContext = createContext<StoryboardCoverageStore | null>(
  null
);

function coverageServerSnapshot(): StoryboardNodeCoverage | null {
  return null;
}

export function useStoryboardNodeCoverage(nodeId: string): StoryboardNodeCoverage | null {
  const store = useContext(StoryCanvasStoryboardCoverageContext);
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(nodeId, listener) : () => {}),
    [nodeId, store]
  );
  const getSnapshot = useCallback(() => (store ? store.get(nodeId) : null), [nodeId, store]);
  return useSyncExternalStore(subscribe, getSnapshot, coverageServerSnapshot);
}
