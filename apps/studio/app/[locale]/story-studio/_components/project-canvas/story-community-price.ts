import type { InteractiveStoryDraftContent } from "@/lib/story-projects-api";

export const MAX_STORY_COMMUNITY_POINT_PRICE = 2_147_483_647;

export function parseStoryCommunityPointPrice(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isSafeInteger(price) && price <= MAX_STORY_COMMUNITY_POINT_PRICE ? price : null;
}

/** The story node owns its price; choices only project the destination price. */
export function updateStoryCommunityPointPrice(
  content: InteractiveStoryDraftContent,
  nodeId: string,
  price: number
): InteractiveStoryDraftContent {
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_STORY_COMMUNITY_POINT_PRICE) {
    throw new Error("Invalid Community Points price.");
  }
  const source = content.graph.nodes.find((node) => node.nodeId === nodeId);
  if (!source) throw new Error(`Unknown story node ${nodeId}.`);
  if (source.kind === "decision") throw new Error("Only story nodes can have a price.");
  if ((source.communityPointPrice ?? 0) === price) return content;
  const next = { ...source };
  if (price > 0) next.communityPointPrice = price;
  else delete next.communityPointPrice;
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => (node.nodeId === nodeId ? next : node)),
    },
  };
}
