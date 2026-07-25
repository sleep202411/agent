import { DEFAULT_CANVAS_GROUP_COLOR, type CanvasGroup, type CanvasGroupColor } from "./types";

function sameGroup(left: CanvasGroup, right: CanvasGroup): boolean {
  return (
    left.id === right.id &&
    left.color === right.color &&
    left.nodeIds.length === right.nodeIds.length &&
    left.nodeIds.every((nodeId, index) => nodeId === right.nodeIds[index])
  );
}

export function sameCanvasGroups(
  left: readonly CanvasGroup[],
  right: readonly CanvasGroup[]
): boolean {
  return (
    left.length === right.length && left.every((group, index) => sameGroup(group, right[index]))
  );
}

/** Removes stale/cross-group memberships and dissolves groups with fewer than two members. */
export function reconcileCanvasGroups(
  groups: readonly CanvasGroup[],
  nodeIds: Iterable<string>
): CanvasGroup[] {
  const existingNodeIds = new Set(nodeIds);
  const claimedNodeIds = new Set<string>();
  const groupIds = new Set<string>();
  const next: CanvasGroup[] = [];

  groups.forEach((group) => {
    if (groupIds.has(group.id)) return;
    groupIds.add(group.id);
    const members: string[] = [];
    group.nodeIds.forEach((nodeId) => {
      if (!existingNodeIds.has(nodeId) || claimedNodeIds.has(nodeId)) return;
      claimedNodeIds.add(nodeId);
      members.push(nodeId);
    });
    if (members.length >= 2) next.push({ ...group, nodeIds: members });
  });

  return next;
}

export type CanvasGroupingAction =
  | { type: "group"; nodeIds: string[] }
  | {
      type: "ungroup";
      groupId: string;
      nodeIds: string[];
      color: CanvasGroupColor;
    };

export function canvasGroupingAction(
  groups: readonly CanvasGroup[],
  nodeIds: Iterable<string>
): CanvasGroupingAction | null {
  const selectedNodeIds = [...new Set(nodeIds)];
  if (selectedNodeIds.length < 2) return null;
  const selected = new Set(selectedNodeIds);
  const completeGroup = groups.find(
    (group) =>
      group.nodeIds.length === selected.size &&
      group.nodeIds.every((nodeId) => selected.has(nodeId))
  );
  return completeGroup
    ? {
        type: "ungroup",
        groupId: completeGroup.id,
        nodeIds: selectedNodeIds,
        color: completeGroup.color,
      }
    : { type: "group", nodeIds: selectedNodeIds };
}

/**
 * Creates a group from the exact selection. Selected members leave any
 * previous group; previous groups that fall below two members dissolve.
 */
export function groupCanvasNodes(
  groups: readonly CanvasGroup[],
  groupId: string,
  nodeIds: Iterable<string>,
  color: CanvasGroupColor = DEFAULT_CANVAS_GROUP_COLOR
): CanvasGroup[] {
  const incoming = [...new Set(nodeIds)];
  if (incoming.length < 2) {
    return groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));
  }
  const selected = new Set(incoming);
  const retainedGroups = groups
    .filter((group) => group.id !== groupId)
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((nodeId) => !selected.has(nodeId)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
  return [...retainedGroups, { id: groupId, nodeIds: incoming, color }];
}

/**
 * Moves nodes into an existing group while preserving that group's identity,
 * color and ordering. Nodes leave any previous group; previous groups that
 * fall below two members dissolve.
 */
export function addNodesToCanvasGroup(
  groups: readonly CanvasGroup[],
  groupId: string,
  nodeIds: Iterable<string>
): CanvasGroup[] {
  const target = groups.find((group) => group.id === groupId);
  if (!target) return groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));

  const incoming = [...new Set(nodeIds)].filter((nodeId) => !target.nodeIds.includes(nodeId));
  if (incoming.length === 0) {
    return groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));
  }

  const moved = new Set(incoming);
  return groups
    .map((group) =>
      group.id === groupId
        ? { ...group, nodeIds: [...group.nodeIds, ...incoming] }
        : { ...group, nodeIds: group.nodeIds.filter((nodeId) => !moved.has(nodeId)) }
    )
    .filter((group) => group.id === groupId || group.nodeIds.length >= 2);
}

export function ungroupCanvasNodes(groups: readonly CanvasGroup[], groupId: string): CanvasGroup[] {
  return groups
    .filter((group) => group.id !== groupId)
    .map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));
}

export function removeNodesFromCanvasGroups(
  groups: readonly CanvasGroup[],
  nodeIds: Iterable<string>
): CanvasGroup[] {
  const removed = new Set(nodeIds);
  if (removed.size === 0) {
    return groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));
  }
  return groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((nodeId) => !removed.has(nodeId)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
}

export function setCanvasGroupColor(
  groups: readonly CanvasGroup[],
  groupId: string,
  color: CanvasGroupColor
): CanvasGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, color } : { ...group }));
}
