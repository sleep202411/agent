import type { RepairContent } from "./story-repair-fields";
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export function createRepairNode(
  content: RepairContent,
  kind: "clip" | "decision",
  locale: string,
  defaultLocale: string,
  identity: string,
  labels: string[] = []
): { nodeId: string; content: RepairContent } {
  if (content.graph.nodes.length >= 10000) throw Error("A story supports at most 10,000 nodes.");
  if (!locale.trim() || !defaultLocale.trim()) throw Error("The project language is unavailable.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity))
    throw Error("A valid node identity is required.");
  const nodes = content.graph.nodes;
  const nodeId = `${kind}:${identity}`;
  const clipKey = `SCENE_${identity.replaceAll("-", "").toUpperCase()}`;
  if (
    nodes.some(
      (n) => n.nodeId === nodeId || n.clipKey === clipKey || object(n.exit)?.decisionId === nodeId
    )
  )
    throw Error("This node identity already exists.");
  const decisionId = nodeId;
  const node: RepairContent["graph"]["nodes"][number] =
    kind === "clip"
      ? {
          kind,
          nodeId,
          clipKey,
          interactions: [],
          exit: { kind: "auto", routes: [{ target: null }] },
        }
      : {
          kind,
          nodeId,
          exit: {
            kind: "choice",
            decisionId,
            prompt: { [defaultLocale]: "", [locale]: "" },
            choices: labels.slice(0, 6).map((label, i) => ({
              choiceId: `option:${i + 1}`,
              label: { [defaultLocale]: label, [locale]: label },
              target: null,
            })),
          },
        };
  return {
    nodeId,
    content: {
      ...content,
      graph: {
        ...content.graph,
        entryNodeId: content.graph.entryNodeId ?? nodeId,
        nodes: [...nodes, node],
      },
    },
  };
}
export function updateRepairNodeText(
  content: RepairContent,
  nodeId: string,
  field: "name" | "description",
  text: string
): RepairContent {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  if (!node || node.kind !== "clip") throw Error("The selected scene is no longer available.");
  if (text.length > (field === "name" ? 120 : 4000))
    throw Error("Scene text exceeds its supported length.");
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((n) => (n.nodeId === nodeId ? { ...n, [field]: text } : n)),
    },
  };
}
