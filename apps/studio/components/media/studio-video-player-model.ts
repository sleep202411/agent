export type StudioVideoControlDensity = "compact" | "full";

export const CANVAS_VIDEO_INTERACTIVE_MIN_ZOOM = 0.5;
export const CANVAS_VIDEO_FULL_CONTROLS_MIN_ZOOM = 0.75;

export type StudioVideoControlGeometry = {
  controlSize: number;
  timeFontSize: number;
};

export type StudioVideoManualInteraction = {
  cancelAutoPlayRequest: boolean;
  claimManualPlayback: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Keeps transformed canvas controls at or above a 24px screen-space target.
 * Below the interactive threshold the node remains a lightweight preview.
 */
export function resolveCanvasVideoControlDensity(zoom: number): StudioVideoControlDensity | null {
  if (!Number.isFinite(zoom) || zoom < CANVAS_VIDEO_INTERACTIVE_MIN_ZOOM) return null;
  return zoom < CANVAS_VIDEO_FULL_CONTROLS_MIN_ZOOM ? "compact" : "full";
}

/** Keeps controls visually stable when the player sits inside a CSS-transformed surface. */
export function resolveStudioVideoControlGeometry(renderScale: number): StudioVideoControlGeometry {
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  return {
    controlSize: clamp(32 / scale, 28, 40),
    timeFontSize: clamp(11 / scale, 10, 13),
  };
}

/** Classifies one user gesture without leaving sticky intent behind for a later playback. */
export function resolveStudioVideoManualInteraction({
  paused,
  togglesPlayback,
}: {
  paused: boolean;
  togglesPlayback: boolean;
}): StudioVideoManualInteraction {
  return {
    cancelAutoPlayRequest: togglesPlayback,
    claimManualPlayback: !paused,
  };
}
