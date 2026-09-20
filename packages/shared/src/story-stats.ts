import { z } from "zod";
import {
  ExperienceStatePathSchema,
  type ExperienceCondition,
  type ExperienceRuntimeAction,
} from "./experience-runtime.js";

export const MAX_STORY_STATE_VARIABLES = 64;
export const MAX_STORY_STATE_EFFECTS = 6;
export const MAX_STORY_CONDITION_DEPTH = 3;
export const MAX_STORY_CONDITION_LEAVES = 12;
export const MAX_STORY_EXIT_ROUTES = 8;
export const MAX_STORY_STATE_NOTE_LENGTH = 2_000;

export const StoryStateKeySchema = ExperienceStatePathSchema;
export type StoryStateKey = z.infer<typeof StoryStateKeySchema>;

export const StoryStateValueTypeSchema = z.enum(["number", "boolean"]);
export type StoryStateValueType = z.infer<typeof StoryStateValueTypeSchema>;

export const StoryCompareOperatorSchema = z.enum([
  "equals",
  "not-equals",
  "greater-than",
  "at-least",
  "less-than",
  "at-most",
]);
export type StoryCompareOperator = z.infer<typeof StoryCompareOperatorSchema>;

export const STORY_ENDING_KINDS = ["success", "failure", "neutral", "hidden", "custom"] as const;
export const StoryEndingKindSchema = z.enum(STORY_ENDING_KINDS);
export type StoryEndingKind = z.infer<typeof StoryEndingKindSchema>;

const NUMBER_ONLY_OPERATORS = new Set<StoryCompareOperator>([
  "greater-than",
  "at-least",
  "less-than",
  "at-most",
]);

export const StoryStateEffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set"),
      key: StoryStateKeySchema,
      value: z.union([z.number().finite(), z.boolean()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("add"),
      key: StoryStateKeySchema,
      amount: z.number().finite(),
    })
    .strict(),
]);
export type StoryStateEffect = z.infer<typeof StoryStateEffectSchema>;

export const StoryStateEffectsSchema = z.array(StoryStateEffectSchema).max(MAX_STORY_STATE_EFFECTS);

export type StoryCondition =
  | {
      kind: "compare";
      variableKey: StoryStateKey;
      operator: StoryCompareOperator;
      value: number | boolean;
    }
  | { kind: "all"; conditions: StoryCondition[] }
  | { kind: "any"; conditions: StoryCondition[] }
  | { kind: "not"; condition: StoryCondition };

export const StoryConditionSchema: z.ZodType<StoryCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("compare"),
        variableKey: StoryStateKeySchema,
        operator: StoryCompareOperatorSchema,
        value: z.union([z.number().finite(), z.boolean()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("all"),
        conditions: z.array(StoryConditionSchema).min(1).max(MAX_STORY_CONDITION_LEAVES),
      })
      .strict(),
    z
      .object({
        kind: z.literal("any"),
        conditions: z.array(StoryConditionSchema).min(1).max(MAX_STORY_CONDITION_LEAVES),
      })
      .strict(),
    z.object({ kind: z.literal("not"), condition: StoryConditionSchema }).strict(),
  ])
);

const StoryRouteIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "Use a stable identifier.");

export const StoryRouteTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: StoryRouteIdSchema }).strict(),
  z.object({ kind: z.literal("ending"), endingId: StoryRouteIdSchema }).strict(),
]);
export type StoryRouteTarget = z.infer<typeof StoryRouteTargetSchema>;

export const StoryExitRouteSchema = z
  .object({
    when: StoryConditionSchema.optional(),
    target: StoryRouteTargetSchema.nullable(),
  })
  .strict();
export type StoryExitRoute = z.infer<typeof StoryExitRouteSchema>;

