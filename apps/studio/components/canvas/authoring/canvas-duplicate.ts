/**
 * Canvas subgraph duplication — the one implementation behind every
 * "create a copy" affordance (node toolbar button, ⌘C/⌘V, ⌘D).
 *
 * A duplicate is not just new nodes: the canvas keeps wires DOUBLE-BOOKED (an
 * edge row in the doc + a bound reference on the target card, see
 * canvas-wiring.ts), so cloning must remap both or the copy shows a card whose
 * reference stack silently emptied. Edge policy on clone:
 *
 * - internal wires (both ends selected) → cloned, both endpoints remapped;
 * - incoming external wires → cloned with the ORIGINAL source — a copy keeps
 *   its inputs, re-attached to the same source nodes;
 * - outgoing external wires → dropped. Re-creating them would inject
 *   references into cards the user did not select.
 *
 * Pure module — no React, no Yjs. Everything is id remapping over plain
 * shapes, so it unit-tests without a canvas.
 */
import type { CanvasEdgeShape, CanvasNodeShape } from "@/lib/canvas-core/types";
import {
  SHOT_NODE_TYPE,
  shotNodeData,
  shotOrderBetween,
  sortedShots,
  type ShotNodeData,
  type ShotNodeLike,
} from "@/lib/canvas-authoring/shot-node";
import type { GenerationNodeData } from "./generation-card";
import type { CardReference, CardReferences } from "./reference-stack";

const PASTE_OFFSET = 32;

export type CanvasClipboard = {
  nodes: CanvasNodeShape[];
  edges: CanvasEdgeShape[];
};

/** Minimal node view the copy math needs — RF nodes and doc shapes satisfy it. */
export type CopyableNode = {
  id: string;
  type?: string | null;
  position: { x: number; y: number };
  data?: unknown;
};

function toNodeShape(node: CopyableNode): CanvasNodeShape {
  return {
    id: node.id,
    type: node.type ?? "note",
    position: node.position,
    data: (node.data ?? {}) as Record<string, unknown>,
  };
}

/**
 * Snapshot the subgraph to copy: the given nodes plus every wire that keeps
 * meaning for them — internal wires and wires feeding them from outside.
 */
export function collectCanvasSelection(
  nodes: readonly CopyableNode[],
  edges: readonly CanvasEdgeShape[]
): CanvasClipboard | null {
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes: nodes.map(toNodeShape),
    // `target ∈ selection` covers internal + incoming external in one test;
    // outgoing wires (target outside) fall through and are dropped.
    edges: edges
      .filter((edge) => ids.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
  };
}

function remapReferences(
  data: Record<string, unknown>,
  nodeIds: ReadonlyMap<string, string>,
  edgeIds: ReadonlyMap<string, string>
): Record<string, unknown> {
  const references = (data as GenerationNodeData).references;
  if (!references) return data;
  const next: CardReferences = {};
  for (const [field, list] of Object.entries(references)) {
    const remapped = list
      // Still-streaming uploads are session-local to the original card (their
      // completion targets that node); a cloned spinner could never resolve.
      .filter((reference) => !reference.uploading)
      // A reference whose wire wasn't cloned (outgoing policy, or its source
      // vanished between copy and paste) must not dangle on the copy.
      .filter((reference) => !reference.edgeId || edgeIds.has(reference.edgeId))
      .map((reference) => {
        const edgeId = reference.edgeId ? edgeIds.get(reference.edgeId) : undefined;
        return {
          ...reference,
          id: edgeId ?? crypto.randomUUID(),
          edgeId,
          // External sources are not in nodeIds — they intentionally keep the
          // original id so the cloned wire re-attaches to the same source.
          sourceNodeId: reference.sourceNodeId
            ? (nodeIds.get(reference.sourceNodeId) ?? reference.sourceNodeId)
            : undefined,
        } satisfies CardReference;
      });
    if (remapped.length > 0) next[field] = remapped;
  }
  return { ...data, references: next };
}

/**
 * Clone a collected subgraph against the CURRENT document. `existingNodes`
 * supplies two guards: incoming external wires only re-attach when their
 * source still exists, and cloned shots append after today's last shot.
 */
export function cloneCanvasSelection(
  source: CanvasClipboard | null,
  existingNodes: readonly ShotNodeLike[]
): CanvasClipboard {
  if (!source || source.nodes.length === 0) return { nodes: [], edges: [] };
  const nodeIds = new Map(source.nodes.map((node) => [node.id, crypto.randomUUID()] as const));
  const existingIds = new Set(existingNodes.map((node) => node.id));
  const edges = source.edges.filter(
    (edge) => nodeIds.has(edge.source) || existingIds.has(edge.source)
  );
  const edgeIds = new Map(edges.map((edge) => [edge.id, crypto.randomUUID()] as const));
  // Shot order keys are unique positions in the storyboard, not content — a
  // cloned shot appends to the end of the board rather than cloning its
  // original's slot (two rows claiming one position is a broken storyboard).
  let lastShotOrder = shotNodeData(sortedShots(existingNodes).at(-1)).order ?? null;
  return {
    nodes: source.nodes.map((node) => {
      let data = remapReferences(node.data, nodeIds, edgeIds);
      if (node.type === SHOT_NODE_TYPE) {
        lastShotOrder = shotOrderBetween(lastShotOrder, null);
        data = { ...data, order: lastShotOrder };
        // The 定稿 marker points at a frame wire — retarget it at that wire's
        // clone, or clear it when the wire didn't survive the copy.
        const shotData = data as ShotNodeData;
        if (shotData.preferredFrameEdgeId != null) {
          const preferred = edgeIds.get(shotData.preferredFrameEdgeId);
          const rest = { ...shotData };
          delete rest.preferredFrameEdgeId;
          data = preferred ? { ...rest, preferredFrameEdgeId: preferred } : rest;
        }
      }
      return {
        ...node,
        id: nodeIds.get(node.id) ?? crypto.randomUUID(),
        position: {
          x: node.position.x + PASTE_OFFSET,
          y: node.position.y + PASTE_OFFSET,
        },
        data,
      };
    }),
    edges: edges.map((edge) => ({
      id: edgeIds.get(edge.id) ?? crypto.randomUUID(),
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })),
  };
}

/**
 * Clone `source` into the live document in one batched write (single undo
 * step) and select the fresh copies. A null/empty source is a no-op.
 */
export function placeCanvasClone(
  source: CanvasClipboard | null,
  ctx: {
    getNodes: () => readonly ShotNodeLike[];
    addNodesAndEdges: (nodes: CanvasNodeShape[], edges: CanvasEdgeShape[]) => void;
    selectNodes: (ids: string[]) => void;
  }
): void {
  if (!source || source.nodes.length === 0) return;
  const clone = cloneCanvasSelection(source, ctx.getNodes());
  if (clone.nodes.length === 0) return;
  ctx.addNodesAndEdges(clone.nodes, clone.edges);
  ctx.selectNodes(clone.nodes.map((node) => node.id));
}
