import type { StoryRepairDraft } from "../api/story-draft-repair-api";
export type RepairContent = StoryRepairDraft["content"];
export type RepairTarget = { kind: "node"; nodeId: string } | { kind: "ending"; endingId: string };
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function sameRepairTarget(left: unknown, right: RepairTarget): boolean {
  const value = object(left);
  return (
    value?.kind === right.kind &&
    (right.kind === "node" ? value.nodeId === right.nodeId : value.endingId === right.endingId)
  );
}
/** Display-only graph positions distinguish copies without renaming authored scenes. */
export function repairNodeLabels(content: RepairContent): Map<string, string> {
  const names = content.graph.nodes.map((node) =>
    typeof node.name === "string" && node.name.trim() ? node.name.trim() : node.nodeId
  );
  const counts = new Map<string, number>();
  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  return new Map(
    content.graph.nodes.map((node, index) => [
      node.nodeId,
      counts.get(names[index])! > 1 ? `${names[index]} · ${index + 1}` : names[index],
    ])
  );
}
export function repairTargets(content: RepairContent, locale: string) {
  const labels = repairNodeLabels(content);
  const targets: { value: RepairTarget; label: string }[] = content.graph.nodes.map((node) => ({
    value: { kind: "node", nodeId: node.nodeId },
    label: labels.get(node.nodeId)!,
  }));
  const endings = object(content.storyBible)?.endings;
  if (Array.isArray(endings))
    for (const item of endings) {
      const row = object(item);
      if (typeof row?.endingId !== "string") continue;
      const title = object(row.title);
      targets.push({
        value: { kind: "ending", endingId: row.endingId },
        label: typeof title?.[locale] === "string" ? (title[locale] as string) : row.endingId,
      });
    }
  return targets;
}
export function repairBranches(content: RepairContent, nodeId: string, locale: string) {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  const exit = object(node?.exit);
  const rows = exit?.kind === "choice" ? exit.choices : exit?.kind === "auto" ? exit.routes : null;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value, index) => {
    const row = object(value);
    if (!row) return [];
    const label = object(row.label);
    return [
      {
        index,
        choiceId: typeof row.choiceId === "string" ? row.choiceId : null,
        label: typeof label?.[locale] === "string" ? (label[locale] as string) : null,
        target: row.target,
        conditional: row.when != null || row.condition != null,
      },
    ];
  });
}
export function replaceRepairTarget(
  content: RepairContent,
  nodeId: string,
  index: number,
  target: RepairTarget
): RepairContent {
  if (!repairTargets(content, "en-US").some((item) => sameRepairTarget(item.value, target)))
    throw Error("The selected destination is no longer available.");
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  const exit = object(node?.exit);
  const key = exit?.kind === "choice" ? "choices" : exit?.kind === "auto" ? "routes" : null;
  const rows = key ? exit?.[key] : null;
  if (!node || !exit || !key || !Array.isArray(rows) || !object(rows[index]))
    throw Error("The selected branch is no longer available.");
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((n) =>
        n.nodeId !== nodeId
          ? n
          : {
              ...n,
              exit: {
                ...exit,
                [key]: rows.map((row, i) => (i === index ? { ...object(row), target } : row)),
              },
            }
      ),
    },
  };
}

/** Match the official graph mutation without changing node contents or ordering. */
export function replaceRepairEntry(content: RepairContent, nodeId: string): RepairContent {
  if (!content.graph.nodes.some((node) => node.nodeId === nodeId))
    throw Error("The selected entry node is no longer available.");
  return { ...content, graph: { ...content.graph, entryNodeId: nodeId } };
}

export function repairChoiceExit(content: RepairContent, nodeId: string) {
  const exit = object(content.graph.nodes.find((node) => node.nodeId === nodeId)?.exit);
  return exit?.kind === "choice" && Array.isArray(exit.choices) ? exit : null;
}

function replaceChoiceExit(
  content: RepairContent,
  nodeId: string,
  change: (exit: Record<string, unknown>) => Record<string, unknown>
): RepairContent {
  const exit = repairChoiceExit(content, nodeId);
  if (!exit) throw Error("The selected decision is no longer available.");
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) =>
        node.nodeId === nodeId ? { ...node, exit: change(exit) } : node
      ),
    },
  };
}

export function addRepairChoice(
  content: RepairContent,
  nodeId: string,
  choiceId: string,
  locale: string
): RepairContent {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{0,119}$/.test(choiceId)) throw Error("Invalid choice identifier.");
  return replaceChoiceExit(content, nodeId, (exit) => {
    const choices = exit.choices as Record<string, unknown>[];
    if (choices.length >= 6) throw Error("A decision can contain at most six choices.");
    if (choices.some((choice) => choice.choiceId === choiceId))
      throw Error("This choice already exists.");
    return { ...exit, choices: [...choices, { choiceId, label: { [locale]: "" }, target: null }] };
  });
}

export function updateRepairChoiceText(
  content: RepairContent,
  nodeId: string,
  locale: string,
  text: string,
  index?: number
): RepairContent {
  return replaceChoiceExit(content, nodeId, (exit) => {
    if (index === undefined) return { ...exit, prompt: { ...object(exit.prompt), [locale]: text } };
    const choices = exit.choices as Record<string, unknown>[];
    if (!choices[index]) throw Error("The selected choice is no longer available.");
    return {
      ...exit,
      choices: choices.map((choice, i) =>
        i === index ? { ...choice, label: { ...object(choice.label), [locale]: text } } : choice
      ),
    };
  });
}
export function repairChoicePrompt(content: RepairContent, nodeId: string, locale: string): string {
  const value = object(repairChoiceExit(content, nodeId)?.prompt)?.[locale];
  return typeof value === "string" ? value : "";
}

export function arrangeRepairChoice(
  content: RepairContent,
  nodeId: string,
  choiceId: string,
  action: "up" | "down" | "remove"
): RepairContent {
  return replaceChoiceExit(content, nodeId, (exit) => {
    const choices = exit.choices as Record<string, unknown>[];
    const index = choices.findIndex((choice) => choice.choiceId === choiceId);
    if (index < 0) throw Error("The selected choice is no longer available.");
    if (action === "remove")
      return { ...exit, choices: choices.filter((choice) => choice.choiceId !== choiceId) };
    const target = index + (action === "up" ? -1 : 1);
    if (target < 0 || target >= choices.length) return exit;
    const next = [...choices];
    [next[index], next[target]] = [next[target], next[index]];
    return { ...exit, choices: next };
  });
}
