import type {
  InteractiveStoryDraftContent,
  StoryGraphNode,
  StoryInteractionAction,
} from "@/lib/story-projects-api";
import {
  storyAutoFallbackNodeId,
  storyNodeTarget,
  storyRouteNodeId,
  type StoryRouteTarget,
} from "@repo/shared/story-stats";

/**
 * World experiences are temporarily unavailable while the upstream provider
 * has closed its test entry. Keep the domain implementation intact, but remove
 * the capability from the active authoring and playtest graph.
 */
export const STORY_WORLD_EXPERIENCE_AVAILABLE = false;

export function applyActiveStoryCanvasCapabilities(
  content: InteractiveStoryDraftContent
): InteractiveStoryDraftContent {
  return STORY_WORLD_EXPERIENCE_AVAILABLE ? content : removeWorldExperienceNodes(content);
}

/**
 * Removes unavailable world nodes while preserving the surrounding film flow.
 * A chain such as clip A -> world -> clip B becomes clip A -> clip B. World
 * resources themselves are not deleted; only their chapter graph projections
 * are retired from the video-and-hotspot authoring surface.
 */
export function removeWorldExperienceNodes(
  content: InteractiveStoryDraftContent
): InteractiveStoryDraftContent {
  if (!content.graph.nodes.some((node) => node.kind === "world")) return content;

  const nodesById = new Map(content.graph.nodes.map((node) => [node.nodeId, node]));
  const resolveActiveTarget = (targetNodeId: string | null): string | null => {
    let currentNodeId = targetNodeId;
    const visited = new Set<string>();

    while (currentNodeId) {
      if (visited.has(currentNodeId)) return null;
      visited.add(currentNodeId);
      const node = nodesById.get(currentNodeId);
      if (!node || node.kind !== "world") return currentNodeId;
      currentNodeId = storyAutoFallbackNodeId(node.exit);
    }
    return null;
  };

  const nodes = content.graph.nodes.flatMap<StoryGraphNode>((node) => {
    if (node.kind === "world") return [];

    const interactions = (node.kind === "clip" ? node.interactions : []).map((interaction) => {
      const resolveAction = (action: StoryInteractionAction): StoryInteractionAction => {
        if (action.kind !== "goto") return action;
        const targetNodeId = resolveActiveTarget(storyRouteNodeId(action.target));
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
    });

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
            kind: "auto" as const,
            routes: node.exit.routes.map((route) => ({
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
          choices: node.exit.choices.map((choice) => ({
            ...choice,
            target: resolveTarget(choice.target),
          })),
        },
      },
    ];
  });

  return {
    ...content,
    graph: {
      entryNodeId: resolveActiveTarget(content.graph.entryNodeId),
      nodes,
    },
  };
}
