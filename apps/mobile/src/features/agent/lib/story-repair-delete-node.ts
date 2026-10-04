import type { RepairContent } from "./story-repair-fields";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("The story contains unreadable graph data. Reload before removing a node.");
  return value as Row;
};
const rows = (value: unknown): Row[] => {
  if (!Array.isArray(value))
    throw Error("The story contains unreadable graph data. Reload before removing a node.");
  return value.map(row);
};
const targets = (target: unknown, nodeId: string) =>
  target != null && row(target).kind === "node" && row(target).nodeId === nodeId;

/** Match Web deletion, including preserving decisions previously attached to clips. */
export function deleteRepairNode(content: RepairContent, nodeId: string): RepairContent {
  if (!content.graph.nodes.some((node) => node.nodeId === nodeId))
    throw Error("The selected node is no longer available.");
  const ids = new Set(content.graph.nodes.map((node) => node.nodeId));
  const materialized = content.graph.nodes.flatMap((node) => {
    const exit = row(node.exit);
    if (node.kind !== "clip" || exit.kind !== "choice") return [node];
    const base = `decision:${node.nodeId}`.slice(0, 120);
    let id = base;
    for (let suffix = 2; ids.has(id); suffix++) {
      const tail = `-${suffix}`;
      id = `${base.slice(0, 120 - tail.length)}${tail}`;
    }
    ids.add(id);
    return [
      { ...node, exit: { kind: "auto", routes: [{ target: { kind: "node", nodeId: id } }] } },
      { kind: "decision", nodeId: id, exit },
    ];
  });
  const nodes: RepairContent["graph"]["nodes"] = materialized
    .filter((node) => node.nodeId !== nodeId)
    .map((node) => {
      const exit = row(node.exit);
      let nextExit: Row;
      if (exit.kind === "auto") {
        const remaining = rows(exit.routes).flatMap((route) =>
          !targets(route.target, nodeId) ? [route] : route.when ? [] : [{ ...route, target: null }]
        );
        nextExit = {
          ...exit,
          routes: [
            ...remaining.filter((route) => route.when),
            remaining.find((route) => !route.when) ?? { target: null },
          ],
        };
      } else if (exit.kind === "choice") {
        nextExit = {
          ...exit,
          choices: rows(exit.choices).map((choice) =>
            targets(choice.target, nodeId) ? { ...choice, target: null } : choice
          ),
        };
      } else throw Error("The story contains an unsupported exit. Reload before removing a node.");
      if (node.kind !== "clip") return { ...node, exit: nextExit };
      const interactions = rows(node.interactions).map((interaction) => {
        const outcomes = row(interaction.outcomes);
        const next = { ...outcomes };
        for (const key of ["success", "failure", "timeout"]) {
          const action = outcomes[key] == null ? null : row(outcomes[key]);
          if (action?.kind !== "goto" || !targets(action.target, nodeId)) continue;
          if (key === "success") next[key] = { kind: "continue" };
          else delete next[key];
        }
        return { ...interaction, outcomes: next };
      });
      return { ...node, exit: nextExit, interactions };
    });
  if (nodes.length > 10000) throw Error("A story supports at most 10,000 nodes.");
  const usedEndings = new Set<unknown>();
  const note = (target: unknown) => {
    if (target != null && row(target).kind === "ending") usedEndings.add(row(target).endingId);
  };
  for (const node of nodes) {
    const exit = row(node.exit);
    rows(exit.kind === "choice" ? exit.choices : exit.routes).forEach((item) => note(item.target));
    if (node.kind === "clip")
      rows(node.interactions).forEach((interaction) => {
        Object.values(row(interaction.outcomes)).forEach((value) => {
          if (value != null && row(value).kind === "goto") note(row(value).target);
        });
      });
  }
  const bible = row(content.storyBible);
  return {
    ...content,
    storyBible:
      bible.endings == null
        ? bible
        : {
            ...bible,
            endings: rows(bible.endings).filter((ending) => usedEndings.has(ending.endingId)),
          },
    graph: {
      ...content.graph,
      entryNodeId: content.graph.entryNodeId === nodeId ? null : content.graph.entryNodeId,
      nodes,
    },
  };
}
