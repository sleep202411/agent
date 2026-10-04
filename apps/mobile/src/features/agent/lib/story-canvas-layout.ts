import { canvasPositionEditSchema } from "../../../../canvas-editor/position-schema";
import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import { canvasGroups } from "../../../../canvas-editor/group-schema";
import { canvasOverview } from "./story-canvas-overview";

/** Web canvas-core/node-geometry: measurements are ephemeral and legacy
 * persisted width/height must not change the shared layout projection. */
const sizes: Record<string, readonly [number, number]> = {
  note: [280, 188],
  image: [320, 260],
  videoAsset: [320, 220],
  audioAsset: [320, 156],
  shot: [320, 284],
  panorama: [360, 224],
  prompt: [360, 408],
  video: [360, 280],
  audio: [360, 216],
};
export type CanvasBounds = { x: number; y: number; width: number; height: number };
export type CanvasCamera = { x: number; y: number; scale: number };
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
function size(type: string, data: Record<string, unknown>): readonly [number, number] {
  if (type !== "storyCanvas") return Object.hasOwn(sizes, type) ? sizes[type] : [320, 240];
  if (data.kind === "character") return [280, 140];
  if (data.kind === "decision")
    return [360, 200 + Math.max(2, Array.isArray(data.choices) ? data.choices.length : 0) * 52];
  const interactions = Array.isArray(data.interactions) ? data.interactions.length : 0;
  const description =
    data.kind === "clip" && typeof data.description === "string" && data.description.trim()
      ? 168
      : 0;
  return [320, 268 + (interactions ? 52 + interactions * 44 : 0) + description];
}
export function canvasBounds(items: readonly CanvasBounds[], padding = 0): CanvasBounds {
  if (!items.length) return { x: 0, y: 0, width: 640, height: 480 };
  const x = Math.min(...items.map((item) => item.x)) - padding;
  const y = Math.min(...items.map((item) => item.y)) - padding;
  const width = Math.max(...items.map((item) => item.x + item.width)) - x + padding;
  const height = Math.max(...items.map((item) => item.y + item.height)) - y + padding;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw Error("Canvas bounds are invalid.");
  return { x, y, width, height };
}
export function canvasLayout(snapshot: CanvasSnapshot) {
  const overview = canvasOverview(snapshot);
  const nodes = overview.nodes.map((node) => {
    const raw = z
      .object({
        id: z.literal(node.id),
        position: z.unknown().optional(),
        data: z.record(z.unknown()).default({}),
      })
      .parse(snapshot.nodes[node.id]);
    const position =
      raw.position && typeof raw.position === "object"
        ? (raw.position as { x?: unknown; y?: unknown })
        : {};
    const [width, height] = size(node.type, raw.data);
    return { ...node, x: finite(position.x), y: finite(position.y), width, height };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = canvasGroups(snapshot.groups, byId.keys()).map((group) => ({
    ...group,
    ...canvasBounds(
      group.nodeIds.map((id) => byId.get(id)!),
      36
    ),
  }));
  const edges = Object.entries(snapshot.edges).flatMap(([id, raw]) => {
    const edge = z.object({ id: z.literal(id), source: z.string(), target: z.string() }).parse(raw);
    const source = byId.get(edge.source),
      target = byId.get(edge.target);
    if (!source || !target) return [];
    const start = { x: source.x + source.width, y: source.y + source.height / 2 };
    const end = { x: target.x, y: target.y + target.height / 2 };
    const bend = Math.max(48, Math.abs(end.x - start.x) / 2);
    if (
      ![start.x, start.y, end.x, end.y, bend, start.x + bend, end.x - bend].every(Number.isFinite)
    )
      throw Error("Canvas connection geometry is invalid.");
    return [
      {
        ...edge,
        path: `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
      },
    ];
  });
  return { nodes, groups, edges, bounds: canvasBounds([...nodes, ...groups], 24) };
}
export function fitCanvasCamera(
  bounds: CanvasBounds,
  viewport: { width: number; height: number }
): CanvasCamera {
  const width = Math.max(1, viewport.width - 32),
    height = Math.max(1, viewport.height - 32);
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
    scale: Math.min(1, width / bounds.width, height / bounds.height),
  };
}
export function zoomCanvasCamera(camera: CanvasCamera, factor: number): CanvasCamera {
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  return { ...camera, scale: Math.max(0.000001, Math.min(4, camera.scale * factor)) };
}
export function panCanvasCamera(camera: CanvasCamera, dx: number, dy: number): CanvasCamera {
  if (![dx, dy].every(Number.isFinite)) return camera;
  const x = camera.x - dx / camera.scale,
    y = camera.y - dy / camera.scale;
  return Number.isFinite(x) && Number.isFinite(y) ? { ...camera, x, y } : camera;
}

/** Move all members by the anchor delta so spacing stays identical to Web. */
export function canvasDragPositions(
  snapshot: CanvasSnapshot,
  anchor: { nodeId: string; x: number; y: number },
  groupId?: string
) {
  const layout = canvasLayout(snapshot);
  const origin = layout.nodes.find((node) => node.id === anchor.nodeId);
  if (!origin) throw Error("The dragged canvas node is unavailable.");
  const group = groupId ? layout.groups.find((group) => group.id === groupId) : undefined;
  if (groupId && (!group || !group.nodeIds.includes(anchor.nodeId)))
    throw Error("Canvas group membership changed.");
  const ids = group?.nodeIds ?? [anchor.nodeId];
  return canvasPositionEditSchema.parse({
    action: "moveNodes",
    ...(groupId ? { groupId } : {}),
    positions: ids.map((nodeId) => {
      const node = layout.nodes.find((node) => node.id === nodeId)!;
      return { nodeId, x: node.x + anchor.x - origin.x, y: node.y + anchor.y - origin.y };
    }),
  });
}
