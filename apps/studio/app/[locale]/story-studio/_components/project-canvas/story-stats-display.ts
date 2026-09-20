import type {
  StoryCompareOperator,
  StoryCondition,
  StoryStateEffect,
  StoryStateValueType,
} from "@repo/shared/story-stats";

/** UI kind shown in the effect dropdown; negative add renders as Subtract. */
export type StoryEffectUiKind = "add" | "subtract" | "set";

export function storyEffectKindOption(effect: StoryStateEffect): StoryEffectUiKind {
  if (effect.kind === "add" && effect.amount < 0) return "subtract";
  return effect.kind;
}

export function storyRetargetEffectKind(
  effect: StoryStateEffect,
  kind: StoryEffectUiKind,
  variable: { valueType: StoryStateValueType } | undefined
): StoryStateEffect {
  if (variable?.valueType === "boolean") return { kind: "set", key: effect.key, value: true };
  const magnitude = effect.kind === "add" ? Math.abs(effect.amount) : 1;
  if (kind === "add") {
    return { kind: "add", key: effect.key, amount: magnitude };
  }
  if (kind === "subtract") {
    return { kind: "add", key: effect.key, amount: -magnitude || 0 };
  }
  return {
    kind: "set",
    key: effect.key,
    value: effect.kind === "set" && typeof effect.value === "number" ? effect.value : 0,
  };
}

const COMPARE_OPERATOR_SYMBOL: Record<StoryCompareOperator, string> = {
  equals: "=",
  "not-equals": "≠",
  "greater-than": ">",
  "at-least": "≥",
  "less-than": "<",
  "at-most": "≤",
};

export function storyVariableDisplayName(key: string, names: ReadonlyMap<string, string>): string {
  return names.get(key)?.trim() || key;
}

export function formatStoryEffectChip(
  effect: StoryStateEffect,
  names: ReadonlyMap<string, string>
): string {
  const { name, delta } = storyEffectRowParts(effect, names);
  return `${name} ${delta}`;
}

export function storyEffectRowParts(
  effect: StoryStateEffect,
  names: ReadonlyMap<string, string>
): { name: string; delta: string } {
  const name = storyVariableDisplayName(effect.key, names);
  if (effect.kind === "add") {
    const sign = effect.amount > 0 ? "+" : "";
    return { name, delta: `${sign}${effect.amount}` };
  }
  return { name, delta: `= ${formatStoryLiteral(effect.value)}` };
}

export function formatStoryEffectsChip(
  effects: readonly StoryStateEffect[] | undefined,
  names: ReadonlyMap<string, string>
): string | null {
  if (!effects?.length) return null;
  return effects.map((effect) => formatStoryEffectChip(effect, names)).join(", ");
}

export function formatStoryConditionChip(
  condition: StoryCondition,
  names: ReadonlyMap<string, string>
): string {
  if (condition.kind === "compare") {
    const operator = COMPARE_OPERATOR_SYMBOL[condition.operator];
    return `${storyVariableDisplayName(condition.variableKey, names)} ${operator} ${formatStoryLiteral(condition.value)}`;
  }
  if (condition.kind === "not") {
    return `¬(${formatStoryConditionChip(condition.condition, names)})`;
  }
  const joiner = condition.kind === "all" ? " ∧ " : " ∨ ";
  return condition.conditions.map((child) => formatStoryConditionChip(child, names)).join(joiner);
}

export function formatStoryLiteral(value: number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function storyVariableNameMap(
  variables: readonly { key: string; name: Record<string, string> }[] | undefined,
  locale: string,
  localized: (text: Record<string, string> | undefined, locale: string) => string
): Map<string, string> {
  return new Map(
    (variables ?? []).map((variable) => [variable.key, localized(variable.name, locale)])
  );
}
