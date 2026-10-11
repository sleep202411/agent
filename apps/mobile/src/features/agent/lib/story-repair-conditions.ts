import {
  MAX_STORY_CONDITION_DEPTH,
  MAX_STORY_CONDITION_LEAVES,
  MAX_STORY_EXIT_ROUTES,
  StoryConditionSchema,
  StoryAutoRoutesSchema,
  StoryStateKeySchema,
  measureStoryCondition,
  storyConditionTypeError,
  type StoryCondition,
  type StoryExitRoute,
} from "@repo/shared/story-stats";
import type { RepairContent } from "./story-repair-fields";

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function repairVariables(content: RepairContent, locale: string) {
  const variables = object(content.storyBible)?.stateVariables;
  if (!Array.isArray(variables)) return [];
  return variables.flatMap((item) => {
    const value = object(item);
    if (
      !value ||
      !StoryStateKeySchema.safeParse(value.key).success ||
      (value.valueType !== "number" && value.valueType !== "boolean")
    )
      return [];
    const name = object(value.name)?.[locale];
    return [
      {
        key: value.key as string,
        valueType: value.valueType as "number" | "boolean",
        label: typeof name === "string" && name ? name : (value.key as string),
      },
    ];
  });
}

export function validateRepairCondition(content: RepairContent, value: unknown): StoryCondition {
  const condition = StoryConditionSchema.parse(value);
  const size = measureStoryCondition(condition);
  if (size.depth > MAX_STORY_CONDITION_DEPTH || size.leaves > MAX_STORY_CONDITION_LEAVES)
    throw Error("A condition supports at most three levels and twelve comparisons.");
  const error = storyConditionTypeError(
    condition,
    new Map(repairVariables(content, "en-US").map((v) => [v.key, v]))
  );
  if (error) throw Error(error);
  return condition;
}

export type RepairFlatCondition = {
  combinator: "all" | "any";
  negated: boolean;
  compares: Extract<StoryCondition, { kind: "compare" }>[];
};

/** Same editable forms as Web. Mixed nested expressions remain intact. */
export function flattenRepairCondition(value: unknown): RepairFlatCondition | null {
  if (value == null) return { combinator: "all", negated: false, compares: [] };
  const parsed = StoryConditionSchema.safeParse(value);
  if (!parsed.success) return null;
  let condition = parsed.data;
  const negated = condition.kind === "not";
  if (condition.kind === "not") condition = condition.condition;
  if (condition.kind === "compare") return { combinator: "all", negated, compares: [condition] };
  if (
    (condition.kind === "all" || condition.kind === "any") &&
    condition.conditions.every((c) => c.kind === "compare")
  )
    return {
      combinator: condition.kind,
      negated,
      compares: condition.conditions as RepairFlatCondition["compares"],
    };
  return null;
}

export function buildRepairCondition(
  content: RepairContent,
  draft: RepairFlatCondition
): StoryCondition | undefined {
  if (!draft.compares.length) return undefined;
  const core: StoryCondition =
    draft.compares.length === 1
      ? draft.compares[0]
      : { kind: draft.combinator, conditions: draft.compares };
  return validateRepairCondition(content, draft.negated ? { kind: "not", condition: core } : core);
}

export function replaceChoiceCondition(
  content: RepairContent,
  nodeId: string,
  choiceId: string,
  value: unknown
): RepairContent {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  const exit = object(node?.exit);
  if (!node || exit?.kind !== "choice" || !Array.isArray(exit.choices))
    throw Error("The selected decision is no longer available.");
  if (!exit.choices.some((c) => object(c)?.choiceId === choiceId))
    throw Error("The selected choice is no longer available.");
  const condition = value == null ? undefined : validateRepairCondition(content, value);
  const choices = exit.choices.map((row) => {
    const choice = object(row)!;
    if (choice.choiceId !== choiceId) return row;
    const next = { ...choice };
    if (condition) next.visibleWhen = condition;
    else delete next.visibleWhen;
    return next;
  });
  return replaceExit(content, nodeId, { ...exit, choices });
}

