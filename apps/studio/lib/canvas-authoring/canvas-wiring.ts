/**
 * Canvas node-wiring helpers — the programmatic equivalent of dragging a wire.
 *
 * The copilot's `connect_nodes` tool uses these to wire nodes EXACTLY like the
 * human drag path (canvas-view.tsx `onConnect` → `bindEdgeReference`): derive
 * the source output kind, route it to a target reference field (reusing the
 * shared current-mode routing brain), add the edge with the real handle ids,
 * and bind the source as a reference on the target. Validation is performed
 * before either mutation so a rejected connection cannot leave an orphan edge.
 */
import type { Edge } from "@xyflow/react";
import {
  evaluateReferenceField,
  type ReferenceRoutingIssue,
} from "@/lib/canvas-authoring/reference-routing";
import {
  SHOT_REFERENCE_FIELDS,
  SHOT_NODE_TYPE,
  type ShotNodeData,
} from "@/lib/canvas-authoring/shot-node";
import type { FizzAiModel, FizzAiReferenceKind } from "@/lib/canvas-authoring/generation-api";
import type { CardReference, CardReferences } from "@/components/canvas/authoring/reference-stack";
import type { GenerationNodeData } from "@/components/canvas/authoring/generation-card";
import type { CanvasGraph } from "@/lib/collab/use-canvas-graph";
import {
  generationModalityForNodeType,
  isGenerationNodeType,
} from "@/lib/canvas-authoring/generation-node-types";

// Structural node read — satisfied by both the RF store's `getNode` (drag path)
// and the Yjs-doc `graph.getNode` (copilot). Only `.type` and `.data` are read.
type GetNode = (id: string) => { type?: string | null; data?: unknown } | null | undefined;

export interface WiringCtx {
  getNode: GetNode;
  /** Immediate document read, used to reserve slots for not-yet-generated wires. */
  getEdges?: () => readonly Pick<Edge, "id" | "source" | "target">[];
  catalog: { models: FizzAiModel[] } | undefined;
  graph: Pick<CanvasGraph, "addEdge" | "patchNodeData" | "removeEdge">;
}

export type CanvasConnectionIssue =
  | ReferenceRoutingIssue
  | { code: "source_missing" }
  | { code: "target_missing" }
  | { code: "self_connection" }
  | { code: "source_not_connectable" }
  | { code: "target_not_connectable" }
  | { code: "duplicate_reference"; kind: FizzAiReferenceKind };

export type CanvasConnectionValidation =
  | { ok: true; kind: FizzAiReferenceKind; field: string }
  | { ok: false; issue: CanvasConnectionIssue };

const KIND_LABEL: Record<FizzAiReferenceKind, string> = {
  image: "image",
  video: "video",
  audio: "audio",
};

/** Stable English fallback for agents and non-React callers. UI callers map
 * the same issue codes through i18n. */
export function canvasConnectionIssueMessage(issue: CanvasConnectionIssue): string {
  switch (issue.code) {
    case "source_missing":
      return "The source node no longer exists.";
    case "target_missing":
      return "The target node no longer exists.";
    case "self_connection":
      return "A node can't be connected to itself.";
    case "source_not_connectable":
      return "This node has no image, video, or audio output to connect.";
    case "target_not_connectable":
      return "This node does not accept reference connections.";
    case "model_unavailable":
      return "Choose an available model before connecting a reference.";
    case "current_mode_unsupported":
      return `The current mode does not accept ${KIND_LABEL[issue.kind]} references. Switch modes manually first.`;
    case "unsupported_kind":
      return `This model does not accept ${KIND_LABEL[issue.kind]} references.`;
    case "reference_limit":
      return `The current mode accepts at most ${issue.limit} ${KIND_LABEL[issue.kind]} reference${issue.limit === 1 ? "" : "s"}.`;
    case "duplicate_reference":
      return `This ${KIND_LABEL[issue.kind]} is already connected to the node.`;
  }
}

