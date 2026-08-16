import { nextStoryCanvasFocusedNodeId } from "./story-project-canvas-selection";

export type StoryCanvasInspectorTarget =
  | { kind: "closed" }
  | { kind: "foundation" }
  | { kind: "node"; nodeId: string };

export const CLOSED_STORY_CANVAS_INSPECTOR: StoryCanvasInspectorTarget = { kind: "closed" };
export const STORY_FOUNDATION_INSPECTOR: StoryCanvasInspectorTarget = { kind: "foundation" };

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
  return current.kind === "foundation" ? current : CLOSED_STORY_CANVAS_INSPECTOR;
}
