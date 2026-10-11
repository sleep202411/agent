/** Stable Web ShotNodeData keys; localised labels never enter the CRDT. */
export const CANVAS_SHOT_FIELDS = [
  "label",
  "shotSize",
  "perspective",
  "movement",
  "durationSeconds",
  "dialogue",
  "notes",
  "description",
  "imagePrompt",
  "videoPrompt",
] as const;
export type CanvasShotField = (typeof CANVAS_SHOT_FIELDS)[number];
const shotOptions = {
  shotSize: ["extremeWide", "wide", "full", "medium", "closeUp", "extremeCloseUp"],
  perspective: ["eyeLevel", "high", "low", "birdsEye", "overShoulder", "pov", "dutch"],
  movement: ["static", "pan", "tilt", "dolly", "tracking", "zoom", "handheld", "crane"],
} as const;
export type CanvasShotOption = (typeof shotOptions)[keyof typeof shotOptions][number];
export const CANVAS_SHOT_OPTIONS: Partial<Record<CanvasShotField, readonly CanvasShotOption[]>> =
  shotOptions;
export function isCanvasShotOption(
  field: CanvasShotField,
  value: unknown
): value is CanvasShotOption {
  return (
    typeof value === "string" &&
    (CANVAS_SHOT_OPTIONS[field] as readonly string[] | undefined)?.includes(value) === true
  );
}
export function isCanvasShotField(value: string): value is CanvasShotField {
  return (CANVAS_SHOT_FIELDS as readonly string[]).includes(value);
}
export function canvasShotValue(field: CanvasShotField, text: string): string | number | undefined {
  const options = CANVAS_SHOT_OPTIONS[field];
  if (options && text && !isCanvasShotOption(field, text))
    throw Error("Invalid storyboard option.");
  if (field === "durationSeconds") {
    if (!text.trim()) return undefined;
    const value = Number(text.trim().replace(",", "."));
    if (!Number.isFinite(value) || value <= 0)
      throw Error("Duration must be a positive number of seconds.");
    return value;
  }
  return (field === "label" ? text.trim() : text) || undefined;
}
