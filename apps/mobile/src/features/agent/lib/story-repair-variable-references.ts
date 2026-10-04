import { StoryConditionSchema, type StoryCondition } from "@repo/shared/story-stats";
import type { RepairContent } from "./story-repair-fields";
type Row = Record<string, unknown>;
const row = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error(
      "The story contains unreadable state references. Reload before removing a variable."
    );
  return v as Row;
};
const rows = (v: unknown): Row[] => {
  if (!Array.isArray(v))
    throw Error(
      "The story contains unreadable state references. Reload before removing a variable."
    );
  return v.map(row);
};
function condition(value: StoryCondition, keys: Set<string>): StoryCondition | undefined {
  if (value.kind === "compare") return keys.has(value.variableKey) ? undefined : value;
  if (value.kind === "not") {
    const inner = condition(value.condition, keys);
    return inner ? { kind: "not", condition: inner } : undefined;
  }
  const next = value.conditions.flatMap((child) => {
    const result = condition(child, keys);
    return result ? [result] : [];
  });
  if (!next.length) return undefined;
  if (next.length === 1) return next[0];
  return { kind: value.kind, conditions: next };
}
function effects(value: Row, field: string, keys: Set<string>): Row {
  const next = { ...value };
  const kept =
    value[field] == null
      ? []
      : rows(value[field]).filter((effect) => !keys.has(String(effect.key)));
  if (kept.length) next[field] = kept;
  else delete next[field];
  return next;
}
/** Web removes the deleted variables from conditions and all state-effect locations. */
export function removeRepairVariableReferences(
  content: RepairContent,
  keys: Set<string>
): RepairContent {
  if (!keys.size) return content;
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => {
        let next: RepairContent["graph"]["nodes"][number] = {
          ...effects(node, "onEnterEffects", keys),
          nodeId: node.nodeId,
        };
        if (node.kind === "clip") {
          next = {
            ...next,
            interactions: rows(node.interactions).map((interaction) => ({
              ...interaction,
              outcomes: Object.fromEntries(
                Object.entries(row(interaction.outcomes)).map(([key, action]) => [
                  key,
                  effects(row(action), "effects", keys),
                ])
              ),
            })),
          };
        }
        const exit = row(node.exit);
        if (exit.kind === "auto") {
          const routes = rows(exit.routes).flatMap((route) => {
            if (!route.when) return [route];
            const when = condition(StoryConditionSchema.parse(route.when), keys);
            return when ? [{ ...route, when }] : [];
          });
          next.exit = { ...exit, routes: routes.length ? routes : [{ target: null }] };
        } else if (exit.kind === "choice") {
          next.exit = {
            ...exit,
            choices: rows(exit.choices).map((choice) => {
              const result = effects(choice, "effects", keys);
              const visible = choice.visibleWhen
                ? condition(StoryConditionSchema.parse(choice.visibleWhen), keys)
                : undefined;
              if (visible) result.visibleWhen = visible;
              else delete result.visibleWhen;
              return result;
            }),
          };
        } else
          throw Error("The story contains an unsupported exit. Reload before removing a variable.");
        return next;
      }),
    },
  };
}