export function replaceRepairAutoRoutes(
  content: RepairContent,
  nodeId: string,
  value: unknown
): RepairContent {
  const node = content.graph.nodes.find((n) => n.nodeId === nodeId);
  if (!node || object(node.exit)?.kind !== "auto")
    throw Error("The selected automatic exit is no longer available.");
  const routes = StoryAutoRoutesSchema.parse(value);
  if (
    routes.length > MAX_STORY_EXIT_ROUTES ||
    routes.slice(0, -1).some((r) => !r.when) ||
    routes.at(-1)?.when
  )
    throw Error("Conditional routes must precede one unconditional fallback.");
  const endings = object(content.storyBible)?.endings;
  for (const route of routes) {
    if (route.when) validateRepairCondition(content, route.when);
    const target = route.target;
    if (target?.kind === "node" && !content.graph.nodes.some((n) => n.nodeId === target.nodeId))
      throw Error("The selected destination is no longer available.");
    if (
      target?.kind === "ending" &&
      (!Array.isArray(endings) ||
        !endings.some((ending) => object(ending)?.endingId === target.endingId))
    )
      throw Error("The selected ending is no longer available.");
  }
  return replaceExit(content, nodeId, { ...object(node.exit), routes });
}

export function moveRepairAutoRoute(
  routes: StoryExitRoute[],
  from: number,
  to: number
): StoryExitRoute[] {
  // The unconditional fallback stays last, as in the official Web editor.
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= routes.length - 1 ||
    to >= routes.length - 1
  )
    return routes;
  const next = [...routes];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

function replaceExit(
  content: RepairContent,
  nodeId: string,
  exit: Record<string, unknown>
): RepairContent {
  return {
    ...content,
    graph: {
      ...content.graph,
      nodes: content.graph.nodes.map((node) => (node.nodeId === nodeId ? { ...node, exit } : node)),
    },
  };
}

export function repairAutoRoutes(content: RepairContent, nodeId: string): StoryExitRoute[] | null {
  const exit = object(content.graph.nodes.find((node) => node.nodeId === nodeId)?.exit);
  if (exit?.kind !== "auto") return null;
  const parsed = StoryAutoRoutesSchema.safeParse(exit.routes);
  return parsed.success ? parsed.data : null;
}

export function addRepairAutoRoute(content: RepairContent, nodeId: string): RepairContent {
  const routes = repairAutoRoutes(content, nodeId);
  const variable = repairVariables(content, "en-US")[0];
  if (!routes || !variable)
    throw Error("A conditional route requires an available state variable.");
  if (routes.length >= MAX_STORY_EXIT_ROUTES)
    throw Error("An automatic exit supports at most eight routes.");
  const when: StoryCondition = {
    kind: "compare",
    variableKey: variable.key,
    operator: variable.valueType === "boolean" ? "equals" : "at-least",
    value: variable.valueType === "boolean" ? true : 0,
  };
  return replaceRepairAutoRoutes(content, nodeId, [
    ...routes.slice(0, -1),
    { when, target: null },
    routes[routes.length - 1],
  ]);
}

/** Reject a stale editor instead of applying its condition to a reordered route. */
export function replaceRepairAutoCondition(
  content: RepairContent,
  nodeId: string,
  index: number,
  expected: StoryExitRoute,
  when: StoryCondition | undefined
): RepairContent {
  const routes = repairAutoRoutes(content, nodeId);
  if (
    !routes ||
    index < 0 ||
    index >= routes.length - 1 ||
    JSON.stringify(routes[index]) !== JSON.stringify(expected)
  )
    throw Error("The selected route changed. Reopen its condition before editing.");
  return replaceRepairAutoRoutes(
    content,
    nodeId,
    when
      ? routes.map((route, at) => (at === index ? { ...route, when } : route))
      : routes.filter((_, at) => at !== index)
  );
}