/** Node type → the kind exposed on its 'output' handle (notes have none). */
export function sourceOutputKind(
  getNode: GetNode,
  nodeId: string
): FizzAiReferenceKind | undefined {
  const node = getNode(nodeId);
  if (!node) return undefined;
  if (node.type === "image" || node.type === "panorama") return "image";
  const generationModality = generationModalityForNodeType(node.type);
  if (generationModality) return generationModality;
  if (node.type === "videoAsset") return "video";
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
  if (isGenerationNodeType(node.type)) {
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
  if (isGenerationNodeType(node.type)) {
    return (node.data as GenerationNodeData).generation?.outputs?.[0]?.assetId;
  }
  if (node.type === "videoAsset" || node.type === "audioAsset") {
    return (node.data as { mediaAssetId?: string }).mediaAssetId;
  }
  return undefined;
}

/** AI generation job that produced a source node's current output. */
export function sourceGenerationJobId(getNode: GetNode, nodeId: string): string | undefined {
  const node = getNode(nodeId);
  if (!isGenerationNodeType(node?.type)) return undefined;
  const jobId = (node.data as GenerationNodeData).generation?.jobId;
  return typeof jobId === "string" && jobId.trim() ? jobId : undefined;
}

export function sourceMediaMetadata(
  getNode: GetNode,
  nodeId: string
): Pick<CardReference, "bytes" | "durationSeconds" | "height" | "name" | "width"> {
  const node = getNode(nodeId);
  if (!node) return {};
  const source = isGenerationNodeType(node.type)
    ? (node.data as GenerationNodeData).generation?.outputs?.[0]
    : (node.data as {
        bytes?: number | null;
        durationSeconds?: number | null;
        height?: number | null;
        width?: number | null;
      });
  if (!source) return {};
  const sourceName = isGenerationNodeType(node.type)
    ? (node.data as GenerationNodeData).prompt
    : ((node.data as { label?: string; name?: string }).label ??
      (node.data as { label?: string; name?: string }).name);
  const positiveFinite = (value: number | null | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  return {
    ...(sourceName?.trim() ? { name: sourceName.trim() } : {}),
    ...(positiveFinite(source.durationSeconds) ? { durationSeconds: source.durationSeconds } : {}),
    ...(positiveFinite(source.bytes) ? { bytes: source.bytes } : {}),
    ...(positiveFinite(source.width) ? { width: source.width } : {}),
    ...(positiveFinite(source.height) ? { height: source.height } : {}),
  };
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
export function evaluateTargetReferenceField(
  target: { type?: string | null; data?: unknown } | null | undefined,
  catalog: { models: FizzAiModel[] } | undefined,
  kind: FizzAiReferenceKind,
  excludeEdgeId?: string,
  reservedCount = 0
): { ok: true; field: string } | { ok: false; issue: CanvasConnectionIssue } {
  if (!target) return { ok: false, issue: { code: "target_missing" } };
  if (target.type === SHOT_NODE_TYPE) {
    const data = target.data as ShotNodeData;
    const constraint = SHOT_REFERENCE_FIELDS.find((candidate) => candidate.kind === kind);
    if (!constraint) return { ok: false, issue: { code: "unsupported_kind", kind } };
    const boundCount = (data.references?.[constraint.field] ?? []).filter(
      (reference) => !excludeEdgeId || reference.edgeId !== excludeEdgeId
    ).length;
    return boundCount + reservedCount < constraint.maxItems
      ? { ok: true, field: constraint.field }
      : {
          ok: false,
          issue: { code: "reference_limit", kind, limit: constraint.maxItems },
        };
  }
  if (!isGenerationNodeType(target.type)) {
    return { ok: false, issue: { code: "target_not_connectable" } };
  }
  const data = target.data as GenerationNodeData;
  const model = catalog?.models.find((m) => m.id === data.modelId);
  const references = excludeEdgeId
    ? withoutEdgeReference(data.references, excludeEdgeId)
    : data.references;
  return evaluateReferenceField(model, data.mode, references, kind, reservedCount);
}

export function routeTargetReferenceField(
  target: { type?: string | null; data?: unknown } | null | undefined,
  catalog: { models: FizzAiModel[] } | undefined,
  kind: FizzAiReferenceKind,
  excludeEdgeId?: string,
  reservedCount = 0
): { field: string } | undefined {
  const result = evaluateTargetReferenceField(target, catalog, kind, excludeEdgeId, reservedCount);
  return result.ok ? { field: result.field } : undefined;
}

function targetReferences(target: ReturnType<GetNode>): CardReferences {
  return ((target?.data as { references?: CardReferences } | undefined)?.references ??
    {}) as CardReferences;
}

function boundEdgeIds(references: CardReferences): Set<string> {
  return new Set(
    Object.values(references)
      .flat()
      .flatMap((reference) => (reference.edgeId ? [reference.edgeId] : []))
  );
}

/** Validate source → target without mutating the graph. */
export function validateCanvasConnection(
  ctx: Pick<WiringCtx, "getNode" | "getEdges" | "catalog">,
  source: string,
  target: string,
  excludeEdgeId?: string
): CanvasConnectionValidation {
  if (source === target) return { ok: false, issue: { code: "self_connection" } };
  const sourceNode = ctx.getNode(source);
  if (!sourceNode) return { ok: false, issue: { code: "source_missing" } };
  const targetNode = ctx.getNode(target);
  if (!targetNode) return { ok: false, issue: { code: "target_missing" } };

  const kind = sourceOutputKind(ctx.getNode, source);
  if (!kind) return { ok: false, issue: { code: "source_not_connectable" } };

  const references = targetReferences(targetNode);
  const duplicateReference = Object.values(references)
    .flat()
    .some(
      (reference) =>
        reference.sourceNodeId === source && (!excludeEdgeId || reference.edgeId !== excludeEdgeId)
    );
  const existingEdges = ctx.getEdges?.() ?? [];
  const duplicateEdge = existingEdges.some(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      (!excludeEdgeId || edge.id !== excludeEdgeId)
  );
  if (duplicateReference || duplicateEdge) {
    return { ok: false, issue: { code: "duplicate_reference", kind } };
  }

  const boundIds = boundEdgeIds(references);
  const reservedCount = existingEdges.filter(
    (edge) =>
      edge.target === target &&
      edge.id !== excludeEdgeId &&
      !boundIds.has(edge.id) &&
      sourceOutputKind(ctx.getNode, edge.source) === kind
  ).length;
  const routed = evaluateTargetReferenceField(
    targetNode,
    ctx.catalog,
    kind,
    excludeEdgeId,
    reservedCount
  );
  return routed.ok ? { ok: true, kind, field: routed.field } : { ok: false, issue: routed.issue };
}

/** Bind source → target as a reference. The single source of truth for this
 *  logic — canvas-view's drag `onConnect` delegates here too. */
export function bindEdgeReference(
  ctx: WiringCtx,
  edgeId: string,
  source: string,
  target: string
): { status: "bound" | "pending" } | { status: "rejected"; issue: CanvasConnectionIssue } {
  const validation = validateCanvasConnection(ctx, source, target, edgeId);
  if (!validation.ok) return { status: "rejected", issue: validation.issue };
  const kind = validation.kind;
  const url = sourceMediaUrl(ctx.getNode, source);
  const assetId = sourceMediaAssetId(ctx.getNode, source);
  const sourceJobId = sourceGenerationJobId(ctx.getNode, source);
  const metadata = sourceMediaMetadata(ctx.getNode, source);
  // Never bind a session-local blob: URL into the shared doc; the reconciler
  // re-binds the durable URL once the source's generation/upload resolves.
  if (!url || url.startsWith("blob:")) return { status: "pending" };
  const reference: CardReference = {
    id: edgeId,
    edgeId,
    sourceNodeId: source,
    url,
    kind,
    ...(assetId ? { assetId } : {}),
    ...(sourceJobId ? { sourceJobId } : {}),
    ...metadata,
  };
  ctx.graph.patchNodeData(target, (node) => {
    const refs = (node.data as { references?: CardReferences }).references ?? {};
    const list = (refs[validation.field] ?? []).filter((r) => r.edgeId !== edgeId);
    return {
      references: { ...refs, [validation.field]: [...list, reference] },
    };
  });
  return { status: "bound" };
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
  if (!sourceId) throw new Error("A source node is required.");
  if (!targetId) throw new Error("A target node is required.");
  const validation = validateCanvasConnection(ctx, sourceId, targetId);
  if (!validation.ok) throw new Error(canvasConnectionIssueMessage(validation.issue));

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
  const binding = bindEdgeReference(ctx, edgeId, sourceId, targetId);
  if (binding.status === "rejected") {
    // Collaborative state changed between validation and binding. Roll back the
    // just-created edge so a rejected connection is still an atomic no-op.
    ctx.graph.removeEdge(edgeId);
    throw new Error(canvasConnectionIssueMessage(binding.issue));
  }
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
