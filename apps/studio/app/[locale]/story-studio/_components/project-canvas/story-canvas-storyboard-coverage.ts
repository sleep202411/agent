"use client";

import { createContext, useContext } from "react";
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

export const StoryCanvasStoryboardCoverageContext = createContext<ReadonlyMap<
  string,
  StoryboardNodeCoverage
> | null>(null);

export function useStoryboardNodeCoverage(nodeId: string): StoryboardNodeCoverage | null {
  const map = useContext(StoryCanvasStoryboardCoverageContext);
  return map?.get(nodeId) ?? null;
}
