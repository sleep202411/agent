/**
 * The production steps that carry the full project chrome: rail, side-panel
 * dock, share dialog, agent panel, phone bottom bar. Every one of those
 * surfaces gates on this same set — the playtest deliberately renders bare.
 */
const PRODUCTION_STEP_SEGMENTS = new Set(["canvas", "script", "assets", "storyboard"]);

export function isProductionStepSegment(segment: string | null): boolean {
  return PRODUCTION_STEP_SEGMENTS.has(segment ?? "");
}
