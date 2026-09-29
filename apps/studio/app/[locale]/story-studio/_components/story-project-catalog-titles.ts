import type { StoryGraphNode } from "@/lib/story-projects-api";

/**
 * Catalog labels. An automatic clip key such as SCENE_1 is a storage id, so
 * an unnamed clip uses the same readable title as its canvas card.
 */
export function catalogNodeTitles(
  nodes: readonly StoryGraphNode[],
  clipLabel: string,
  choiceLabel: string
): Map<string, string> {
  let clipOrdinal = 0;
  const names = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== "clip") {
      names.set(node.nodeId, choiceLabel);
      continue;
    }
    clipOrdinal += 1;
    const name = node.name?.trim();
    names.set(node.nodeId, name && name !== node.clipKey ? name : `${clipLabel} ${clipOrdinal}`);
  }
  return names;
}
