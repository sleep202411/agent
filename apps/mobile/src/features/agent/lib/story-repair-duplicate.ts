import type { RepairContent } from "./story-repair-fields";
export type RepairDuplicateSource = { nodeId: string; role: "node" | "choice-exit" };
type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("The selected story contains unreadable data.");
  return value as Row;
};
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value)) throw Error("The selected story contains unreadable data.");
  return value.map(row);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
/** Match Web: internal links follow copies, external node links drop, ending links remain. */
export function duplicateRepairNodes(
  content: RepairContent,
  sources: RepairDuplicateSource[],
  identity: () => string
): { content: RepairContent; created: string[] } {
  const unique = [...new Map(sources.map((s) => [`${s.role}:${s.nodeId}`, s])).values()];
  const plan = unique.filter(
    (s) =>
      s.role !== "choice-exit" || !unique.some((n) => n.role === "node" && n.nodeId === s.nodeId)
  );
  if (!plan.length) throw Error("Select at least one node to duplicate.");
  if (content.graph.nodes.length + plan.length > 10000)
    throw Error("A story supports at most 10,000 nodes.");
  for (const source of plan) {
    const node = content.graph.nodes.find((n) => n.nodeId === source.nodeId);
    if (
      !node ||
      (node.kind !== "clip" && node.kind !== "decision") ||
      (source.role === "choice-exit" && (node.kind !== "clip" || row(node.exit).kind !== "choice"))
    )
      throw Error("A selected node is no longer available. Review the selection.");
  }
  const used = new Set<string>();
  const keys = new Set<string>();
  for (const node of content.graph.nodes) {
    used.add(node.nodeId);
    const exit = row(node.exit);
    if (typeof exit.decisionId === "string") used.add(exit.decisionId);
    if (node.kind === "clip") {
      if (typeof node.clipKey === "string") keys.add(node.clipKey);
      rows(node.interactions).forEach((i) => used.add(String(i.interactionId)));
    }
  }
  const allocate = (prefix: string) => {
    const id = identity();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw Error("A valid copy identity is required.");
    const result = `${prefix}:${id}`;
    if (used.has(result)) throw Error("This copy identity already exists.");
    used.add(result);
    return result;
  };
  const key = (s: RepairDuplicateSource) => `${s.role}:${s.nodeId}`;
  const mapped = new Map(
    plan.map((s) => [
      key(s),
      allocate(
        s.role === "choice-exit" ||
          content.graph.nodes.find((n) => n.nodeId === s.nodeId)!.kind === "decision"
          ? "decision"
          : "clip"
      ),
    ])
  );
  const target = (value: unknown): unknown => {
    if (value == null) return null;
    const original = row(value);
    if (original.kind === "ending") return clone(original);
    if (original.kind !== "node" || typeof original.nodeId !== "string")
      throw Error("An original link is unreadable.");
    const next = mapped.get(`node:${original.nodeId}`);
    return next ? { kind: "node", nodeId: next } : null;
  };
  const exit = (value: unknown): Row => {
    const original = row(value);
    if (original.kind === "choice")
      return {
        kind: "choice",
        decisionId: allocate("decision"),
        prompt: clone(original.prompt),
        choices: rows(original.choices).map((c) => ({ ...clone(c), target: target(c.target) })),
      };
    if (original.kind !== "auto") throw Error("The selected exit is unsupported.");
    const routes = rows(original.routes).flatMap((r) => {
      const next = target(r.target);
      if (r.target != null && row(r.target).kind === "node" && next === null && r.when) return [];
      return [{ ...clone(r), target: next }];
    });
    return { kind: "auto", routes: routes.length ? routes : [{ target: null }] };
  };
  const action = (value: unknown): Row => {
    const original = row(value);
    if (original.kind !== "goto") return clone(original);
    const next = target(original.target);
    return next
      ? { ...clone(original), target: next }
      : { kind: "continue", ...(original.effects ? { effects: clone(original.effects) } : {}) };
  };
  const copies = plan.map((source) => {
    const original = content.graph.nodes.find((n) => n.nodeId === source.nodeId)!;
    const nodeId = mapped.get(key(source))!;
    const common = {
      nodeId,
      ...(original.onEnterEffects ? { onEnterEffects: clone(original.onEnterEffects) } : {}),
      exit: exit(original.exit),
    };
    if (source.role === "choice-exit" || original.kind === "decision")
      return { kind: "decision", ...common };
    const clipKey = `SCENE_${nodeId.slice(5).replaceAll("-", "").toUpperCase()}`;
    if (keys.has(clipKey)) throw Error("This scene media key already exists.");
    keys.add(clipKey);
    return {
      kind: "clip",
      ...common,
      clipKey,
      ...(original.name ? { name: original.name } : {}),
      ...(original.description ? { description: original.description } : {}),
      ...(original.communityPointPrice !== undefined
        ? { communityPointPrice: original.communityPointPrice }
        : {}),
      interactions: rows(original.interactions).map((i) => ({
        ...clone(i),
        interactionId: allocate("hotspot"),
        outcomes: Object.fromEntries(
          Object.entries(row(i.outcomes)).map(([k, v]) => [k, action(v)])
        ),
      })),
    };
  });
  return {
    content: {
      ...content,
      graph: { ...content.graph, nodes: [...content.graph.nodes, ...copies] },
    },
    created: copies.map((n) => n.nodeId),
  };
}
