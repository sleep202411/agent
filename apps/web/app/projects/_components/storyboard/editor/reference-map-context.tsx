"use client";

import { createContext, useContext } from "react";

/**
 * Maps mention chip IDs to their reference group status.
 * Shared between RichMentionEditor and the parent dialog.
 */
export interface ReferenceMapEntry {
  /** 1-based index in reference group */
  index: number;
  /** Still in reference group? false = gray + strikethrough */
  valid: boolean;
  /** Media type: image, video, audio */
  mediaType: "image" | "video" | "audio";
  /** Display label override (e.g. "参考图 1" or character name) */
  displayLabel: string;
}

export type ReferenceMap = Map<string, ReferenceMapEntry>;

interface ReferenceMapContextValue {
  /** Map of chipId → reference status */
  map: ReferenceMap;
  /** Whether the reference group is full (disable new @ mentions) */
  isFull: boolean;
}

const ReferenceMapContext = createContext<ReferenceMapContextValue>({
  map: new Map(),
  isFull: false,
});

export const ReferenceMapProvider = ReferenceMapContext.Provider;

export function useReferenceMap() {
  return useContext(ReferenceMapContext);
}
