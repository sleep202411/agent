import type {
  InteractiveStoryDraftContent,
  StoryGraphNode,
  StoryInteractionAction,
} from "@/lib/story-projects-api";

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
      currentNodeId = node.exit.nextNodeId;
    }
    return null;
  };

  const nodes = content.graph.nodes.flatMap<StoryGraphNode>((node) => {
    if (node.kind === "world") return [];

    const interactions = node.interactions.map((interaction) => {
      const resolveAction = (action: StoryInteractionAction): StoryInteractionAction => {
        if (action.kind !== "goto") return action;
        const targetNodeId = resolveActiveTarget(action.nodeId);
        return targetNodeId ? { kind: "goto", nodeId: targetNodeId } : { kind: "continue" };
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

    if (node.exit.kind === "auto") {
      return [
        {
          ...node,
          interactions,
          exit: { kind: "auto" as const, nextNodeId: resolveActiveTarget(node.exit.nextNodeId) },
        },
      ];
    }

    return [
      {
        ...node,
        interactions,
        exit: {
          ...node.exit,
          choices: node.exit.choices.flatMap((choice) => {
            const targetNodeId = resolveActiveTarget(choice.nextNodeId);
            return targetNodeId ? [{ ...choice, nextNodeId: targetNodeId }] : [];
          }),
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
