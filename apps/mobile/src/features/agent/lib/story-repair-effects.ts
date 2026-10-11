import { StoryStateEffectsSchema, storyEffectTypeError } from "@repo/shared/story-stats";
import { repairVariables } from "./story-repair-conditions";
import { repairChoiceExit, type RepairContent } from "./story-repair-fields";

export type EffectTarget = { nodeId: string; choiceId?: string };
export function repairEffects(content: RepairContent, target: EffectTarget): unknown {
  const node = content.graph.nodes.find((n) => n.nodeId === target.nodeId);
  if (!node) return undefined;
  if (!target.choiceId) return node.onEnterEffects ?? [];
  const choice = (
    repairChoiceExit(content, target.nodeId)?.choices as Record<string, unknown>[] | undefined
  )?.find((row) => row.choiceId === target.choiceId);
  if (!choice) return undefined;
  return choice.effects ?? [];
}

export function replaceRepairEffects(
  content: RepairContent,
  target: EffectTarget,
  expected: unknown,
  value: unknown
): RepairContent {
  if (
    repairEffects(content, target) === undefined ||
    JSON.stringify(repairEffects(content, target)) !== JSON.stringify(expected)
  )
    throw Error("The selected effects changed. Reopen the editor before editing.");
  const effects = StoryStateEffectsSchema.parse(value);
  const variables = new Map(repairVariables(content, "en-US").map((v) => [v.key, v]));
  for (const effect of effects) {
    const error = storyEffectTypeError(effect, variables);
    if (error) throw Error(error);
  }
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => {
        if (node.nodeId !== target.nodeId) return node;
        if (!target.choiceId) return { ...node, onEnterEffects: effects };
        const exit = repairChoiceExit(content, target.nodeId)!;
        return {
          ...node,
          exit: {
            ...exit,
            choices: (exit.choices as Record<string, unknown>[]).map((choice) =>
              choice.choiceId === target.choiceId ? { ...choice, effects } : choice
            ),
          },
        };
      }),
    },
  };
}
