export type HotspotRect = { x: number; y: number; width: number; height: number };
export type HotspotPoint = { x: number; y: number };
export const HOTSPOT_MIN_SIZE = 0.035;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function hotspotRect(value: unknown): HotspotRect | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const [x, y, width, height] = ["x", "y", "width", "height"].map((k) =>
    typeof input[k] !== "number" && (typeof input[k] !== "string" || !input[k].trim())
      ? NaN
      : Number(input[k])
  );
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 ||
    y + height > 1
  )
    return null;
  return { x, y, width, height };
}
export function placeHotspot(
  mode: "draw" | "move" | "resize",
  original: HotspotRect,
  start: HotspotPoint,
  end: HotspotPoint
): HotspotRect {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite))
    throw Error("Hotspot placement is unavailable.");
  if (mode === "move")
    return {
      ...original,
      x: clamp(original.x + end.x - start.x, 0, 1 - original.width),
      y: clamp(original.y + end.y - start.y, 0, 1 - original.height),
    };
  if (mode === "resize")
    return {
      ...original,
      width: clamp(
        original.width + end.x - start.x,
        Math.min(HOTSPOT_MIN_SIZE, 1 - original.x),
        1 - original.x
      ),
      height: clamp(
        original.height + end.y - start.y,
        Math.min(HOTSPOT_MIN_SIZE, 1 - original.y),
        1 - original.y
      ),
    };
  const x = clamp(Math.min(start.x, end.x), 0, 1 - HOTSPOT_MIN_SIZE),
    y = clamp(Math.min(start.y, end.y), 0, 1 - HOTSPOT_MIN_SIZE);
  return {
    x,
    y,
    width: clamp(Math.abs(end.x - start.x), HOTSPOT_MIN_SIZE, 1 - x),
    height: clamp(Math.abs(end.y - start.y), HOTSPOT_MIN_SIZE, 1 - y),
  };
}
