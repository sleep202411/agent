export function reconcileStoryCanvasSelectedIds(
  availableNodeIds: readonly string[],
  selectedNodeIds: ReadonlySet<string>,
  pendingNodeId: string | null
): Set<string> {
  const available = new Set(availableNodeIds);

  if (pendingNodeId && available.has(pendingNodeId)) {
    return new Set([pendingNodeId]);
  }

  return new Set([...selectedNodeIds].filter((nodeId) => available.has(nodeId)));
}

/**
 * Resolves which node the inspector should follow after a selection change.
 *
 * The inspector opens ONLY from an explicit node click, never from selection
 * reconciliation: a marquee/box selection or a programmatic multi-select must
 * not pop the drawer open on a node the user did not click. So this returns a
 * node id only when the click path names it (`preferredNodeId`) or when the
 * already-focused node stays selected — otherwise null, which closes the node
 * inspector (or keeps the film-foundation panel).
 */
export function nextStoryCanvasFocusedNodeId(
  currentNodeId: string | null,
  selectedNodeIds: readonly string[],
  preferredNodeId: string | null = null
): string | null {
  if (preferredNodeId && selectedNodeIds.includes(preferredNodeId)) return preferredNodeId;
  if (currentNodeId && selectedNodeIds.includes(currentNodeId)) return currentNodeId;
  return null;
}

export type StoryCanvasNodeClickOutcome =
  | { kind: "drag-suppressed" }
  | { kind: "toggle-off"; remainingNodeIds: string[] }
  | { kind: "focus"; nodeId: string };

/**
 * Decides what a node pointer-up means. A pointer-up that concluded a drag
 * (`didDrag`) is never a click: it must not open the inspector, regardless of
 * xyflow's drag-threshold quirks. Shift-clicking an already-selected node
 * toggles it out of the multi-selection; any other click focuses the node.
 */
export function resolveStoryCanvasNodeClick(params: {
  nodeId: string;
  nodeSelected: boolean;
  shiftKey: boolean;
  didDrag: boolean;
  currentSelection: readonly string[];
}): StoryCanvasNodeClickOutcome {
  if (params.didDrag) return { kind: "drag-suppressed" };
  if (params.shiftKey && params.nodeSelected) {
    return {
      kind: "toggle-off",
      remainingNodeIds: params.currentSelection.filter((nodeId) => nodeId !== params.nodeId),
    };
  }
  return { kind: "focus", nodeId: params.nodeId };
}
