import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";
import type { StoryCanvasEdge, StoryCanvasNode } from "./story-project-canvas-model";
import {
  convertExitToAuto,
  deleteEndingNode,
  deleteGraphNode,
  disconnectStoryBranch,
  setEntryNode,
} from "./story-project-canvas-mutations";
import { deleteStoryCharacter } from "./story-world-mutations";

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
  const deletableNodes = selectedNodes.filter((node) => node.data.kind !== "root");
  // The Story World root is a layout-only projection. Its incident edge must
  // be consumed by the node deletion request instead of being interpreted as
  // a standalone request to clear the executable graph entry.
  const deletedCanvasNodeIds = new Set(selectedNodes.map((node) => node.id));
  const deletedGraphNodeIds = new Set(
    deletableNodes.flatMap((node) =>
      node.data.kind === "clip" || node.data.kind === "text" ? [node.data.nodeId] : []
    )
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
    if (node.data.kind === "ending" && node.data.endingId) {
      next = deleteEndingNode(next, node.data.endingId);
      continue;
    }
    if (node.data.kind === "character") {
      // A pure branching tree never references a character, so the same
      // mutation the inspector uses always succeeds here.
      if (node.data.characterId) next = deleteStoryCharacter(next, node.data.characterId);
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
    if (edge.data.kind === "root") return setEntryNode(next, null);
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
    if (edge.data.kind === "checkpoint") {
      return disconnectStoryBranch(next, {
        kind: "checkpoint",
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
      });
    }
    if (edge.data.kind === "ending") {
      return disconnectStoryBranch(next, {
        kind: "ending",
        sourceNodeId: edge.source,
        endingId: edge.data.endingId,
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