export const StoryAutoRoutesSchema = z
  .array(StoryExitRouteSchema)
  .min(1)
  .max(MAX_STORY_EXIT_ROUTES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function storyNodeTarget(nodeId: string | null | undefined): StoryRouteTarget | null {
  return nodeId ? { kind: "node", nodeId } : null;
}

export function storyEndingTarget(endingId: string): StoryRouteTarget {
  return { kind: "ending", endingId };
}

export function storyAutoExit(nodeId: string | null = null): {
  kind: "auto";
  routes: [StoryExitRoute];
} {
  return { kind: "auto", routes: [{ target: storyNodeTarget(nodeId) }] };
}

export function storyRouteNodeId(target: StoryRouteTarget | null | undefined): string | null {
  return target?.kind === "node" ? target.nodeId : null;
}

export function storyRouteEndingId(target: StoryRouteTarget | null | undefined): string | null {
  return target?.kind === "ending" ? target.endingId : null;
}

export function storyAutoFallbackRoute(exit: {
  routes: readonly StoryExitRoute[];
}): StoryExitRoute | undefined {
  const unconditional = [...exit.routes].reverse().find((route) => route.when === undefined);
  return unconditional ?? exit.routes[exit.routes.length - 1];
}

export function storyAutoFallbackTarget(exit: {
  routes: readonly StoryExitRoute[];
}): StoryRouteTarget | null {
  return storyAutoFallbackRoute(exit)?.target ?? null;
}

export function storyAutoFallbackNodeId(exit: {
  routes: readonly StoryExitRoute[];
}): string | null {
  return storyRouteNodeId(storyAutoFallbackTarget(exit));
}

export function storyExitNodeIds(exit: {
  kind: string;
  routes?: readonly StoryExitRoute[];
  choices?: readonly { target: StoryRouteTarget | null }[];
}): string[] {
  const targets =
    exit.kind === "choice"
      ? (exit.choices ?? []).map((choice) => choice.target)
      : (exit.routes ?? []).map((route) => route.target);
  return [
    ...new Set(
      targets.flatMap((target) => {
        const nodeId = storyRouteNodeId(target);
        return nodeId ? [nodeId] : [];
      })
    ),
  ];
}

export function replaceAutoFallbackTarget(
  routes: readonly StoryExitRoute[],
  target: StoryRouteTarget | null
): StoryExitRoute[] {
  return [...routes.filter((route) => route.when), { target }];
}

export function storyConditionVariableKeys(condition: StoryCondition): string[] {
  if (condition.kind === "compare") return [condition.variableKey];
  if (condition.kind === "not") return storyConditionVariableKeys(condition.condition);
  return condition.conditions.flatMap(storyConditionVariableKeys);
}

export function measureStoryCondition(
  condition: StoryCondition,
  depth = 1
): { depth: number; leaves: number } {
  if (condition.kind === "compare") return { depth, leaves: 1 };
  if (condition.kind === "not") {
    return measureStoryCondition(condition.condition, depth + 1);
  }
  return condition.conditions.reduce(
    (acc, child) => {
      const inner = measureStoryCondition(child, depth + 1);
      return {
        depth: Math.max(acc.depth, inner.depth),
        leaves: acc.leaves + inner.leaves,
      };
    },
    { depth, leaves: 0 }
  );
}

export function storyConditionUsesOnlyKeys(
  condition: StoryCondition,
  keys: ReadonlySet<string>
): boolean {
  return storyConditionVariableKeys(condition).every((key) => keys.has(key));
}

export type StoryStateVariableLookup = ReadonlyMap<string, { valueType: StoryStateValueType }>;

export function storyConditionTypeError(
  condition: StoryCondition,
  variables: StoryStateVariableLookup
): string | null {
  if (condition.kind === "not") {
    return storyConditionTypeError(condition.condition, variables);
  }
  if (condition.kind === "all" || condition.kind === "any") {
    for (const child of condition.conditions) {
      const error = storyConditionTypeError(child, variables);
      if (error) return error;
    }
    return null;
  }
  const variable = variables.get(condition.variableKey);
  if (!variable) return `Unknown variable ${condition.variableKey}.`;
  if (NUMBER_ONLY_OPERATORS.has(condition.operator) && variable.valueType !== "number") {
    return `Operator ${condition.operator} requires a number variable.`;
  }
  if (typeof condition.value !== variable.valueType) {
    return `Comparison value must match ${variable.valueType}.`;
  }
  return null;
}

export function storyEffectTypeError(
  effect: StoryStateEffect,
  variables: StoryStateVariableLookup
): string | null {
  const variable = variables.get(effect.key);
  if (!variable) return `Unknown variable ${effect.key}.`;
  if (effect.kind === "add" && variable.valueType !== "number") {
    return `add requires a number variable.`;
  }
  if (effect.kind === "set" && typeof effect.value !== variable.valueType) {
    return `set value must match ${variable.valueType}.`;
  }
  return null;
}

export function compileStoryCondition(condition: StoryCondition): ExperienceCondition {
  if (condition.kind === "compare") {
    return {
      kind: "compare",
      left: { kind: "state", path: condition.variableKey },
      operator: condition.operator,
      right: { kind: "literal", value: condition.value },
    };
  }
  if (condition.kind === "not") {
    return { kind: "not", condition: compileStoryCondition(condition.condition) };
  }
  return {
    kind: condition.kind,
    conditions: condition.conditions.map(compileStoryCondition),
  };
}

export function compileStoryEffects(
  effects: readonly StoryStateEffect[]
): ExperienceRuntimeAction[] {
  return effects.map((effect) =>
    effect.kind === "set"
      ? {
          kind: "state.set" as const,
          path: effect.key,
          value: { kind: "literal" as const, value: effect.value },
        }
      : {
          kind: "state.increment" as const,
          path: effect.key,
          amount: { kind: "literal" as const, value: effect.amount },
        }
  );
}

export function migrateStoryInteractionAction(action: unknown): unknown {
  if (!isRecord(action) || action.kind !== "goto") return action;
  if ("target" in action) {
    const { nodeId: _legacyNodeId, ...rest } = action;
    return rest;
  }
  if (typeof action.nodeId !== "string") return action;
  const { nodeId, ...rest } = action;
  return { ...rest, target: { kind: "node", nodeId } };
}

export function migrateStoryChoice(choice: unknown): unknown {
  if (!isRecord(choice)) return choice;
  if ("target" in choice) {
    const { nextNodeId: _legacyNext, ...rest } = choice;
    return rest;
  }
  const { nextNodeId, ...rest } = choice;
  return {
    ...rest,
    target: storyNodeTarget(typeof nextNodeId === "string" ? nextNodeId : null),
  };
}

export function migrateStoryExit(exit: unknown): unknown {
  if (!isRecord(exit)) return exit;
  if (exit.kind === "auto") {
    if (Array.isArray(exit.routes)) {
      const { nextNodeId: _legacyNext, ...rest } = exit;
      return rest;
    }
    const { nextNodeId, ...rest } = exit;
    return {
      ...rest,
      routes: [
        {
          target: storyNodeTarget(typeof nextNodeId === "string" ? nextNodeId : null),
        },
      ],
    };
  }
  if (exit.kind === "choice" && Array.isArray(exit.choices)) {
    return { ...exit, choices: exit.choices.map(migrateStoryChoice) };
  }
  return exit;
}

export function migrateStoryInteraction(interaction: unknown): unknown {
  if (!isRecord(interaction) || !isRecord(interaction.outcomes)) return interaction;
  return {
    ...interaction,
    outcomes: Object.fromEntries(
      Object.entries(interaction.outcomes).map(([outcome, action]) => [
        outcome,
        migrateStoryInteractionAction(action),
      ])
    ),
  };
}

export function migrateStoryNodeStats(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const next: Record<string, unknown> = { ...node };
  if ("exit" in next) next.exit = migrateStoryExit(next.exit);
  if (Array.isArray(next.interactions)) {
    next.interactions = next.interactions.map(migrateStoryInteraction);
  }
  return next;
}

/** Drafts stored before stats used nextNodeId / goto.nodeId. */
export function migrateStoryDraftStats(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.graph) || !Array.isArray(value.graph.nodes)) {
    return value;
  }
  return {
    ...value,
    graph: {
      ...value.graph,
      nodes: value.graph.nodes.map(migrateStoryNodeStats),
    },
  };
}

/** Intermediate releases compiled before stats used nextNodeId / goto.nodeId. */
export function migrateStoryReleaseStats(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return value;
  return { ...value, nodes: value.nodes.map(migrateStoryNodeStats) };
}
