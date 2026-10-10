import { z } from "zod";
import type { CanvasSnapshot } from "../../../../canvas-editor/protocol";
import { canvasTidyRequestSchema } from "../../../../canvas-editor/tidy/schema";
import { canvasLayout } from "./story-canvas-layout";
/** Match Studio's semantic card geometry and selection-scoped target rule. */
export function canvasTidyRequest(snapshot: CanvasSnapshot, selection: readonly string[] = []) {
  const layout = canvasLayout(snapshot);
  const ids = new Set(selection);
  if (ids.size !== selection.length || selection.some((id) => !snapshot.nodes[id]))
    throw Error("Canvas selection changed. Reopen the map.");
  const nodes =
    selection.length > 1 ? layout.nodes.filter((node) => ids.has(node.id)) : layout.nodes;
  const targets = new Set(nodes.map((node) => node.id));
  return canvasTidyRequestSchema.parse({
    nodes: nodes.map((node) => {
      const raw = z
        .object({ width: z.number().optional(), height: z.number().optional() })
        .parse(snapshot.nodes[node.id]);
      const positive = (value?: number) =>
        value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
      return {
        id: node.id,
        width: positive(raw.width) ?? node.width,
        height: positive(raw.height) ?? node.height,
        position: { x: node.x, y: node.y },
      };
    }),
    edges: layout.edges
      .filter((edge) => targets.has(edge.source) && targets.has(edge.target))
      .map((edge, index) => ({
        id: `${index}:${edge.id}`,
        source: edge.source,
        target: edge.target,
      })),
    direction: "RIGHT",
    nodeSpacing: 72,
    layerSpacing: 120,
    componentSpacing: 180,
    componentAspectRatio: 16 / 9,
    lanes: [],
  });
}
/** Geometry and wiring affect layout; prompt text and media receipts do not. */
export function canvasTidyBaseline(snapshot: CanvasSnapshot, selection: readonly string[] = []) {
  return JSON.stringify(canvasTidyRequest(snapshot, selection));
}
