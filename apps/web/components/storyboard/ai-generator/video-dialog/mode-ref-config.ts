/**
 * Per-mode reference group configuration.
 * Defines which reference fields each mode uses, their capacity, and accepted media types.
 */

export interface ModeRefSlot {
  /** Redux field name in VideoReferences */
  field: string;
  /** Max items for this slot */
  maxCount: number;
  /** Accepted media types */
  accept: Array<"image" | "video" | "audio">;
  /** Display label for this slot (e.g. "首帧", "尾帧") */
  label?: string;
}

export interface ModeRefConfig {
  slots: ModeRefSlot[];
  /** Total max across all slots */
  totalMax: number;
}

const configs: Record<string, ModeRefConfig> = {
  reference: {
    slots: [{ field: "referenceImages", maxCount: 1, accept: ["image"] }],
    totalMax: 1,
  },
  frames: {
    slots: [
      { field: "firstFrames", maxCount: 1, accept: ["image"], label: "首帧" },
      { field: "lastFrames", maxCount: 1, accept: ["image"], label: "尾帧" },
    ],
    totalMax: 2,
  },
  multiReference: {
    slots: [{ field: "multiRefImages", maxCount: 3, accept: ["image"] }],
    totalMax: 3,
  },
  multimodal: {
    slots: [
      { field: "referenceImages", maxCount: 9, accept: ["image"] },
      { field: "firstFrames", maxCount: 3, accept: ["video"] },
      { field: "lastFrames", maxCount: 3, accept: ["audio"] },
    ],
    totalMax: 12,
  },
  repaint: {
    slots: [
      { field: "repaintRefVideos", maxCount: 1, accept: ["video"] },
      { field: "repaintRefImage", maxCount: 1, accept: ["image"] },
    ],
    totalMax: 2,
  },
  localEdit: {
    slots: [
      { field: "localEditRefVideo", maxCount: 1, accept: ["video"] },
      { field: "localEditMaskImage", maxCount: 1, accept: ["image"] },
      { field: "localEditRefImage", maxCount: 1, accept: ["image"] },
    ],
    totalMax: 3,
  },
  extend: {
    slots: [
      { field: "extendFirstClip", maxCount: 1, accept: ["video"] },
      { field: "extendLastClip", maxCount: 1, accept: ["video"] },
      { field: "extendFirstFrame", maxCount: 1, accept: ["image"] },
      { field: "extendLastFrame", maxCount: 1, accept: ["image"] },
    ],
    totalMax: 4,
  },
  outpainting: {
    slots: [{ field: "outpaintingRefVideo", maxCount: 1, accept: ["video"] }],
    totalMax: 1,
  },
};

/** Fallback config for unknown modes */
const DEFAULT_CONFIG: ModeRefConfig = {
  slots: [{ field: "referenceImages", maxCount: 1, accept: ["image"] }],
  totalMax: 1,
};

/**
 * Get reference config for a video mode.
 * `activeMode` is either editMode or uploadMode.
 */
export function getModeRefConfig(activeMode: string): ModeRefConfig {
  return configs[activeMode] ?? DEFAULT_CONFIG;
}

/**
 * Count total references across all slots for a mode.
 */
export function countAllRefs(references: Record<string, unknown[]>, config: ModeRefConfig): number {
  return config.slots.reduce((sum, slot) => {
    const arr = references[slot.field];
    return sum + (Array.isArray(arr) ? arr.length : 0);
  }, 0);
}

/**
 * Find the first slot that has capacity and accepts the given media type.
 */
export function findAvailableSlot(
  references: Record<string, unknown[]>,
  config: ModeRefConfig,
  mediaType: "image" | "video" | "audio" = "image"
): ModeRefSlot | null {
  for (const slot of config.slots) {
    if (!slot.accept.includes(mediaType)) continue;
    const arr = references[slot.field];
    const count = Array.isArray(arr) ? arr.length : 0;
    if (count < slot.maxCount) return slot;
  }
  return null;
}
