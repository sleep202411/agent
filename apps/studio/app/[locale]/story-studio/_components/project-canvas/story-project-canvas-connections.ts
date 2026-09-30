import type { Connection, Edge } from "@xyflow/react";
import type { StoryCanvasNode, StoryCanvasNodeData } from "./story-project-canvas-model";

/** Each output can have only one connection. */
export function canConnectStoryCompletion(data: StoryCanvasNodeData): boolean {
  return data.kind !== "decision" && data.exitKind === "auto" && !data.continuationTargetNodeId;
}

export function isValidStoryFlowConnection(
  connection: Connection | Edge,
  nodes: readonly StoryCanvasNode[]
): boolean {
  if (connection.targetHandle !== "in") return false;
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;
  if (target.data.kind === "decision" && target.data.sourceNodeId !== target.id) return false;
  if (source.data.kind === "decision" && source.data.sourceNodeId) {
    return (
      target.data.nodeId !== source.data.sourceNodeId &&
      canConnectStoryChoice(source.data, connection.sourceHandle)
    );
  }
  // An input remains available regardless of how many outputs already connect to it.
  return (
    source.id !== target.id &&
    canConnectStoryCompletion(source.data) &&
    connection.sourceHandle === "completion"
  );
}

export function canConnectStoryChoice(
  data: StoryCanvasNodeData,
  handleId: string | null | undefined
): boolean {
  const choiceId = choiceIdFromHandle(handleId);
  return (
    data.kind === "decision" &&
    Boolean(
      data.choices?.some((choice) => choice.choiceId === choiceId && choice.targetNodeId === null)
    )
  );
}

export type StoryExistingTargetAvailability = "open" | "replace" | "blocked";

/** A free input is offered first. An occupied input stays available, but choosing it replaces that link. */
export function storyExistingTargetAvailability(
  sourceId: string,
  targetId: string,
  nodes: readonly StoryCanvasNode[],
  incomingCount: number
): StoryExistingTargetAvailability {
  const linkable = isValidStoryFlowConnection(
    { source: sourceId, target: targetId, sourceHandle: "completion", targetHandle: "in" },
    nodes
  );
  if (!linkable) return "blocked";
  return incomingCount > 0 ? "replace" : "open";
}

export function choiceIdFromHandle(handleId: string | null | undefined): string | null {
  const match = handleId?.match(/^choice:(.+)$/u);
  return match?.[1] ?? null;
}
