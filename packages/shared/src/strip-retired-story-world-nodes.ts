import {
  storyAutoFallbackNodeId,
  storyNodeTarget,
  storyRouteNodeId,
  type StoryRouteTarget,
} from "./story-stats.js";

/**
 * Drafts saved while plot-tree world cards existed may still contain
 * `kind: "world"` nodes. Those cards are no longer authored. Reading a draft
 * drops them and reconnects the film around the gap (clip A -> world -> clip B
 * becomes clip A -> clip B). World resources themselves are left alone.
 */
type RetiredRoute = { target: StoryRouteTarget | null };
type RetiredAction = { kind: string; target?: StoryRouteTarget | null };
type RetiredInteraction = {
  outcomes: {
    success: RetiredAction;
    failure?: RetiredAction;
    timeout?: RetiredAction;
  };
};
type RetiredNode = {
  kind: string;
  nodeId: string;
  interactions?: RetiredInteraction[];
  exit: {
    kind: string;
    routes?: RetiredRoute[];
    choices?: Array<{ target: StoryRouteTarget | null }>;
  };
};

type RetiredDraft = {
  graph: {
    entryNodeId: string | null;
    nodes: RetiredNode[];
  };
};

export function stripRetiredStoryWorldNodes<T>(content: T): T {
  const draft = content as T & RetiredDraft;
  if (!draft?.graph?.nodes?.some((node) => node.kind === "world")) return content;

  const nodesById = new Map(draft.graph.nodes.map((node) => [node.nodeId, node]));
  const resolveActiveTarget = (targetNodeId: string | null): string | null => {
    let currentNodeId = targetNodeId;
    const visited = new Set<string>();

    while (currentNodeId) {
      if (visited.has(currentNodeId)) return null;
      visited.add(currentNodeId);
      const node = nodesById.get(currentNodeId);
      if (!node || node.kind !== "world") return currentNodeId;
      currentNodeId = storyAutoFallbackNodeId(
        node.exit as Parameters<typeof storyAutoFallbackNodeId>[0]
      );
    }
    return null;
  };

  const nodes = draft.graph.nodes.flatMap((node) => {
    if (node.kind === "world") return [];

    const interactions = (node.kind === "clip" ? (node.interactions ?? []) : []).map(
      (interaction) => {
        const resolveAction = (action: RetiredAction): RetiredAction => {
          if (action.kind !== "goto") return action;
          const targetNodeId = resolveActiveTarget(storyRouteNodeId(action.target ?? null));
          return targetNodeId
            ? { kind: "goto", target: { kind: "node", nodeId: targetNodeId } }
            : { kind: "continue" };
        };
        return {
          ...interaction,
          outcomes: {
            success: resolveAction(interaction.outcomes.success),
            ...(interaction.outcomes.failure
              ? { failure: resolveAction(interaction.outcomes.failure) }
              : {}),
            ...(interaction.outcomes.timeout
              ? { timeout: resolveAction(interaction.outcomes.timeout) }
              : {}),
          },
        };
      }
    );

    const resolveTarget = (target: StoryRouteTarget | null) => {
      if (!target) return null;
      if (target.kind === "ending") return target;
      return storyNodeTarget(resolveActiveTarget(target.nodeId));
    };

    if (node.exit.kind === "auto") {
      if (node.kind !== "clip") return [node];
      return [
        {
          ...node,
          interactions,
          exit: {
            ...node.exit,
            kind: "auto" as const,
            routes: (node.exit.routes ?? []).map((route) => ({
              ...route,
              target: resolveTarget(route.target),
            })),
          },
        },
      ];
    }

    return [
      {
        ...node,
        ...(node.kind === "clip" ? { interactions } : {}),
        exit: {
          ...node.exit,
          choices: (node.exit.choices ?? []).map((choice) => ({
            ...choice,
            target: resolveTarget(choice.target),
          })),
        },
      },
    ];
  });

  return {
    ...draft,
    graph: {
      ...draft.graph,
      entryNodeId: resolveActiveTarget(draft.graph.entryNodeId),
      nodes,
    },
  } as T;
}
