import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasEdge, StoryCanvasNode } from "./story-project-canvas-model";
import {
  convertExitToAuto,
  deleteGraphNode,
  disconnectStoryBranch,
} from "./story-project-canvas-mutations";

export function deleteStoryCanvasElements(
  content: InteractiveStoryDraftContent,
  {
    nodes,
    edges,
  }: {
    nodes: readonly StoryCanvasNode[];
    edges: readonly StoryCanvasEdge[];
  }
): InteractiveStoryDraftContent {
  const selectedNodes = uniqueById(nodes);
  const deletableNodes = selectedNodes.filter((node) => node.data.kind !== "character");
  const deletedCanvasNodeIds = new Set(deletableNodes.map((node) => node.id));
  const deletedGraphNodeIds = new Set(
    deletableNodes.flatMap((node) => (node.data.kind === "clip" ? [node.data.nodeId] : []))
  );
  const standaloneEdges = edges.filter(
    (edge) => !deletedCanvasNodeIds.has(edge.source) && !deletedCanvasNodeIds.has(edge.target)
  );

  let next = deleteStandaloneEdges(content, standaloneEdges);
  for (const node of deletableNodes) {
    if (node.data.kind === "decision" && node.data.sourceNodeId) {
      if (!deletedGraphNodeIds.has(node.data.sourceNodeId)) {
        next = convertExitToAuto(next, node.data.sourceNodeId);
      }
      continue;
    }
    next = deleteGraphNode(next, node.data.nodeId);
  }
  return next;
}

function deleteStandaloneEdges(
  content: InteractiveStoryDraftContent,
  edges: readonly StoryCanvasEdge[]
): InteractiveStoryDraftContent {
  const deletedDecisionSources = new Set(
    edges.flatMap((edge) => (edge.data.kind === "decision" ? [edge.data.sourceNodeId] : []))
  );
  const orderedEdges = edges
    .filter(
      (edge) => edge.data.kind !== "choice" || !deletedDecisionSources.has(edge.data.sourceNodeId)
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return orderedEdges.reduce((next, edge) => {
    if (edge.data.kind === "continuation") {
      return disconnectStoryBranch(next, {
        kind: "continuation",
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
      });
    }
    if (edge.data.kind === "decision") {
      return disconnectStoryBranch(next, {
        kind: "decision",
        sourceNodeId: edge.data.sourceNodeId,
      });
    }
    if (edge.data.kind === "choice") {
      return disconnectStoryBranch(next, {
        kind: "choice",
        sourceNodeId: edge.data.sourceNodeId,
        choiceId: edge.data.choiceId,
      });
    }
    // Membership tethers are non-selectable and non-deletable, so they never
    // reach a delete request; ignore them defensively.
    return next;
  }, content);
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
