import type { CanvasGraphStore } from "@/lib/canvas-core/canvas-graph-context";
import type { CanvasNodeShape } from "@/lib/canvas-core/types";
import {
  SHOT_NODE_TYPE,
  SHOT_NODE_WIDTH,
  shotNodeData,
  shotOrderBetween,
  sortedShots,
} from "@/lib/canvas-authoring/shot-node";
import type { AgentOsShotRow } from "@/lib/agent-os/api-client";

const SHOT_STRIP_GAP = 64;

/** Stable canvas node id for an Agent OS shot id (avoids clashing with freeform UUIDs). */
export function agentOsShotNodeId(shotId: string): string {
  return shotId.startsWith("agent-os:shot:") ? shotId : `agent-os:shot:${shotId}`;
}

export interface ApplyAgentOsShotsResult {
  created: number;
  updated: number;
  removed: number;
  nodeIds: string[];
}

/**
 * Materialize Agent OS storyboard shots onto the live canvas CRDT.
 * Storyboard table and canvas mode both render these `shot` nodes — one write,
 * both surfaces update (including collab peers).
 *
 * Idempotent: re-running with the same shot ids patches data in place.
 * When `pruneMissing` is true (default), Agent OS shot nodes not in `shots`
 * are removed — keeps client catch-up aligned with domain after deletes.
 */
export function applyAgentOsShotsToCanvas(input: {
  graph: Pick<
    CanvasGraphStore,
    "canEdit" | "getNode" | "getNodes" | "addNode" | "patchNodeData" | "removeNode"
  >;
  shots: readonly AgentOsShotRow[];
  /** Remove agent-os shot nodes that are not in `shots`. Default true. */
  pruneMissing?: boolean;
}): ApplyAgentOsShotsResult {
  const { graph, shots } = input;
  const pruneMissing = input.pruneMissing !== false;
  if (!graph.canEdit) {
    return { created: 0, updated: 0, removed: 0, nodeIds: [] };
  }

  let removed = 0;
  if (pruneMissing) {
    const keep = new Set(shots.map((s) => agentOsShotNodeId(s.id)));
    for (const node of graph.getNodes()) {
      if (node.type !== SHOT_NODE_TYPE) continue;
      if (!String(node.id).startsWith("agent-os:shot:")) continue;
      if (keep.has(node.id)) continue;
      graph.removeNode(node.id);
      removed += 1;
    }
  }

  if (shots.length === 0) {
    return { created: 0, updated: 0, removed, nodeIds: [] };
  }

  const existingNodes = graph.getNodes();
  const orderedShots = sortedShots(existingNodes);
  let orderCursor: string | undefined =
    orderedShots.length > 0 ? shotNodeData(orderedShots.at(-1)).order : undefined;

  const rightmost = orderedShots.reduce<CanvasNodeShape | null>((best, node) => {
    if (!best || node.position.x > best.position.x) return node;
    return best;
  }, null);

  let nextX = rightmost
    ? rightmost.position.x + SHOT_NODE_WIDTH + SHOT_STRIP_GAP
    : existingNodes.length === 0
      ? 0
      : Math.min(...existingNodes.map((n) => n.position.x));
  let nextY = rightmost
    ? rightmost.position.y
    : existingNodes.length === 0
      ? 0
      : Math.max(...existingNodes.map((n) => n.position.y)) + 240;

  let created = 0;
  let updated = 0;
  const nodeIds: string[] = [];

  for (const shot of shots) {
    const nodeId = agentOsShotNodeId(shot.id);
    nodeIds.push(nodeId);
    const patch = {
      label: shot.title,
      imagePrompt: shot.prompt,
      description: shot.prompt,
      notes: shot.notes ?? "",
      agentOsShotId: shot.id,
    };

    const existing = graph.getNode(nodeId);
    if (existing) {
      // Pure chat turns re-list the same shots — do not rewrite CRDT / toast.
      if (!shotPatchDiffers(existing.data, patch)) continue;
      graph.patchNodeData(nodeId, patch);
      updated += 1;
      continue;
    }

    const order = shotOrderBetween(orderCursor, null);
    orderCursor = order;

    graph.addNode({
      id: nodeId,
      type: SHOT_NODE_TYPE,
      position: { x: nextX, y: nextY },
      data: {
        ...patch,
        order,
      },
    });
    nextX += SHOT_NODE_WIDTH + SHOT_STRIP_GAP;
    created += 1;
  }

  return { created, updated, removed, nodeIds };
}

function shotPatchDiffers(
  data: Record<string, unknown> | undefined,
  patch: {
    label: string;
    imagePrompt: string;
    description: string;
    notes: string;
    agentOsShotId: string;
  }
): boolean {
  const current = data ?? {};
  return (
    current.label !== patch.label ||
    current.imagePrompt !== patch.imagePrompt ||
    current.description !== patch.description ||
    (current.notes ?? "") !== patch.notes ||
    current.agentOsShotId !== patch.agentOsShotId
  );
}
