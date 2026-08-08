/**
 * Canvas node-wiring helpers — the programmatic equivalent of dragging a wire.
 *
 * The copilot's `connect_nodes` tool uses these to wire nodes EXACTLY like the
 * human drag path (canvas-view.tsx `onConnect` → `bindEdgeReference`): derive
 * the source output kind, route it to a target reference field (reusing the
 * shared `routeReferenceField` brain), add the edge with the real handle ids,
 * and bind the source as a reference on the target (with mode switch).
 *
 * NOTE: the drag path in canvas-view.tsx still has its own inline copy of the
 * kind/url derivation + bindEdgeReference. This module mirrors it; a follow-up
 * should make canvas-view delegate here so there's a single source of truth.
 * The routing rule itself (`routeReferenceField`) is already shared, so the
 * only duplicated logic is the small, stable node-type → kind/url maps.
 */
import type { Edge } from "@xyflow/react";
import { routeReferenceField } from "@/lib/canvas-authoring/reference-routing";
import {
  SHOT_NODE_TYPE,
  routeShotReferenceField,
  type ShotNodeData,
} from "@/lib/canvas-authoring/shot-node";
import type { FizzAiModel, FizzAiReferenceKind } from "@/lib/canvas-authoring/generation-api";
import type { CardReference, CardReferences } from "@/components/canvas/authoring/reference-stack";
import type { GenerationNodeData } from "@/components/canvas/authoring/generation-card";
import type { CanvasGraph } from "@/lib/collab/use-canvas-graph";

// Structural node read — satisfied by both the RF store's `getNode` (drag path)
// and the Yjs-doc `graph.getNode` (copilot). Only `.type` and `.data` are read.
type GetNode = (id: string) => { type?: string | null; data?: unknown } | null | undefined;

export interface WiringCtx {
  getNode: GetNode;
  catalog: { models: FizzAiModel[] } | undefined;
  graph: Pick<CanvasGraph, "addEdge" | "patchNodeData">;
}

/** Node type → the kind exposed on its 'output' handle (notes have none). */
export function sourceOutputKind(
  getNode: GetNode,
  nodeId: string
): FizzAiReferenceKind | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;
  if (node.type === "image" || node.type === "panorama" || node.type === "prompt") return "image";
  if (node.type === "video" || node.type === "videoAsset") return "video";
  if (node.type === "audioAsset") return "audio";
  return undefined;
}

/** Durable media URL a source node exposes (undefined until generated/uploaded). */
export function sourceMediaUrl(getNode: GetNode, nodeId: string): string | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;
  if (node.type === "image" || node.type === "panorama") {
    return (node.data as { src?: string }).src;
  }
  if (node.type === "prompt" || node.type === "video") {
    return (node.data as GenerationNodeData).generation?.outputs?.[0]?.url;
  }
  if (node.type === "videoAsset" || node.type === "audioAsset") {
    return (node.data as { src?: string }).src;
  }
  return undefined;
}

/** Persistent MediaAsset id a source node exposes, when it has one. */
export function sourceMediaAssetId(getNode: GetNode, nodeId: string): string | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;
  if (node.type === "image" || node.type === "panorama") {
    return (node.data as { mediaAssetId?: string }).mediaAssetId;
  }
  if (node.type === "prompt" || node.type === "video") {
    return (node.data as GenerationNodeData).generation?.outputs?.[0]?.assetId;
  }
  if (node.type === "videoAsset" || node.type === "audioAsset") {
    return (node.data as { mediaAssetId?: string }).mediaAssetId;
  }
  return undefined;
}

function withoutEdgeReference(
  references: CardReferences | undefined,
  edgeId: string
): CardReferences | undefined {
  if (!references) return references;
  const next: CardReferences = {};
  for (const [field, list] of Object.entries(references)) {
    next[field] = (list ?? []).filter((reference) => reference.edgeId !== edgeId);
  }
  return next;
}

/**
 * Which reference field an incoming `kind` binds to on a target — the single
 * routing brain for every node type that takes pictures: a generation card
 * (fields declared by its model + mode) or a shot (fixed frame / clip slots).
 * Anything else (a note, an image) takes nothing.
 *
 * `excludeEdgeId` is the wire being (re)bound: its own current reference must
 * not count against a full slot, or a source that regenerates would be turned
 * away from the slot it already owns.
 */
export function routeTargetReferenceField(
  target: { type?: string | null; data?: unknown } | null | undefined,
  catalog: { models: FizzAiModel[] } | undefined,
  kind: string,
  excludeEdgeId?: string
): { mode?: string; field: string } | undefined {
  if (!target) return undefined;
  if (target.type === SHOT_NODE_TYPE) {
    const data = target.data as ShotNodeData;
    return routeShotReferenceField(data.references, kind, excludeEdgeId);
  }
  if (target.type !== "prompt" && target.type !== "video") return undefined;
  const data = target.data as GenerationNodeData;
  const model = catalog?.models.find((m) => m.id === data.modelId);
  const references = excludeEdgeId
    ? withoutEdgeReference(data.references, excludeEdgeId)
    : data.references;
  return routeReferenceField(model, data.mode, references, kind);
}

