import {
  CLOSED_STORY_CANVAS_INSPECTOR,
  type StoryCanvasInspectorTarget,
} from "./story-canvas-inspector-target";
import { reconcileStoryCanvasSelectedIds } from "./story-project-canvas-selection";

/** Camera of a plot tree. Node positions live in the layout projection. */
export interface StoryCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * View state that has to outlive the React Flow instance. Production steps are
 * separate routes, so the canvas unmounts; this snapshot is what the next
 * mount restores.
 */
export interface StoryCanvasViewState {
  viewport: StoryCanvasViewport;
  selectedNodeIds: string[];
  inspectorTarget: StoryCanvasInspectorTarget;
}

/** Cold camera used until the author has a saved view for this chapter. */
export const STORY_CANVAS_COLD_VIEWPORT: StoryCanvasViewport = {
  x: 80,
  y: 160,
  zoom: 0.48,
};

export function storyCanvasViewKey(projectId: string, chapterId: string): string {
  return `${projectId}:${chapterId}`;
}

/**
 * A saved camera replaces fit-to-graph. Fitting on every mount is what made
 * the tree jump back to the overview after a step change.
 */
export function resolveStoryCanvasCamera(saved: StoryCanvasViewState | null): {
  defaultViewport: StoryCanvasViewport;
  fitView: boolean;
} {
  if (!saved) {
    return { defaultViewport: STORY_CANVAS_COLD_VIEWPORT, fitView: true };
  }
  return { defaultViewport: saved.viewport, fitView: false };
}

/**
 * The first hydration of a chapter has no live React Flow selection — the
 * instance was just created. Seed it from the saved view. Later reconciles
 * keep whatever the author currently has selected.
 */
export function storyCanvasHydrationSelection(
  availableNodeIds: readonly string[],
  liveSelectedIds: readonly string[],
  rememberedNodeIds: readonly string[],
  pendingNodeId: string | null,
  hydrated: boolean
): Set<string> {
  return reconcileStoryCanvasSelectedIds(
    availableNodeIds,
    new Set(hydrated ? liveSelectedIds : rememberedNodeIds),
    pendingNodeId
  );
}

/** Reopen the inspector only when its node is still part of the restored selection. */
export function storyCanvasInspectorToRestore(
  remembered: StoryCanvasInspectorTarget | undefined,
  selectedNodeIds: ReadonlySet<string>
): StoryCanvasInspectorTarget {
  if (remembered?.kind === "node" && selectedNodeIds.has(remembered.nodeId)) {
    return remembered;
  }
  return CLOSED_STORY_CANVAS_INSPECTOR;
}
