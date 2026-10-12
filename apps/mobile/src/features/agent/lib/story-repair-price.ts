import type { RepairContent } from "./story-repair-fields";
export const MAX_REPAIR_POINT_PRICE = 2_147_483_647;
export function parseRepairPointPrice(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const price = Number(normalized);
  return Number.isSafeInteger(price) && price <= MAX_REPAIR_POINT_PRICE ? price : null;
}
export function readRepairPointPrice(content: RepairContent, nodeId: string): number {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  if (!node || node.kind !== "clip") throw Error("The selected scene is no longer available.");
  const value = node.communityPointPrice ?? 0;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_REPAIR_POINT_PRICE
  )
    throw Error("Invalid Community Points price.");
  return value;
}
export function replaceRepairPointPrice(
  content: RepairContent,
  nodeId: string,
  expected: number,
  price: number
): RepairContent {
  if (readRepairPointPrice(content, nodeId) !== expected)
    throw Error("The scene price changed. Reopen the editor before applying changes.");
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_REPAIR_POINT_PRICE)
    throw Error("Invalid Community Points price.");
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => {
        if (node.nodeId !== nodeId) return node;
        const next = { ...node };
        if (price > 0) next.communityPointPrice = price;
        else delete next.communityPointPrice;
        return next;
      }),
    },
  };
}