/** Route a source kind to a reference field on a wiring context's target. */
function routeForCard(ctx: WiringCtx, cardId: string, kind: string, excludeEdgeId?: string) {
  return routeTargetReferenceField(ctx.getNode(cardId), ctx.catalog, kind, excludeEdgeId);
}

/** Bind source → target as a reference. The single source of truth for this
 *  logic — canvas-view's drag `onConnect` delegates here too. */
export function bindEdgeReference(
  ctx: WiringCtx,
  edgeId: string,
  source: string,
  target: string
): void {
  const kind = sourceOutputKind(ctx.getNode, source);
  const url = sourceMediaUrl(ctx.getNode, source);
  const assetId = sourceMediaAssetId(ctx.getNode, source);
  // Re-binding THIS wire: its own current reference doesn't occupy the slot.
  const routed = kind ? routeForCard(ctx, target, kind, edgeId) : undefined;
  // Never bind a session-local blob: URL into the shared doc; the reconciler
  // re-binds the durable URL once the source's generation/upload resolves.
  if (!kind || !url || url.startsWith("blob:") || !routed) return;
  const reference: CardReference = {
    id: edgeId,
    edgeId,
    sourceNodeId: source,
    url,
    kind,
    ...(assetId ? { assetId } : {}),
  };
  ctx.graph.patchNodeData(target, (node) => {
    const refs = (node.data as { references?: CardReferences }).references ?? {};
    const list = (refs[routed.field] ?? []).filter((r) => r.edgeId !== edgeId);
    const patch: Record<string, unknown> = {
      references: { ...refs, [routed.field]: [...list, reference] },
    };
    if (routed.mode) patch.mode = routed.mode;
    return patch;
  });
}

/**
 * Wire sourceNodeId → targetNodeId exactly as the human drag does.
 * Throws with a user-facing reason when the connection isn't valid.
 */
export function connectNodes(
  ctx: WiringCtx,
  sourceId: string,
  targetId: string
): { edgeId: string } {
  if (!sourceId || !targetId) throw new Error("Both a source and a target node are required.");
  if (sourceId === targetId) throw new Error("A node can't be connected to itself.");
  if (!ctx.getNode(sourceId)) throw new Error(`No source node with id ${sourceId}.`);
  if (!ctx.getNode(targetId)) throw new Error(`No target node with id ${targetId}.`);

  const kind = sourceOutputKind(ctx.getNode, sourceId);
  if (!kind) throw new Error("The source node has no connectable output (notes can't be wired).");

  const routed = routeForCard(ctx, targetId, kind);
  if (!routed) {
    throw new Error(
      "The target can't accept this connection — it must be a shot, or a generation card whose model accepts this input, with a free reference slot."
    );
  }

  const edgeId = crypto.randomUUID();
  ctx.graph.addEdge({
    id: edgeId,
    source: sourceId,
    target: targetId,
    sourceHandle: "output",
    targetHandle: "input",
  });
  // Bind now if the source already has a durable URL; otherwise the canvas
  // reconciler back-fills the binding when the URL resolves.
  bindEdgeReference(ctx, edgeId, sourceId, targetId);
  return { edgeId };
}

// ─── Deletion (mirrors canvas-view onEdgesDelete + RF node-delete edge cascade) ───
//
// Bare graph.removeEdge/removeNode only drop the doc row; the human delete path
// ALSO strips the wire's bound CardReference from the target card (else the
// "removed" image keeps feeding generation) and cascade-removes a deleted
// node's edges. The copilot must replicate that. Same unify-later note as above.

export interface DeleteCtx {
  getEdges: () => Edge[];
  graph: Pick<CanvasGraph, "removeEdge" | "removeNode" | "patchNodeData">;
}

/** Strip the reference bound by `edgeId` from a target card. The single source
 *  of truth for this logic — canvas-view's `onEdgesDelete` delegates here too. */
export function stripEdgeRef(
  patchNodeData: CanvasGraph["patchNodeData"],
  targetId: string,
  edgeId: string
): void {
  patchNodeData(targetId, (node) => {
    const refs = (node.data as { references?: CardReferences }).references ?? {};
    const next: Record<string, CardReference[]> = {};
    for (const [field, list] of Object.entries(refs)) {
      next[field] = list.filter((r) => r.edgeId !== edgeId);
    }
    return { references: next };
  });
}

/** Delete a wire AND drop the reference it bound on the target. A known target
 *  keeps orphaned legacy references removable even when their edge is gone. */
export function removeEdgeById(ctx: DeleteCtx, edgeId: string, knownTargetId?: string): void {
  const edge = ctx.getEdges().find((e) => e.id === edgeId);
  ctx.graph.removeEdge(edgeId);
  const targetId = edge?.target ?? knownTargetId;
  if (targetId) stripEdgeRef(ctx.graph.patchNodeData, targetId, edgeId);
}

/** Delete a node, its touching edges, and the references those edges bound. */
export function removeNodeCascade(ctx: DeleteCtx, nodeId: string): void {
  const touching = ctx.getEdges().filter((e) => e.source === nodeId || e.target === nodeId);
  for (const edge of touching) {
    ctx.graph.removeEdge(edge.id);
    if (edge.target && edge.target !== nodeId) {
      stripEdgeRef(ctx.graph.patchNodeData, edge.target, edge.id);
    }
  }
  ctx.graph.removeNode(nodeId);
}
