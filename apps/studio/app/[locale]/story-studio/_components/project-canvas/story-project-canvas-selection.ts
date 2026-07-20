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

export function nextStoryCanvasFocusedNodeId(
  currentNodeId: string | null,
  selectedNodeIds: readonly string[],
  preferredNodeId: string | null = null
): string | null {
  if (preferredNodeId && selectedNodeIds.includes(preferredNodeId)) return preferredNodeId;
  if (currentNodeId && selectedNodeIds.includes(currentNodeId)) return currentNodeId;
  return selectedNodeIds.at(-1) ?? null;
}
