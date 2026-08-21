import type {
  StoryAgentCharacter,
  StoryAgentGraphNode,
  StoryPatchProposal,
} from "@repo/shared/story-agent";

export interface StoryAuthoringProposalReview {
  logline: string | null;
  synopsis: string | null;
  characters: StoryAgentCharacter[];
  scenes: StoryAgentGraphNode[];
  productionNotes: string[];
  metrics: {
    scenes: number;
    branches: number;
    endings: number;
    interactions: number;
  };
}

/**
 * Project the operation document into human-reviewable story content. The
 * dialog must explain the result creators are about to apply, never expose raw
 * patch JSON or machine operation labels.
 */
export function storyAuthoringProposalReview(
  proposal: StoryPatchProposal
): StoryAuthoringProposalReview {
  let logline: string | null = null;
  let synopsis: string | null = null;
  let productionNotes: string[] = [];
  let requestedOrder: string[] | null = null;
  const characters = new Map<string, StoryAgentCharacter>();
  const scenes = new Map<string, StoryAgentGraphNode>();

  for (const operation of proposal.operations) {
    switch (operation.kind) {
      case "story_bible.update_overview":
        if (operation.payload.logline !== undefined) logline = operation.payload.logline;
        if (operation.payload.synopsis !== undefined) synopsis = operation.payload.synopsis;
        break;
      case "story_bible.put_character":
        characters.set(operation.payload.character.id, operation.payload.character);
        break;
      case "story_bible.remove_character":
        characters.delete(operation.payload.characterId);
        break;
      case "story_graph.put_node":
        scenes.set(operation.payload.node.nodeId, operation.payload.node);
        break;
      case "story_graph.remove_node":
        scenes.delete(operation.payload.nodeId);
        break;
      case "story_graph.reorder_nodes":
        requestedOrder = operation.payload.nodeIds;
        break;
      case "production.replace_notes":
        productionNotes = operation.payload.productionNotes;
        break;
      case "story_graph.set_entry_node":
        break;
    }
  }

  const orderedScenes = orderScenes([...scenes.values()], requestedOrder);
  return {
    logline,
    synopsis,
    characters: [...characters.values()],
    scenes: orderedScenes,
    productionNotes,
    metrics: {
      scenes: orderedScenes.length,
      branches: orderedScenes.reduce(
        (count, scene) => count + (scene.exit.kind === "choice" ? scene.exit.choices.length : 0),
        0
      ),
      endings: orderedScenes.filter(
        (scene) => scene.exit.kind === "auto" && scene.exit.nextNodeId === null
      ).length,
      interactions: orderedScenes.reduce((count, scene) => count + scene.interactions.length, 0),
    },
  };
}

function orderScenes(
  scenes: StoryAgentGraphNode[],
  requestedOrder: string[] | null
): StoryAgentGraphNode[] {
  if (!requestedOrder) return scenes;
  const rank = new Map(requestedOrder.map((nodeId, index) => [nodeId, index]));
  return scenes.toSorted(
    (left, right) =>
      (rank.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function storyLocalizedText(value: Readonly<Record<string, string>>): string {
  return value["en-US"] ?? value["zh-CN"] ?? value["zh-HK"] ?? Object.values(value)[0] ?? "";
}
