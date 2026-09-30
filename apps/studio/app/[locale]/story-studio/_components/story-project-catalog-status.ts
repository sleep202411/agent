import {
  storyConditionVariableKeys,
  storyExitNodeIds,
  storyRouteNodeId,
  type StoryRouteTarget,
  type StoryStateEffect,
} from "@repo/shared/story-stats";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";

export interface CatalogVariableStatus {
  key: string;
  name: Record<string, string>;
}

export interface CatalogStatus {
  nodeMarks: Map<string, "problem" | "unlinked">;
  redundantVariables: CatalogVariableStatus[];
}

export function catalogStatus(
  content: InteractiveStoryDraftContent,
  entryNodeId: string | null
): CatalogStatus {
  const nodes = content.graph.nodes;
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const endings = content.storyBible.endings ?? [];
  const endingIds = new Set(endings.map((ending) => ending.endingId));
  const reachable = reachableNodeIds(nodes, entryNodeId);
  const nodeMarks = new Map<string, "problem" | "unlinked">();
  nodes.forEach((node) => {
    if (hasBrokenTarget(node, nodeIds, endingIds)) {
      nodeMarks.set(node.nodeId, "problem");
      return;
    }
    if (entryNodeId && !reachable.has(node.nodeId)) {
      nodeMarks.set(node.nodeId, "unlinked");
    }
  });

  const usedVariableKeys = referencedVariableKeys(nodes);
  return {
    nodeMarks,
    redundantVariables: (content.storyBible.stateVariables ?? [])
      .filter((variable) => !usedVariableKeys.has(variable.key))
      .map((variable) => ({ key: variable.key, name: variable.name })),
  };
}

function reachableNodeIds(
  nodes: readonly StoryGraphNode[],
  entryNodeId: string | null
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const reachable = new Set<string>();
  const pending = entryNodeId ? [entryNodeId] : [];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    const node = byId.get(nodeId);
    if (!node) continue;
    reachable.add(nodeId);
    storyExitNodeIds(node.exit).forEach((next) => pending.push(next));
    if (node.kind !== "clip") continue;
    node.interactions.forEach((interaction) => {
      Object.values(interaction.outcomes).forEach((action) => {
        if (action?.kind !== "goto") return;
        const target = storyRouteNodeId(action.target);
        if (target) pending.push(target);
      });
    });
  }
  return reachable;
}

function hasBrokenTarget(
  node: StoryGraphNode,
  nodeIds: ReadonlySet<string>,
  endingIds: ReadonlySet<string>
): boolean {
  return routeTargets(node).some((target) => {
    if (!target) return false;
    if (target.kind === "node") return !nodeIds.has(target.nodeId);
    return !endingIds.has(target.endingId);
  });
}

function routeTargets(node: StoryGraphNode): Array<StoryRouteTarget | null> {
  if (node.exit.kind === "choice") return node.exit.choices.map((choice) => choice.target);
  return node.exit.routes.map((route) => route.target);
}

function referencedVariableKeys(nodes: readonly StoryGraphNode[]): Set<string> {
  const keys = new Set<string>();
  const noteEffects = (effects: readonly StoryStateEffect[] | undefined) => {
    effects?.forEach((effect) => keys.add(effect.key));
  };
  const noteCondition = (
    condition: Parameters<typeof storyConditionVariableKeys>[0] | undefined
  ) => {
    if (!condition) return;
    storyConditionVariableKeys(condition).forEach((key) => keys.add(key));
  };
  nodes.forEach((node) => {
    noteEffects(node.onEnterEffects);
    if (node.kind === "clip") {
      node.interactions.forEach((interaction) => {
        Object.values(interaction.outcomes).forEach((action) => noteEffects(action?.effects));
      });
    }
    if (node.exit.kind === "choice") {
      node.exit.choices.forEach((choice) => {
        noteEffects(choice.effects);
        noteCondition(choice.visibleWhen);
      });
      return;
    }
    node.exit.routes.forEach((route) => noteCondition(route.when));
  });
  return keys;
}
