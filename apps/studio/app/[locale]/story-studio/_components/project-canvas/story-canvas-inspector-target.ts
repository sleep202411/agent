import { nextStoryCanvasFocusedNodeId } from "./story-project-canvas-selection";

export type StoryCanvasInspectorTarget = { kind: "closed" } | { kind: "node"; nodeId: string };

export const CLOSED_STORY_CANVAS_INSPECTOR: StoryCanvasInspectorTarget = { kind: "closed" };

export function storyNodeInspectorTarget(nodeId: string): StoryCanvasInspectorTarget {
  return { kind: "node", nodeId };
}

export function storyCanvasInspectorNodeId(target: StoryCanvasInspectorTarget): string | null {
  return target.kind === "node" ? target.nodeId : null;
}

export function reconcileStoryCanvasInspectorTarget(
  current: StoryCanvasInspectorTarget,
  selectedNodeIds: readonly string[],
  preferredNodeId?: string | null
): StoryCanvasInspectorTarget {
  const nextNodeId = nextStoryCanvasFocusedNodeId(
    storyCanvasInspectorNodeId(current),
    selectedNodeIds,
    preferredNodeId
  );
  if (nextNodeId) return storyNodeInspectorTarget(nextNodeId);
  return CLOSED_STORY_CANVAS_INSPECTOR;
}
