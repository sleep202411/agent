import { isSyntheticDecisionNodeId, STORY_ROOT_NODE_ID } from "./story-project-canvas-model";
import { nextStoryCanvasFocusedNodeId } from "./story-project-canvas-selection";

export type StoryCanvasInspectorTarget =
  | { kind: "closed" }
  | { kind: "world" }
  | { kind: "node"; nodeId: string };

export const CLOSED_STORY_CANVAS_INSPECTOR: StoryCanvasInspectorTarget = { kind: "closed" };
export const STORY_WORLD_INSPECTOR: StoryCanvasInspectorTarget = { kind: "world" };

export function storyNodeInspectorTarget(nodeId: string): StoryCanvasInspectorTarget {
  // The mandatory Story World root has no per-node inspector: selecting it opens
  // the Story Bible panel (world inspector) instead of a node editor.
  if (nodeId === STORY_ROOT_NODE_ID) return STORY_WORLD_INSPECTOR;
  // Player choices are edited directly on their canvas card. Treating their
  // synthetic projection as an inspector target would duplicate the same form
  // in a drawer and make a simple click unexpectedly cover the canvas.
  if (isSyntheticDecisionNodeId(nodeId)) return CLOSED_STORY_CANVAS_INSPECTOR;
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
  return current.kind === "world" ? current : CLOSED_STORY_CANVAS_INSPECTOR;
}
