import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasEdge, StoryCanvasNode } from "./story-project-canvas-model";
import {
  convertExitToAuto,
  deleteGraphNode,
  disconnectConditionalContinuation,
  disconnectStoryBranch,
  materializeStoryDecisionNodes,
  disconnectSceneContinuation,
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
  // Every canonical graph node is structural story content and
  // is deleted through the same reference-cleaning domain mutation.
  const deletedCanvasNodeIds = new Set(selectedNodes.map((node) => node.id));
  const standaloneEdges = edges.filter(
    (edge) => !deletedCanvasNodeIds.has(edge.source) && !deletedCanvasNodeIds.has(edge.target)
  );

  let next = deleteStandaloneEdges(content, standaloneEdges);
  for (const node of selectedNodes) {
    if (
      node.data.kind === "decision" &&
      node.data.sourceNodeId &&
      !next.graph.nodes.some((candidate) => candidate.nodeId === node.id)
    ) {
      next = convertExitToAuto(next, node.data.sourceNodeId);
    } else {
      next = deleteGraphNode(next, node.data.nodeId);
    }
  }
  return next;
}

function deleteStandaloneEdges(
  content: InteractiveStoryDraftContent,
  edges: readonly StoryCanvasEdge[]
): InteractiveStoryDraftContent {
  const orderedEdges = [...edges].sort((left, right) => left.id.localeCompare(right.id));

  return orderedEdges.reduce((next, edge) => {
    if (edge.data.kind === "decision") {
      const detached = materializeStoryDecisionNodes(next);
      return disconnectSceneContinuation(detached, edge.data.sourceNodeId);
    }
    if (edge.data.kind === "continuation") {
      if (edge.data.conditional) {
        return disconnectConditionalContinuation(next, edge.source, edge.target);
      }
      return disconnectStoryBranch(next, {
        kind: "continuation",
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
      });
    }
    if (edge.data.kind === "choice") {
      return disconnectStoryBranch(next, {
        kind: "choice",
        sourceNodeId: edge.data.sourceNodeId,
        choiceId: edge.data.choiceId,
      });
    }
    if (edge.data.kind === "interaction") {
      return disconnectStoryBranch(next, {
        kind: "interaction",
        sourceNodeId: edge.data.sourceNodeId,
        interactionId: edge.data.interactionId,
        outcome: edge.data.outcome,
      });
    }
    return next;
  }, content);
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}
