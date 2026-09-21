import { z } from "zod";
import { findUnprojectableChecks } from "./zod-json-schema-fidelity.js";
import {
  StoryAssetPlanSchema,
  StoryProductionPlanSchema,
  StoryStoryboardPlanSchema,
} from "./story-production.js";
import {
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_NOTE_LENGTH,
  StoryConditionSchema,
  StoryStateEffectSchema,
  StoryStateEffectsSchema,
  StoryStateKeySchema,
  type StoryCondition,
} from "./story-stats.js";

export const STORY_PATCH_SCHEMA_VERSION = "story-patch-v1" as const;

/** The only mutable Story draft shape these operations are allowed to target. */
export const STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION = "interactive-story-draft-v1" as const;

export const STORY_AGENT_MAX_PROPOSAL_OPERATIONS = 100;

/**
 * Runtime guardrails applied before any recursive Zod schema sees an Agent
 * proposal. These are contract limits, not implementation hints: every
 * untrusted entry point must reject payloads outside them.
 */
export const STORY_PATCH_COMPLEXITY_LIMITS = {
  serializedBytes: 512 * 1024,
  nestingDepth: 64,
  containers: 2_500,
  arrayItems: 5_000,
} as const;

/** Full chapter proposals contain every scene and shot, unlike localized patches. */
export const STORY_AUTHORING_COMPLEXITY_LIMITS = {
  serializedBytes: 4 * 1024 * 1024,
  nestingDepth: 64,
  containers: 25_000,
  arrayItems: 50_000,
} as const;

export interface StoryPatchComplexityStats {
  serializedBytes: number;
  nestingDepth: number;
  containers: number;
  arrayItems: number;
}

type StoryPatchComplexityMetric = keyof StoryPatchComplexityStats;

/** Structured, transport-safe failure raised by the iterative preflight. */
export class StoryPatchPreflightError extends Error {
  readonly code: "STORY_PATCH_INPUT_TOO_COMPLEX" | "STORY_PATCH_INPUT_NOT_JSON";
  readonly path: string;
  readonly metric: StoryPatchComplexityMetric | null;
  readonly actual: number | null;
  readonly maximum: number | null;

  constructor(input: {
    code: StoryPatchPreflightError["code"];
    message: string;
    path: string;
    metric?: StoryPatchComplexityMetric;
    actual?: number;
    maximum?: number;
  }) {
    super(input.message);
    this.name = "StoryPatchPreflightError";
    this.code = input.code;
    this.path = input.path;
    this.metric = input.metric ?? null;
    this.actual = input.actual ?? null;
    this.maximum = input.maximum ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      path: this.path,
      metric: this.metric,
      actual: this.actual,
      maximum: this.maximum,
    };
  }
}

/**
 * Inspect an arbitrary value without recursion. Besides bounding CPU/memory,
 * this guarantees a deeply nested hostile payload is rejected before Zod,
 * JSON.stringify, canonicalization, or the patch executor can overflow the
 * JavaScript call stack.
 */
export function assertStoryPatchComplexity(value: unknown): StoryPatchComplexityStats {
  return assertStoryJsonComplexity(value, STORY_PATCH_COMPLEXITY_LIMITS);
}

/** Bound typed chapter proposals before parsing; patches retain their smaller budget. */
export function assertStoryProposalComplexity(value: unknown): StoryPatchComplexityStats {
  const version =
    value !== null && typeof value === "object" && "schemaVersion" in value
      ? value.schemaVersion
      : undefined;
  const isAuthoring =
    version === STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION ||
    version === STORY_PLOT_PROPOSAL_SCHEMA_VERSION ||
    version === STORY_ASSET_PROPOSAL_SCHEMA_VERSION ||
    version === STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION;
  return assertStoryJsonComplexity(
    value,
    isAuthoring ? STORY_AUTHORING_COMPLEXITY_LIMITS : STORY_PATCH_COMPLEXITY_LIMITS
  );
}

function assertStoryJsonComplexity(
  value: unknown,
  limits: Readonly<StoryPatchComplexityStats>
): StoryPatchComplexityStats {
  const stats: StoryPatchComplexityStats = {
    serializedBytes: 0,
    nestingDepth: 0,
    containers: 0,
    arrayItems: 0,
  };
  const seen = new WeakSet<object>();
  const stack: Array<{
    value: unknown;
    path: string;
    depth: number;
  }> = [{ value, path: "$", depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    stats.nestingDepth = Math.max(stats.nestingDepth, current.depth);
    assertComplexityLimit("nestingDepth", stats.nestingDepth, current.path, limits);

    if (current.value === null) {
      addSerializedBytes(stats, 4, current.path, limits);
      continue;
    }
    if (typeof current.value === "string") {
      addSerializedBytes(stats, jsonStringBytes(current.value), current.path, limits);
      continue;
    }
    if (typeof current.value === "boolean") {
      addSerializedBytes(stats, current.value ? 4 : 5, current.path, limits);
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw invalidJson(current.path, "Numbers must be finite.");
      }
      addSerializedBytes(
        stats,
        jsonStringBytes(Object.is(current.value, -0) ? 0 : current.value),
        current.path,
        limits
      );
      continue;
    }
    if (typeof current.value !== "object") {
      throw invalidJson(current.path, `Unsupported JSON value type: ${typeof current.value}.`);
    }
    if (seen.has(current.value)) {
      throw invalidJson(current.path, "Circular references are not allowed.");
    }
    seen.add(current.value);
    stats.containers += 1;
    assertComplexityLimit("containers", stats.containers, current.path, limits);

    if (Array.isArray(current.value)) {
      stats.arrayItems += current.value.length;
      assertComplexityLimit("arrayItems", stats.arrayItems, current.path, limits);
      addSerializedBytes(stats, 2 + Math.max(0, current.value.length - 1), current.path, limits);
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }

    const prototype = Reflect.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidJson(current.path, "Only plain JSON objects are allowed.");
    }
    const record = current.value as Record<string, unknown>;
    const keys = Object.keys(record);
    addSerializedBytes(stats, 2 + Math.max(0, keys.length - 1), current.path, limits);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const child = record[key];
      if (child === undefined) {
        throw invalidJson(`${current.path}.${key}`, "Undefined values are not allowed.");
      }
      addSerializedBytes(stats, jsonStringBytes(key) + 1, current.path, limits);
      stack.push({
        value: child,
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }

  return stats;
}

function addStoryPatchPreflightIssue(value: unknown, context: z.RefinementCtx): void {
  try {
    assertStoryPatchComplexity(value);
  } catch (error) {
    if (!(error instanceof StoryPatchPreflightError)) throw error;
    context.addIssue({
      code: "custom",
      message: JSON.stringify(error.toJSON()),
      path: [],
    });
  }
}

function assertComplexityLimit(
  metric: StoryPatchComplexityMetric,
  actual: number,
  path: string,
  limits: Readonly<StoryPatchComplexityStats>
): void {
  const maximum = limits[metric];
  if (actual <= maximum) return;
  throw new StoryPatchPreflightError({
    code: "STORY_PATCH_INPUT_TOO_COMPLEX",
    message: `Story patch ${metric} exceeds the product limit (${actual} > ${maximum}).`,
    path,
    metric,
    actual,
    maximum,
  });
}

function addSerializedBytes(
  stats: StoryPatchComplexityStats,
  bytes: number,
  path: string,
  limits: Readonly<StoryPatchComplexityStats>
): void {
  stats.serializedBytes += bytes;
  assertComplexityLimit("serializedBytes", stats.serializedBytes, path, limits);
}

function jsonStringBytes(value: string | number): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw invalidJson("$", "Value cannot be represented as JSON.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function invalidJson(path: string, detail: string): StoryPatchPreflightError {
  return new StoryPatchPreflightError({
    code: "STORY_PATCH_INPUT_NOT_JSON",
    message: `Story patch input is not canonical JSON: ${detail}`,
    path,
  });
}

const StoryAgentUuidSchema = z.uuid();
const StoryAgentActorIdSchema = z.string().trim().min(1).max(128);
const StoryAgentTimestampSchema = z.iso.datetime({ offset: true });
export const StoryAgentStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "Use a stable identifier.");
export const StoryAgentClipKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_-]*$/, "Use an uppercase stable clip key.");
/**
 * A localized-text map key. Never trimmed, deliberately.
 *
 * These are object KEYS, and `.trim()` on a key schema rewrites the data: zod
 * returns the trimmed key, so `{" en-US": a, "en-US": b}` parses to a single
 * `en-US` entry and one of the two translations is gone. It also put the two
 * validation gates of the capability path in disagreement — the JSON Schema
 * projected for the model checks the raw key (a length bound JSON Schema can
 * express) while zod checked the trimmed one, so `" a"` passed the manifest and
 * was rejected by the executor. A raw length bound is the same rule on both
 * sides and rewrites nothing.
 */
const StoryAgentLocaleSchema = z.string().min(2).max(16);

/** Mutable-draft localized text may be empty while the creator is authoring. */
export const StoryAgentLocalizedTextSchema = z.record(
  StoryAgentLocaleSchema,
  z.string().max(4_000)
);

// Agent patch payloads write the canonical Story document. Re-export the
// canonical state contracts instead of maintaining a second copy that can
// drift from runtime and server validation.
export const StoryAgentStateKeySchema = StoryStateKeySchema;
export const StoryAgentStateEffectSchema = StoryStateEffectSchema;
export const StoryAgentStateEffectsSchema = StoryStateEffectsSchema;
export type StoryAgentCondition = StoryCondition;
export const StoryAgentConditionSchema = StoryConditionSchema;

const StoryAgentStateVariableBaseShape = {
  key: StoryAgentStateKeySchema,
  name: StoryAgentLocalizedTextSchema,
  note: z.string().max(MAX_STORY_STATE_NOTE_LENGTH).optional(),
} as const;

export const StoryAgentStateVariableSchema = z.union([
  z
    .object({
      ...StoryAgentStateVariableBaseShape,
      valueType: z.literal("number"),
      initialValue: z.number().finite(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentStateVariableBaseShape,
      valueType: z.literal("boolean"),
      initialValue: z.boolean(),
    })
    .strict(),
]);
export type StoryAgentStateVariable = z.infer<typeof StoryAgentStateVariableSchema>;
export const StoryAgentCharacterSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    name: StoryAgentLocalizedTextSchema,
    summary: z.string().max(4_000),
  })
  .strict();
export type StoryAgentCharacter = z.infer<typeof StoryAgentCharacterSchema>;

const StoryAgentGraphChoiceBaseShape = {
  choiceId: StoryAgentStableIdSchema,
  label: StoryAgentLocalizedTextSchema,
  effects: StoryAgentStateEffectsSchema.optional(),
  visibleWhen: StoryAgentConditionSchema.optional(),
} as const;

export const StoryAgentRouteTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), nodeId: StoryAgentStableIdSchema }).strict(),
  z.object({ kind: z.literal("ending"), endingId: StoryAgentStableIdSchema }).strict(),
]);

export const StoryAgentAutoRoutesSchema = z
  .array(
    z
      .object({
        when: StoryAgentConditionSchema.optional(),
        target: StoryAgentRouteTargetSchema.nullable(),
      })
      .strict()
  )
  .min(1)
  .max(MAX_STORY_EXIT_ROUTES);

export const StoryAgentGraphChoiceSchema = z.union([
  z
    .object({
      ...StoryAgentGraphChoiceBaseShape,
      /** Null marks a choice the canvas has not connected to a target yet. */
      target: StoryAgentRouteTargetSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentGraphChoiceBaseShape,
      /** Accepted for the screenplay compiler until it emits canonical targets. */
      nextNodeId: StoryAgentStableIdSchema.nullable(),
    })
    .strict(),
]);
export type StoryAgentGraphChoice = z.infer<typeof StoryAgentGraphChoiceSchema>;

export const StoryAgentInteractionActionSchema = z.union([
  z
    .object({
      kind: z.literal("continue"),
      effects: StoryAgentStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("seek"),
      timeMs: z.number().int().min(0),
      effects: StoryAgentStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goto"),
      target: StoryAgentRouteTargetSchema,
      effects: StoryAgentStateEffectsSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goto"),
      nodeId: StoryAgentStableIdSchema,
      effects: StoryAgentStateEffectsSchema.optional(),
    })
    .strict(),
]);
export type StoryAgentInteractionAction = z.infer<typeof StoryAgentInteractionActionSchema>;

export const StoryAgentInteractionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap") }).strict(),
  z
    .object({
      kind: z.literal("swipe"),
      direction: z.enum(["up", "down", "left", "right"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("press-hold"),
      durationMs: z.number().int().min(300).max(10_000),
      /**
       * Timeline-control charge: the clip pauses while the input window is
       * open and only advances while the pointer is held, so playback
       * position is the charge progress. Mirrors the draft/runtime schemas.
       */
      controlTimeline: z.boolean().default(false),
    })
    .strict(),
]);

export const StoryAgentInteractionOutcomesSchema = z
  .object({
    success: StoryAgentInteractionActionSchema,
    failure: StoryAgentInteractionActionSchema.optional(),
    timeout: StoryAgentInteractionActionSchema.optional(),
  })
  .strict();

export const StoryAgentHotspotInteractionSchema = z
  .object({
    kind: z.literal("hotspot"),
    interactionId: StoryAgentStableIdSchema,
    label: StoryAgentLocalizedTextSchema,
    trigger: StoryAgentInteractionTriggerSchema,
    rect: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0.001).max(1),
        height: z.number().min(0.001).max(1),
      })
      .strict(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    /**
     * Safe branch frame: a resolved interaction keeps playing the current
     * clip until this timestamp before the branch cut lands. Mirrors the
     * draft/runtime schemas; defaults to the window end when omitted.
     */
    branchAtMs: z.number().int().min(1).optional(),
    outcomes: StoryAgentInteractionOutcomesSchema,
  })
  .strict();
export type StoryAgentHotspotInteraction = z.infer<typeof StoryAgentHotspotInteractionSchema>;

/**
 * A clip node's editorial labels.
 *
 * Declared rather than inlined so the projection-fidelity guard can name them:
 * Name trimming is acknowledged in STORY_PATCH_PROJECTION_GAPS. Description
 * preserves source whitespace and has no normalization step.
 */
const StoryAgentNodeNameSchema = z.string().trim().max(120);
const StoryAgentNodeDescriptionSchema = z.string().max(4_000);

export const StoryAgentGraphNodeSchema = z
  .object({
    kind: z.literal("clip"),
    nodeId: StoryAgentStableIdSchema,
    communityPointPrice: z.number().int().min(0).max(2_147_483_647).optional(),
    clipKey: StoryAgentClipKeySchema,
    name: StoryAgentNodeNameSchema.optional(),
    description: StoryAgentNodeDescriptionSchema.optional(),
    interactions: z.array(StoryAgentHotspotInteractionSchema).max(100).default([]),
    onEnterEffects: StoryAgentStateEffectsSchema.optional(),
    exit: z.union([
      z.object({ kind: z.literal("auto"), routes: StoryAgentAutoRoutesSchema }).strict(),
      z
        .object({ kind: z.literal("auto"), nextNodeId: StoryAgentStableIdSchema.nullable() })
        .strict(),
      z
        .object({
          kind: z.literal("choice"),
          decisionId: StoryAgentStableIdSchema,
          prompt: StoryAgentLocalizedTextSchema,
          choices: z.array(StoryAgentGraphChoiceSchema).max(6),
        })
        .strict(),
    ]),
  })
  .strict();
export type StoryAgentGraphNode = z.infer<typeof StoryAgentGraphNodeSchema>;

/**
 * Bookkeeping every operation carries and no author writes.
 *
 * `operationId` addresses execution errors and de-duplicates a proposal;
 * `summary` labels the operation in undo bookkeeping. Neither is a narrative
 * decision, so neither is asked of a model: on the agent capability path the
 * server fills both before the input is validated, hashed, or persisted
 * (see STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS), and the deterministic
 * authoring pipeline fills both in code.
 */
const StoryAgentOperationBaseShape = {
  operationId: StoryAgentUuidSchema,
  // The `\S` check is redundant for zod — a trimmed string of length >= 1
  // always holds a non-whitespace character — and load-bearing for the
  // projection: `minLength: 1` alone let the manifest accept `"   "`, which zod
  // then rejected after trimming. A projected pattern says the same thing about
  // the raw string, so both gates agree.
  summary: z.string().trim().min(1).max(500).regex(/\S/, "Write a non-empty label."),
} as const;

const StoryAgentPutIntentSchema = z.enum(["create", "replace"]);

const STORY_AGENT_OVERVIEW_FIELDS = ["logline", "synopsis"] as const;

const StoryAgentOverviewPayloadSchema = z
  .object({
    logline: z.string().max(1_000).optional(),
    synopsis: z.string().max(20_000).optional(),
  })
  .strict()
  .refine(
    (payload) => STORY_AGENT_OVERVIEW_FIELDS.some((field) => payload[field] !== undefined),
    "At least one story-bible overview field is required."
  )
  // `.refine` predicates are invisible to `z.toJSONSchema`, so the projection
  // handed to the model would silently lose this rule. Metadata is zod's own
  // escape hatch for JSON-Schema keywords it cannot infer. The object is
  // closed and every property optional, so "at least one key" and "at least
  // one of the two is set" describe the same JSON — a wire payload cannot
  // carry `undefined`.
  .meta({ minProperties: 1 });

/**
 * Explicit domain commands proposed by the Story Agent.
 *
 * These are intentionally not JSON Patch. Each command names a domain action
 * and carries an interactive-story-v1-compatible payload. Application code must execute commands
 * sequentially against `baseDraftRevision`, then validate the complete result
 * with the authoritative unified story schema before CAS commit.
 */
export const StoryPatchOperationShapeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.update_overview"),
      payload: StoryAgentOverviewPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.put_character"),
      payload: z
        .object({
          intent: StoryAgentPutIntentSchema,
          character: StoryAgentCharacterSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.remove_character"),
      payload: z.object({ characterId: StoryAgentStableIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.put_state_variable"),
      payload: z
        .object({
          intent: StoryAgentPutIntentSchema,
          variable: StoryAgentStateVariableSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.remove_state_variable"),
      payload: z.object({ key: StoryAgentStateKeySchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_graph.set_entry_node"),
      payload: z.object({ nodeId: StoryAgentStableIdSchema.nullable() }).strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_graph.put_node"),
      payload: z
        .object({
          intent: StoryAgentPutIntentSchema,
          node: StoryAgentGraphNodeSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_graph.remove_node"),
      payload: z.object({ nodeId: StoryAgentStableIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_graph.reorder_nodes"),
      payload: z
        .object({
          nodeIds: z.array(StoryAgentStableIdSchema).max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("production.replace_notes"),
      payload: z
        .object({
          productionNotes: z.array(z.string().max(2_000)).max(200),
        })
        .strict(),
    })
    .strict(),
]);

/**
 * The complexity preflight, declared once so both parsers share one instance.
 *
 * Its `superRefine` is a check the JSON Schema projection cannot carry (see
 * STORY_PATCH_PROJECTION_GAPS); naming the schema is what lets that gap be
 * acknowledged by identity instead of by a path that moves.
 */
const StoryPatchPreflightSchema = z.unknown().superRefine(addStoryPatchPreflightIssue);

export const StoryPatchOperationSchema = StoryPatchPreflightSchema.pipe(
  StoryPatchOperationShapeSchema
);
export type StoryPatchOperation = z.infer<typeof StoryPatchOperationSchema>;

/**
 * Every legal `kind`, DERIVED from the union above rather than restated.
 *
 * Read the discriminator off the schema that actually validates: a hand-copied
 * list drifts the moment an eleventh operation lands, and drift here is what
 * previously left the generated capability manifest describing operations as
 * `items: { type: "object" }` while the server rejected every call with
 * `operations.N.kind Invalid input`.
 */
export const STORY_PATCH_OPERATION_KINDS = StoryPatchOperationShapeSchema.options.map(
  (option) => option.shape.kind.value
) as readonly StoryPatchOperation["kind"][];

/**
 * Server-side label for each operation, keyed by the union's own discriminator
 * so an eleventh operation fails the build instead of shipping unlabelled.
 *
 * This is what fills the machine `summary` on the capability path. Operation
 * summaries are bookkeeping — undo runs prefix them, nothing renders them — so
 * they are derived from the command, never requested from a model.
 */
export const STORY_PATCH_OPERATION_LABELS: Record<StoryPatchOperation["kind"], string> = {
  "story_bible.update_overview": "Update the story overview.",
  "story_bible.put_character": "Write a story-bible character.",
  "story_bible.remove_character": "Remove a story-bible character.",
  "story_bible.put_state_variable": "Write a Story state variable.",
  "story_bible.remove_state_variable": "Remove a Story state variable.",
  "story_graph.set_entry_node": "Set the chapter entry node.",
  "story_graph.put_node": "Write a story graph node.",
  "story_graph.remove_node": "Remove a story graph node.",
  "story_graph.reorder_nodes": "Reorder the chapter nodes.",
  "production.replace_notes": "Replace the production notes.",
};

/** Safe parser for an entire operation list, including aggregate limits. */
export const StoryPatchOperationsSchema = StoryPatchPreflightSchema.pipe(
  z.array(StoryPatchOperationShapeSchema).min(1).max(STORY_AGENT_MAX_PROPOSAL_OPERATIONS)
);

/**
 * The authoritative shape of a `story.canvas.apply_patch` capability input.
 *
 * It lives beside the operation union because the capability manifest is
 * PROJECTED from it (`storyPatchActionInputJsonSchema`) and the server executor
 * PARSES with it. One declaration, two readings — so the manifest cannot
 * describe a different SHAPE from the one the executor enforces.
 *
 * Shape is not the whole contract. A zod check has no JSON Schema counterpart
 * unless the projection can render it, and one that cannot is dropped in
 * silence. `assertStoryPatchProjectionFidelity` is what keeps that from being
 * invisible: see STORY_PATCH_PROJECTION_GAPS for the checks this schema carries
 * that the manifest does not, and the argument for each.
 */
export const StoryPatchActionInputSchema = z
  .object({
    projectId: z.uuid(),
    chapterId: z.uuid(),
    baseDraftRevision: z.number().int().nonnegative(),
    baseLayoutRevision: z.number().int().nonnegative(),
    operations: StoryPatchOperationsSchema,
  })
  .strict();

/**
 * Fields the server owns on the action envelope, mapped to how the projection
 * explains them.
 *
 * Both are read off the run's immutable authorized scope, so the model has zero
 * degrees of freedom over them and a transcription slip used to be a hard 409.
 */
export const STORY_PATCH_SERVER_SUPPLIED_ACTION_FIELDS = {
  projectId:
    "Server-supplied from the authorized thread scope. Omit it — any value sent is replaced.",
  chapterId:
    "Server-supplied from the authorized thread scope. Omit it — any value sent is replaced.",
} as const;
export type StoryPatchServerSuppliedActionField =
  keyof typeof STORY_PATCH_SERVER_SUPPLIED_ACTION_FIELDS;

/** Fields the server owns on every operation. See StoryAgentOperationBaseShape. */
export const STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS = {
  operationId: "Server-generated bookkeeping id. Omit it — any value sent is replaced.",
  summary: "Server-generated operation label. Omit it — any value sent is replaced.",
} as const;
export type StoryPatchServerSuppliedOperationField =
  keyof typeof STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS;

export interface StoryPatchProjectionGap {
  /**
   * The schema instance carrying the check.
   *
   * Keyed by identity, not by path: a shared schema is analysed once, and
   * inserting a union arm does not invalidate anyone else's acknowledgement.
   * It also means a NEW `.refine()` or `.trim()` is never covered by an
   * existing entry — zod clones on every modifier, so the modified schema is a
   * different instance and lands unacknowledged.
   *
   * Typed as the bare identity it is used as, matching `UnprojectableCheck.schema`
   * — the walker's finding is what an entry is compared against, and nothing
   * here ever parses with it. Declaring `z.ZodType` promised a capability this
   * contract does not use and forced a cast on every caller holding the walker's
   * own output.
   */
  schema: object;
  /** zod's own name for the check: `custom` for `.refine`, `overwrite` for `.trim`. */
  check: string;
  /** Why a model may be told a payload is acceptable without this rule. */
  reason: string;
}

/**
 * Every zod check in `StoryPatchActionInputSchema` that the JSON Schema
 * projection cannot carry, with the argument for why the gap is safe.
 *
 * A gap is safe only in one direction. If the manifest is STRICTER than zod, a
 * payload the model believes is legal is legal; the model is never surprised.
 * If the manifest is LOOSER, the model is told a payload is acceptable and the
 * executor then refuses it, with no way for the model to learn the rule from
 * the document it was given. Every entry below has to argue the first case.
 *
 * `assertStoryPatchProjectionFidelity` refuses to project a schema carrying an
 * unprojectable check that is not listed here, and refuses to keep an entry
 * whose check no longer exists. Adding a refinement therefore fails the
 * `@repo/shared` build until someone either expresses the rule in JSON Schema
 * (zod's `.meta()` is the escape hatch — see StoryAgentOverviewPayloadSchema)
 * or writes down why the model can live without it.
 */
export const STORY_PATCH_PROJECTION_GAPS: readonly StoryPatchProjectionGap[] = [
  {
    schema: StoryPatchPreflightSchema,
    check: "custom",
    reason:
      "STORY_PATCH_COMPLEXITY_LIMITS — serialized size, container counts and depth. " +
      "JSON Schema has no vocabulary for them, so they stay a server-side gate. " +
      "An oversized patch comes back as a correctable failed action carrying the " +
      "offending path, not a lost turn, which is the only reason this looseness is " +
      "tolerable at all.",
  },
  {
    schema: StoryAgentOverviewPayloadSchema,
    check: "custom",
    reason:
      "'at least one overview field' is re-expressed for the model as " +
      "`.meta({ minProperties: 1 })`. The object is closed and every property " +
      "optional, so minProperties says exactly the same thing about the wire " +
      "payload — the manifest is not looser here, only stated differently.",
  },
  {
    schema: StoryAgentOperationBaseShape.summary,
    check: "overwrite",
    reason:
      "`.trim()` before min(1). The projected `\\S` pattern rejects an " +
      "all-whitespace label on the RAW string, so nothing the manifest accepts can " +
      "trim into a value zod rejects. Without that pattern this was a live defect: " +
      "`minLength: 1` accepted '   '.",
  },
  {
    schema: StoryAgentStableIdSchema,
    check: "overwrite",
    reason:
      "`.trim()` before an identifier pattern. The pattern is projected and " +
      "anchored, so the manifest rejects every string with surrounding whitespace " +
      "— strictly stricter than zod, which would have trimmed it and accepted.",
  },
  {
    schema: StoryAgentClipKeySchema,
    check: "overwrite",
    reason:
      "`.trim()` before an uppercase-key pattern. Same anchored-pattern argument " +
      "as StoryAgentStableIdSchema: the manifest is the stricter of the two.",
  },
  {
    schema: StoryAgentNodeNameSchema,
    check: "overwrite",
    reason:
      "`.trim()` before max(120) only. Trimming can never lengthen a string, so " +
      "every value the manifest's maxLength admits still satisfies zod.",
  },
];

/**
 * Fails when the zod schema carries a rule the projection silently drops.
 *
 * `z.toJSONSchema({ unrepresentable: "throw" })` already refuses a zod TYPE it
 * cannot render. It is silent about a CHECK, and a dropped check is the drift
 * that hurts: the model is handed a document saying its payload is acceptable
 * and the executor — parsing with the very schema the document came from —
 * refuses it. This closes that hole by requiring every unprojectable check to
 * be acknowledged in STORY_PATCH_PROJECTION_GAPS, and by rejecting an
 * acknowledgement that no longer corresponds to a real check.
 *
 * Parameterised so a test can drive it with a schema that has drifted.
 */
export function assertStoryPatchProjectionFidelity(
  schema: z.ZodType = StoryPatchActionInputSchema,
  gaps: readonly StoryPatchProjectionGap[] = STORY_PATCH_PROJECTION_GAPS
): void {
  // Two things that look alike and must not be conflated:
  //   - the SAME schema reused at twenty paths is one thing to acknowledge;
  //   - the same schema carrying a SECOND check of the same kind is a new gap.
  // So findings are folded by schema identity first (a shared schema reports
  // identically at every path it appears), and only then counted per kind. A
  // set would have let a schema whose single `.refine` was already accounted
  // for quietly grow another — the divergence this guard exists to catch.
  // The walker emits one finding per individual check, at every path the schema
  // is reachable from. Within ONE path a repeated kind means the schema really
  // carries two of them; ACROSS paths it is the same schema seen again. Taking
  // the max over paths recovers the true per-schema count, so a shared schema
  // still needs one acknowledgement while a second `.refine()` needs another.
  const bySchema = new Map<object, Map<string, Map<string, number>>>();
  const firstPath = new Map<object, Map<string, string>>();
  for (const found of findUnprojectableChecks(schema)) {
    const paths = bySchema.get(found.schema) ?? new Map<string, Map<string, number>>();
    const kinds = paths.get(found.path) ?? new Map<string, number>();
    kinds.set(found.check, (kinds.get(found.check) ?? 0) + 1);
    paths.set(found.path, kinds);
    bySchema.set(found.schema, paths);

    const seen = firstPath.get(found.schema) ?? new Map<string, string>();
    if (!seen.has(found.check)) seen.set(found.check, found.path);
    firstPath.set(found.schema, seen);
  }

  const carried = new Map<object, Map<string, number>>();
  for (const [schemaRef, paths] of bySchema) {
    const perKind = new Map<string, number>();
    for (const kinds of paths.values()) {
      for (const [check, count] of kinds) {
        perKind.set(check, Math.max(perKind.get(check) ?? 0, count));
      }
    }
    carried.set(schemaRef, perKind);
  }

  const acknowledged = new Map<object, Map<string, number>>();
  for (const gap of gaps) {
    const perKind = acknowledged.get(gap.schema) ?? new Map<string, number>();
    perKind.set(gap.check, (perKind.get(gap.check) ?? 0) + 1);
    acknowledged.set(gap.schema, perKind);
  }

  const unacknowledged: string[] = [];
  for (const [schemaRef, perKind] of carried) {
    for (const [check, count] of perKind) {
      const covered = acknowledged.get(schemaRef)?.get(check) ?? 0;
      for (let i = covered; i < count; i += 1) {
        unacknowledged.push(`${firstPath.get(schemaRef)?.get(check) ?? "$"} (${check})`);
      }
    }
  }
  if (unacknowledged.length > 0) {
    throw new Error(
      `The story patch JSON Schema projection cannot express ${unacknowledged.length} zod ` +
        `check(s) that nothing has accounted for: ${unacknowledged.join(", ")}. ` +
        `A model handed this projection would be told such a payload is acceptable and ` +
        `then refused by the executor. Either express the rule in JSON Schema (zod's ` +
        `.meta() — see StoryAgentOverviewPayloadSchema) or add it to ` +
        `STORY_PATCH_PROJECTION_GAPS with the argument for why the manifest stays the ` +
        `stricter of the two gates.`
    );
  }

  // An acknowledgement the schema no longer carries. Counted the same way, so
  // deleting one of two refinements leaves exactly one entry stale.
  const spent = new Map<object, Map<string, number>>();
  const stale: string[] = [];
  for (const [index, gap] of gaps.entries()) {
    const perKind = spent.get(gap.schema) ?? new Map<string, number>();
    const used = (perKind.get(gap.check) ?? 0) + 1;
    perKind.set(gap.check, used);
    spent.set(gap.schema, perKind);
    if (used > (carried.get(gap.schema)?.get(gap.check) ?? 0)) {
      stale.push(`STORY_PATCH_PROJECTION_GAPS[${index}] (${gap.check})`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `STORY_PATCH_PROJECTION_GAPS acknowledges ${stale.length} check(s) the schema no ` +
        `longer carries: ${stale.join(", ")}. Remove them — an acknowledgement list nobody ` +
        `can trust to be current is one nobody reads.`
    );
  }
}

type JsonSchemaNode = Record<string, unknown>;

/**
 * The `story.canvas.apply_patch` manifest input schema, GENERATED from the zod
 * schema that validates the request.
 *
 * Hand-maintaining this projection is exactly the failure it exists to prevent:
 * while the manifest said `payload: { type: "object" }` the model had to guess
 * every payload field and learned the contract one rejection at a time. The
 * only edits applied on top of the generated document are mechanical:
 *
 *  - `$schema` is dropped, because AJV v8 resolves draft-07 by default and a
 *    declared meta-schema at the document root is an unresolvable ref for it;
 *  - `oneOf` becomes `anyOf`, because every union here is discriminated by a
 *    `const`, so the two are equivalent, and provider strict-tool subsets
 *    accept `anyOf` where they reject `oneOf`;
 *  - server-supplied fields are demoted out of `required` and annotated. They
 *    stay declared because the persisted input is re-validated against this
 *    same schema at execute time, and every manifest object is closed.
 *
 * What is guaranteed, and by what:
 *
 *  - STRUCTURE — which branches exist, which fields they carry, which are
 *    optional — is derived from this Zod contract rather than maintained as a
 *    second handwritten schema.
 *  - CHECKS cannot drift UNNOTICED — which is a weaker guarantee, and the
 *    distinction matters. A zod check with no JSON Schema counterpart is dropped
 *    by `z.toJSONSchema` in silence, so the fixtures above cannot see it.
 *    `assertStoryPatchProjectionFidelity` runs before this function returns and
 *    refuses to emit a projection carrying an unprojectable check that
 *    STORY_PATCH_PROJECTION_GAPS has not accounted for. That converts a silent
 *    divergence into a failed `@repo/shared` build; it does not, and cannot,
 *    make the manifest carry a rule JSON Schema has no words for.
 *    An acknowledgement covers exactly ONE check: a schema whose single
 *    `.refine` is accounted for and then gains a second one fails the build,
 *    because the count is taken per schema, not per kind. A schema reused at
 *    twenty paths still needs only one entry — the count is the max over paths,
 *    not the sum.
 *  - Nothing here guarantees the SEMANTICS agree beyond that. The acknowledged
 *    gaps are arguments, reviewed once and written down, that the manifest stays
 *    the stricter of the two gates. They are only as good as the argument.
 *
 * The one asymmetry every gap is judged against: a manifest STRICTER than the
 * executor costs the model a correctable rejection at prepare time, while a
 * manifest LOOSER than the executor tells the model a payload is acceptable and
 * then refuses it — with the rule nowhere in the document it was given.
 */
export function storyPatchActionInputJsonSchema(): JsonSchemaNode {
  // Refuse to hand a model a document that has quietly lost a rule the executor
  // still enforces. This runs on the projection path rather than only in a test
  // so no caller can obtain the lossy schema, and it runs in the package build
  // (scripts/check-story-patch-projection.mjs) so it lands before deploy.
  assertStoryPatchProjectionFidelity();
  // Round-tripped through JSON on purpose. zod hangs a non-enumerable
  // `~standard` interface off the document it returns, which survives a spread
  // and trips any consumer that walks own property names; the manifest must be
  // a plain JSON document because it is persisted, hashed, and shipped to the
  // model as a tool schema.
  const schema = JSON.parse(
    JSON.stringify(
      z.toJSONSchema(StoryPatchActionInputSchema, {
        target: "draft-7",
        io: "output",
        reused: "inline",
        unrepresentable: "throw",
      })
    )
  ) as JsonSchemaNode;
  delete schema.$schema;
  rewriteOneOfAsAnyOf(schema);
  demoteServerSuppliedFields(schema, STORY_PATCH_SERVER_SUPPLIED_ACTION_FIELDS, "$");
  const branches = requireJsonSchemaNode(
    requireJsonSchemaNode(
      requireJsonSchemaNode(schema.properties, "$.properties").operations,
      "$.properties.operations"
    ).items,
    "$.properties.operations.items"
  ).anyOf;
  if (
    !Array.isArray(branches) ||
    branches.length !== StoryPatchOperationShapeSchema.options.length
  ) {
    throw new Error(
      "Story patch operation projection lost the discriminated union of operation kinds."
    );
  }
  branches.forEach((branch, index) => {
    demoteServerSuppliedFields(
      requireJsonSchemaNode(branch, `$.properties.operations.items.anyOf[${index}]`),
      STORY_PATCH_SERVER_SUPPLIED_OPERATION_FIELDS,
      `$.properties.operations.items.anyOf[${index}]`
    );
  });
  return schema;
}

function rewriteOneOfAsAnyOf(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(rewriteOneOfAsAnyOf);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as JsonSchemaNode;
  if (Array.isArray(record.oneOf)) {
    record.anyOf = record.oneOf;
    delete record.oneOf;
  }
  for (const child of Object.values(record)) rewriteOneOfAsAnyOf(child);
}

function demoteServerSuppliedFields(
  objectSchema: JsonSchemaNode,
  fields: Readonly<Record<string, string>>,
  path: string
): void {
  const properties = requireJsonSchemaNode(objectSchema.properties, `${path}.properties`);
  const required = objectSchema.required;
  if (!Array.isArray(required)) {
    throw new Error(`Story patch projection expected a required list at ${path}.`);
  }
  for (const [field, description] of Object.entries(fields)) {
    const property = requireJsonSchemaNode(properties[field], `${path}.properties.${field}`);
    properties[field] = { ...property, description };
  }
  objectSchema.required = required.filter((field) => !(String(field) in fields));
}

function requireJsonSchemaNode(value: unknown, path: string): JsonSchemaNode {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Story patch projection expected an object at ${path}.`);
  }
  return value as JsonSchemaNode;
}

export const StoryAgentRunStatusSchema = z.enum([
  "authoring",
  "authoring_failed",
  "proposed",
  "applying",
  "succeeded",
  "failed",
  "cancelled",
  "stale",
]);
export type StoryAgentRunStatus = z.infer<typeof StoryAgentRunStatusSchema>;

/**
 * Ordered batons of the deterministic authoring pipeline. Hosted here (the DTO
 * home) so the run DTO and the pipeline service share one source of truth
 * without a module cycle.
 */
export const STORY_AUTHORING_STAGE_KEYS = [
  "foundation",
  "structure",
  "branch",
  "scene",
  "assets",
  "storyboard",
  "validate",
] as const;
export type StoryAuthoringStageKey = (typeof STORY_AUTHORING_STAGE_KEYS)[number];

export const StoryAuthoringStageProgressSchema = z
  .object({
    key: z.enum(STORY_AUTHORING_STAGE_KEYS),
    status: z.enum(["pending", "running", "done", "failed"]),
  })
  .strict();
export type StoryAuthoringStageProgress = z.infer<typeof StoryAuthoringStageProgressSchema>;

export const StoryAgentRunKindSchema = z.enum(["apply", "undo"]);
export type StoryAgentRunKind = z.infer<typeof StoryAgentRunKindSchema>;

export const StoryAgentInitiatorSchema = z
  .object({
    id: StoryAgentActorIdSchema,
    displayName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
export type StoryAgentInitiator = z.infer<typeof StoryAgentInitiatorSchema>;

/** Immutable proposal embedded by one durable apply/undo run. */
const StoryPatchProposalShapeSchema = z
  .object({
    schemaVersion: z.literal(STORY_PATCH_SCHEMA_VERSION),
    draftSchemaVersion: z.literal(STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION),
    baseDraftRevision: z.number().int().nonnegative(),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 content hash."),
    baseLayoutRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    operations: z
      .array(StoryPatchOperationShapeSchema)
      .min(1)
      .max(STORY_AGENT_MAX_PROPOSAL_OPERATIONS),
  })
  .strict()
  .superRefine((proposal, context) => {
    const operationIds = new Set<string>();
    proposal.operations.forEach((operation, operationIndex) => {
      if (operationIds.has(operation.operationId)) {
        context.addIssue({
          code: "custom",
          path: ["operations", operationIndex, "operationId"],
          message: "Story patch operation ids must be unique.",
        });
      }
      operationIds.add(operation.operationId);
    });
  });

export const StoryPatchProposalSchema = z
  .unknown()
  .superRefine(addStoryPatchPreflightIssue)
  .pipe(StoryPatchProposalShapeSchema);
export type StoryPatchProposal = z.infer<typeof StoryPatchProposalSchema>;

export const STORY_PATCH_BRIEF_SCHEMA_VERSION = "story-patch-brief-v1" as const;
export const STORY_AGENT_BRIEF_MAX_CHARS = 8_000;

/**
 * The flat editorial intent a run carries while a dedicated server-side author
 * turns it into concrete operations. This is the ONLY proposal payload allowed
 * to cross a model tool-call boundary: rich operation documents never ride
 * function-call arguments.
 */
export const StoryPatchBriefSchema = z
  .object({
    schemaVersion: z.literal(STORY_PATCH_BRIEF_SCHEMA_VERSION),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /**
     * Conversation-scoped source document (uploaded script/outline). The 8K
     * brief cannot carry a whole script, so the authoring worker loads the
     * document text by this id and drafts the skeleton FROM the document.
     */
    documentId: z.uuid().optional(),
    /** Agent OS attachment containing the full uploaded source text. */
    sourceAttachmentId: z.uuid().optional(),
    /** Preserve a supplied screenplay unless the creator explicitly asks for adaptation. */
    sourceMode: z.enum(["preserve", "adapt"]).optional(),
    /** Explicitly re-author this existing downstream stage; omitted for ordinary continuation. */
    regenerateStage: z.enum(["plot", "assets", "storyboard"]).optional(),
  })
  .strict();
export type StoryPatchBrief = z.infer<typeof StoryPatchBriefSchema>;

export const STORY_SCREENPLAY_SCHEMA_VERSION = "interactive-screenplay-v1" as const;
export const STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION = "story-screenplay-proposal-v1" as const;
export const STORY_PLOT_PROPOSAL_SCHEMA_VERSION = "story-plot-proposal-v1" as const;
export const STORY_ASSET_PROPOSAL_SCHEMA_VERSION = "story-asset-proposal-v1" as const;
export const STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION = "story-storyboard-proposal-v1" as const;
export const STORY_NOOP_PROPOSAL_SCHEMA_VERSION = "story-noop-proposal-v1" as const;
export const STORY_SCREENPLAY_DOCUMENT_SCHEMA_VERSION = "story-screenplay-document-v1" as const;

export const StoryScreenplayDialogueLineSchema = z
  .object({
    characterId: StoryAgentStableIdSchema.nullable(),
    speaker: z.string().trim().min(1).max(120),
    parenthetical: z.string().trim().min(1).max(240).optional(),
    text: z.string().trim().min(1).max(2_000),
  })
  .strict();

const StoryScreenplayExitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("auto"),
      nextNodeId: StoryAgentStableIdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("choice"),
      decisionId: StoryAgentStableIdSchema,
      prompt: StoryAgentLocalizedTextSchema,
      choices: z.array(
        z
          .object({
            choiceId: StoryAgentStableIdSchema,
            label: StoryAgentLocalizedTextSchema,
            nextNodeId: StoryAgentStableIdSchema.nullable(),
          })
          .strict()
      ),
    })
    .strict(),
]);

export const StoryScreenplaySceneSchema = z
  .object({
    nodeId: StoryAgentStableIdSchema,
    clipKey: StoryAgentClipKeySchema,
    name: z.string().trim().max(120).optional(),
    heading: z.string().trim().min(1).max(240),
    beat: z.string().trim().min(1).max(500),
    action: z.string().min(1).max(12_000).regex(/\S/),
    dialogue: z.array(StoryScreenplayDialogueLineSchema).max(120),
    exit: StoryScreenplayExitSchema,
  })
  .strict();

function storyAgentExitNodeIds(exit: z.infer<typeof StoryAgentGraphNodeSchema>["exit"]): string[] {
  if (exit.kind === "auto") {
    if ("nextNodeId" in exit) return exit.nextNodeId ? [exit.nextNodeId] : [];
    return exit.routes.flatMap((route) =>
      route.target?.kind === "node" ? [route.target.nodeId] : []
    );
  }
  return exit.choices.flatMap((choice) => {
    if ("nextNodeId" in choice) return choice.nextNodeId ? [choice.nextNodeId] : [];
    return choice.target?.kind === "node" ? [choice.target.nodeId] : [];
  });
}

export const StoryScreenplaySchema = z
  .object({
    schemaVersion: z.literal(STORY_SCREENPLAY_SCHEMA_VERSION),
    storyLanguage: z.string().trim().min(2).max(16),
    title: z.string().trim().min(1).max(160),
    logline: z.string().trim().min(1).max(1_000),
    synopsis: z.string().trim().min(1).max(20_000),
    /** In preserved scripts, scene.action is an exact source passage, including dialogue. */
    sourceMode: z.literal("preserved").optional(),
    /** Source rules retained for review but not implemented by the current player. */
    reviewNotes: z.array(z.string().min(1).max(2_000)).max(200).optional(),
    /** These stops are unresolved routes, not authored endings. */
    unresolvedNodeIds: z.array(StoryAgentStableIdSchema).max(200).optional(),
    characters: z.array(StoryAgentCharacterSchema).max(100),
    entrySceneId: StoryAgentStableIdSchema,
    scenes: z.array(StoryScreenplaySceneSchema).min(1).max(200),
  })
  .strict()
  .superRefine((screenplay, context) => {
    const ids = new Set(screenplay.scenes.map((scene) => scene.nodeId));
    (screenplay.unresolvedNodeIds ?? []).forEach((nodeId, index) => {
      const scene = screenplay.scenes.find((item) => item.nodeId === nodeId);
      if (!scene || scene.exit.kind !== "auto" || storyAgentExitNodeIds(scene.exit).length > 0) {
        context.addIssue({
          code: "custom",
          path: ["unresolvedNodeIds", index],
          message:
            "An unresolved route must reference an existing scene without an executable exit.",
        });
      }
    });
    if (!ids.has(screenplay.entrySceneId)) {
      context.addIssue({
        code: "custom",
        path: ["entrySceneId"],
        message: "The screenplay entry scene must exist in scenes.",
      });
    }
    screenplay.scenes.forEach((scene, sceneIndex) => {
      const targets = storyAgentExitNodeIds(scene.exit);
      targets.forEach((target) => {
        if (!ids.has(target)) {
          context.addIssue({
            code: "custom",
            path: ["scenes", sceneIndex, "exit"],
            message: `Scene exit targets missing scene "${target}".`,
          });
        }
      });
    });
  });
export type StoryScreenplay = z.infer<typeof StoryScreenplaySchema>;

/**
 * The single creator-visible screenplay document. This deliberately models
 * only the rich-text structure supported by Script today. Semantic scene,
 * branch, and character data stays in `screenplay` for validation and Plot
 * Tree compilation; it must never become a second review surface.
 */
export const StoryScreenplayDocumentBlockSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("heading"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().min(1).max(12_000).regex(/\S/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("paragraph"),
      text: z.string().min(1).max(12_000).regex(/\S/),
    })
    .strict(),
]);

export const StoryScreenplayDocumentSchema = z
  .object({
    schemaVersion: z.literal(STORY_SCREENPLAY_DOCUMENT_SCHEMA_VERSION),
    blocks: z.array(StoryScreenplayDocumentBlockSchema).min(1).max(10_000),
  })
  .strict();
export type StoryScreenplayDocument = z.infer<typeof StoryScreenplayDocumentSchema>;

/**
 * Build the exact document shown in review and committed to Script. New
 * proposals persist this result. The exported builder is also the one bounded
 * compatibility path for proposals authored before the document field
 * existed, so old durable proposals remain reviewable without a second UI.
 */
export function buildStoryScreenplayDocument(screenplay: StoryScreenplay): StoryScreenplayDocument {
  const labels =
    screenplay.storyLanguage === "zh-CN" || screenplay.storyLanguage === "zh-HK"
      ? { synopsis: "故事梗概", characters: "角色" }
      : { synopsis: "Synopsis", characters: "Characters" };
  const sceneNames = new Map(
    screenplay.scenes.map((scene) => [scene.nodeId, scene.name?.trim() || scene.heading])
  );
  const blocks: StoryScreenplayDocument["blocks"] = [
    { kind: "heading", level: 1, text: screenplay.title },
    { kind: "paragraph", text: screenplay.logline },
    { kind: "heading", level: 2, text: labels.synopsis },
    { kind: "paragraph", text: screenplay.synopsis },
  ];
  if (screenplay.characters.length > 0) {
    blocks.push({ kind: "heading", level: 2, text: labels.characters });
    for (const character of screenplay.characters) {
      const displayName = localizedStoryText(character.name) || character.id;
      blocks.push({
        kind: "paragraph",
        text: `${displayName}${character.summary ? ` — ${character.summary}` : ""}`,
      });
    }
  }
  for (const [index, scene] of screenplay.scenes.entries()) {
    blocks.push({
      kind: "heading",
      level: 2,
      text: `${index + 1}. ${scene.heading}`,
    });
    blocks.push({ kind: "paragraph", text: scene.action });
    for (const line of scene.dialogue) {
      blocks.push({ kind: "paragraph", text: line.speaker.toUpperCase() });
      if (line.parenthetical) {
        blocks.push({ kind: "paragraph", text: `(${line.parenthetical})` });
      }
      blocks.push({ kind: "paragraph", text: line.text });
    }
    if (scene.exit.kind === "choice") {
      blocks.push({ kind: "paragraph", text: localizedStoryText(scene.exit.prompt) });
      for (const choice of scene.exit.choices) {
        const targetNodeId = choice.nextNodeId;
        const target = targetNodeId
          ? (sceneNames.get(targetNodeId) ?? targetNodeId)
          : "(unresolved)";
        blocks.push({
          kind: "paragraph",
          text: `• ${localizedStoryText(choice.label)} → ${target}`,
        });
      }
    }
  }
  return StoryScreenplayDocumentSchema.parse({
    schemaVersion: STORY_SCREENPLAY_DOCUMENT_SCHEMA_VERSION,
    blocks,
  });
}

function localizedStoryText(value: Readonly<Record<string, string>>): string {
  return value["en-US"] ?? value["zh-CN"] ?? value["zh-HK"] ?? Object.values(value)[0] ?? "";
}

const StoryStageProposalBaseShape = {
  draftSchemaVersion: z.literal(STORY_AGENT_TARGET_DRAFT_SCHEMA_VERSION),
  baseDraftRevision: z.number().int().nonnegative(),
  baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseLayoutRevision: z.number().int().nonnegative(),
  /** Exact collaborative Script head used as this proposal's source. */
  baseScriptDocumentId: StoryAgentUuidSchema.nullable(),
  baseScriptSequence: z.number().int().nonnegative(),
  baseScriptHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(4_000),
} as const;

const StoryDownstreamStageProposalBaseShape = {
  ...StoryStageProposalBaseShape,
  /** Assets/Plot/Storyboard require an already-existing approved Script. */
  baseScriptDocumentId: StoryAgentUuidSchema,
} as const;

/** Creator review payload for the Script stage only. */
export const StoryScreenplayProposalSchema = z
  .object({
    schemaVersion: z.literal(STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION),
    ...StoryStageProposalBaseShape,
    screenplay: StoryScreenplaySchema,
    /**
     * Legacy read-only payload authored before stages became independent.
     * New Script writers must omit this field; keeping it here lets existing
     * durable v1 runs drain without changing their schemaVersion in place.
     */
    productionPlan: StoryProductionPlanSchema.optional(),
    /**
     * Persisted by every new writer. Optional only so durable v1 proposals
     * created before screenplay-document-v1 can be projected through the same
     * canonical builder and remain actionable.
     */
    document: StoryScreenplayDocumentSchema.optional(),
  })
  .strict();
export type StoryScreenplayProposal = z.infer<typeof StoryScreenplayProposalSchema>;

/** Creator review payload for compiling the approved Script into Plot Tree topology. */
export const StoryPlotProposalSchema = z
  .object({
    schemaVersion: z.literal(STORY_PLOT_PROPOSAL_SCHEMA_VERSION),
    ...StoryDownstreamStageProposalBaseShape,
    screenplay: StoryScreenplaySchema,
    document: StoryScreenplayDocumentSchema,
    /**
     * Legacy read-only payload from the retired Assets-before-Plot workflow.
     * New Plot writers omit it; accepting it lets already-durable proposals
     * drain while all active planning and apply logic ignores the old input.
     */
    assetPlan: StoryAssetPlanSchema.optional(),
  })
  .strict();
export type StoryPlotProposal = z.infer<typeof StoryPlotProposalSchema>;

/** Creator review payload for logical Asset Specs. No media is generated here. */
export const StoryAssetProposalSchema = z
  .object({
    schemaVersion: z.literal(STORY_ASSET_PROPOSAL_SCHEMA_VERSION),
    ...StoryDownstreamStageProposalBaseShape,
    screenplay: StoryScreenplaySchema,
    assetPlan: StoryAssetPlanSchema,
  })
  .strict();
export type StoryAssetProposal = z.infer<typeof StoryAssetProposalSchema>;

/**
 * Creator review payload for Storyboard sequences. The embedded Asset plan
 * records the authoring context; apply resolves mentions against the chapter's
 * live Asset Specs so later creator edits never create a plan-conflict gate.
 */
export const StoryStoryboardProposalSchema = z
  .object({
    schemaVersion: z.literal(STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION),
    ...StoryDownstreamStageProposalBaseShape,
    screenplay: StoryScreenplaySchema,
    assetPlan: StoryAssetPlanSchema,
    storyboardPlan: StoryStoryboardPlanSchema,
  })
  .strict();
export type StoryStoryboardProposal = z.infer<typeof StoryStoryboardProposalSchema>;

/** Durable proof that an explicit authoring request found every stage current. */
export const StoryNoopProposalSchema = z
  .object({
    schemaVersion: z.literal(STORY_NOOP_PROPOSAL_SCHEMA_VERSION),
    ...StoryDownstreamStageProposalBaseShape,
  })
  .strict();
export type StoryNoopProposal = z.infer<typeof StoryNoopProposalSchema>;

/** A run's durable proposal column: a drafting brief until authoring lands. */
export const StoryAgentRunProposalSchema = z.union([
  StoryPatchProposalSchema,
  StoryScreenplayProposalSchema,
  StoryPlotProposalSchema,
  StoryAssetProposalSchema,
  StoryStoryboardProposalSchema,
  StoryNoopProposalSchema,
  StoryPatchBriefSchema,
]);
export type StoryAgentRunProposal = z.infer<typeof StoryAgentRunProposalSchema>;

export function isStoryPatchBrief(proposal: StoryAgentRunProposal): proposal is StoryPatchBrief {
  return proposal.schemaVersion === STORY_PATCH_BRIEF_SCHEMA_VERSION;
}

export function isStoryScreenplayProposal(
  proposal: StoryAgentRunProposal
): proposal is StoryScreenplayProposal {
  return proposal.schemaVersion === STORY_SCREENPLAY_PROPOSAL_SCHEMA_VERSION;
}

export function isStoryPlotProposal(
  proposal: StoryAgentRunProposal
): proposal is StoryPlotProposal {
  return proposal.schemaVersion === STORY_PLOT_PROPOSAL_SCHEMA_VERSION;
}

export function isStoryAssetProposal(
  proposal: StoryAgentRunProposal
): proposal is StoryAssetProposal {
  return proposal.schemaVersion === STORY_ASSET_PROPOSAL_SCHEMA_VERSION;
}

export function isStoryStoryboardProposal(
  proposal: StoryAgentRunProposal
): proposal is StoryStoryboardProposal {
  return proposal.schemaVersion === STORY_STORYBOARD_PROPOSAL_SCHEMA_VERSION;
}

export function isStoryNoopProposal(
  proposal: StoryAgentRunProposal
): proposal is StoryNoopProposal {
  return proposal.schemaVersion === STORY_NOOP_PROPOSAL_SCHEMA_VERSION;
}

export function storyScreenplayDocument(
  proposal:
    | StoryScreenplayProposal
    | StoryPlotProposal
    | StoryAssetProposal
    | StoryStoryboardProposal
): StoryScreenplayDocument {
  return "document" in proposal && proposal.document
    ? proposal.document
    : buildStoryScreenplayDocument(proposal.screenplay);
}

/**
 * Statuses a run may hold while its proposal column is still a brief.
 * `failed` is included because authoring can terminate before a concrete
 * proposal exists; unlike `authoring_failed`, it is not retryable.
 */
const BRIEF_PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  "authoring",
  "authoring_failed",
  "failed",
  "cancelled",
  "stale",
]);

/** Statuses that exist only before authoring lands concrete operations. */
const AUTHORING_PHASE_STATUSES: ReadonlySet<string> = new Set(["authoring", "authoring_failed"]);

export const StoryAgentRunErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(4_000),
  })
  .strict();
export type StoryAgentRunError = z.infer<typeof StoryAgentRunErrorSchema>;

/**
 * Durable lifecycle DTO for applying a proposal or applying a generated undo.
 * Layout is never an Agent operation: resultLayoutRevision is recorded because
 * the server derives canvas layout from canonical node creation/removal.
 */
export const StoryAgentRunDtoSchema = z
  .object({
    id: StoryAgentUuidSchema,
    kind: StoryAgentRunKindSchema,
    status: StoryAgentRunStatusSchema,
    workspaceId: StoryAgentUuidSchema,
    projectId: StoryAgentUuidSchema,
    chapterId: StoryAgentUuidSchema,
    initiator: StoryAgentInitiatorSchema,
    /** True when proposal/failure decisions are owned by the Agent OS transcript. */
    agentOsManaged: z.boolean(),
    confirmedByUserId: StoryAgentActorIdSchema.nullable(),
    cancelledByUserId: StoryAgentActorIdSchema.nullable(),
    proposal: StoryAgentRunProposalSchema,
    /** Per-baton progress while drafting; null outside the authoring window. */
    authoringStages: z.array(StoryAuthoringStageProgressSchema).max(16).nullable(),
    undoOfRunId: StoryAgentUuidSchema.nullable(),
    baseDraftRevision: z.number().int().nonnegative(),
    baseLayoutRevision: z.number().int().nonnegative(),
    resultDraftRevision: z.number().int().nonnegative().nullable(),
    resultLayoutRevision: z.number().int().nonnegative().nullable(),
    affectedNodeIds: z.array(StoryAgentStableIdSchema).max(500),
    createdNodeIds: z.array(StoryAgentStableIdSchema).max(500),
    revealStartedAt: StoryAgentTimestampSchema.nullable(),
    lockExpiresAt: StoryAgentTimestampSchema.nullable(),
    error: StoryAgentRunErrorSchema.nullable(),
    createdAt: StoryAgentTimestampSchema,
    expiresAt: StoryAgentTimestampSchema,
    confirmedAt: StoryAgentTimestampSchema.nullable(),
    startedAt: StoryAgentTimestampSchema.nullable(),
    completedAt: StoryAgentTimestampSchema.nullable(),
    cancelledAt: StoryAgentTimestampSchema.nullable(),
    updatedAt: StoryAgentTimestampSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (isStoryNoopProposal(run.proposal)) {
      if (run.kind !== "apply") {
        addRunIssue(context, ["kind"], "A Noop proposal can only complete an apply run.");
      }
      if (run.status !== "succeeded") {
        addRunIssue(
          context,
          ["status"],
          "A Noop proposal is a terminal current-workflow result, not a reviewable proposal."
        );
      }
      if (run.affectedNodeIds.length > 0 || run.createdNodeIds.length > 0) {
        addRunIssue(
          context,
          ["affectedNodeIds"],
          "A Noop result cannot report affected or created Plot nodes."
        );
      }
      if (run.resultDraftRevision !== null && run.resultDraftRevision !== run.baseDraftRevision) {
        addRunIssue(
          context,
          ["resultDraftRevision"],
          "A Noop result must preserve the base draft revision."
        );
      }
      if (
        run.resultLayoutRevision !== null &&
        run.resultLayoutRevision !== run.baseLayoutRevision
      ) {
        addRunIssue(
          context,
          ["resultLayoutRevision"],
          "A Noop result must preserve the base layout revision."
        );
      }
    }
    if (isStoryPatchBrief(run.proposal)) {
      if (!BRIEF_PROPOSAL_STATUSES.has(run.status)) {
        addRunIssue(
          context,
          ["proposal"],
          `A ${run.status} run requires a fully authored operations proposal.`
        );
      }
      if (run.kind !== "apply") {
        addRunIssue(context, ["kind"], "Only apply runs can carry a drafting brief.");
      }
    } else {
      if (AUTHORING_PHASE_STATUSES.has(run.status)) {
        addRunIssue(
          context,
          ["proposal"],
          `A ${run.status} run must still carry its drafting brief.`
        );
      }
      if (run.baseDraftRevision !== run.proposal.baseDraftRevision) {
        addRunIssue(
          context,
          ["baseDraftRevision"],
          "Run baseDraftRevision must match its immutable proposal."
        );
      }
      if (run.baseLayoutRevision !== run.proposal.baseLayoutRevision) {
        addRunIssue(
          context,
          ["baseLayoutRevision"],
          "Run baseLayoutRevision must match its immutable proposal."
        );
      }
    }
    // Stage progress exists only while drafting; every other status nulls it.
    if (AUTHORING_PHASE_STATUSES.has(run.status)) {
      if (run.authoringStages === null) {
        addRunIssue(
          context,
          ["authoringStages"],
          `A ${run.status} run must carry pipeline stage progress.`
        );
      }
    } else if (run.authoringStages !== null) {
      addRunIssue(
        context,
        ["authoringStages"],
        `A ${run.status} run must not carry pipeline stage progress.`
      );
    }
    if (run.kind === "apply" && run.undoOfRunId !== null) {
      addRunIssue(context, ["undoOfRunId"], "Apply runs cannot reference an undo source run.");
    }
    if (run.kind === "undo" && run.undoOfRunId === null) {
      addRunIssue(
        context,
        ["undoOfRunId"],
        "Undo runs must reference the succeeded run they reverse."
      );
    }
    if ((run.confirmedByUserId === null) !== (run.confirmedAt === null)) {
      addRunIssue(
        context,
        ["confirmedByUserId"],
        "confirmedByUserId and confirmedAt must be recorded together."
      );
    }
    if ((run.cancelledByUserId === null) !== (run.cancelledAt === null)) {
      addRunIssue(
        context,
        ["cancelledByUserId"],
        "cancelledByUserId and cancelledAt must be recorded together."
      );
    }

    addDuplicateIdIssues(run.affectedNodeIds, ["affectedNodeIds"], context);
    addDuplicateIdIssues(run.createdNodeIds, ["createdNodeIds"], context);
    const affected = new Set(run.affectedNodeIds);
    run.createdNodeIds.forEach((nodeId, nodeIndex) => {
      if (!affected.has(nodeId)) {
        addRunIssue(
          context,
          ["createdNodeIds", nodeIndex],
          "Every created node must also be listed as affected."
        );
      }
    });

    const hasResult = run.resultDraftRevision !== null && run.resultLayoutRevision !== null;
    if ((run.resultDraftRevision === null) !== (run.resultLayoutRevision === null)) {
      addRunIssue(
        context,
        ["resultDraftRevision"],
        "Result draft and layout revisions must be recorded together."
      );
    }

    switch (run.status) {
      case "authoring":
        requireNullRunFields(
          run,
          [
            "confirmedByUserId",
            "confirmedAt",
            "cancelledByUserId",
            "cancelledAt",
            "startedAt",
            "completedAt",
            "resultDraftRevision",
            "resultLayoutRevision",
            "error",
          ],
          context
        );
        break;
      case "authoring_failed":
        requirePresentRunFields(run, ["error"], context);
        requireNullRunFields(
          run,
          [
            "confirmedByUserId",
            "confirmedAt",
            "cancelledByUserId",
            "cancelledAt",
            "startedAt",
            "completedAt",
            "resultDraftRevision",
            "resultLayoutRevision",
          ],
          context
        );
        break;
      case "proposed":
        requireNullRunFields(
          run,
          [
            "confirmedByUserId",
            "confirmedAt",
            "cancelledByUserId",
            "startedAt",
            "completedAt",
            "cancelledAt",
            "resultDraftRevision",
            "resultLayoutRevision",
            "error",
          ],
          context
        );
        break;
      case "applying":
        requirePresentRunFields(run, ["confirmedByUserId", "confirmedAt", "startedAt"], context);
        requireNullRunFields(
          run,
          [
            "cancelledByUserId",
            "completedAt",
            "cancelledAt",
            "resultDraftRevision",
            "resultLayoutRevision",
            "error",
          ],
          context
        );
        break;
      case "succeeded":
        requirePresentRunFields(run, ["startedAt", "completedAt"], context);
        if (isStoryNoopProposal(run.proposal)) {
          requireNullRunFields(run, ["confirmedByUserId", "confirmedAt"], context);
        } else {
          requirePresentRunFields(run, ["confirmedByUserId", "confirmedAt"], context);
        }
        requireNullRunFields(run, ["cancelledByUserId", "cancelledAt", "error"], context);
        if (!hasResult) {
          addRunIssue(
            context,
            ["resultDraftRevision"],
            "Succeeded runs require result draft and layout revisions."
          );
        }
        break;
      case "failed":
      case "stale":
        requirePresentRunFields(run, ["completedAt", "error"], context);
        requireNullRunFields(
          run,
          ["cancelledByUserId", "cancelledAt", "resultDraftRevision", "resultLayoutRevision"],
          context
        );
        break;
      case "cancelled":
        requirePresentRunFields(run, ["cancelledByUserId", "cancelledAt"], context);
        requireNullRunFields(
          run,
          [
            "confirmedByUserId",
            "confirmedAt",
            "completedAt",
            "resultDraftRevision",
            "resultLayoutRevision",
            "error",
          ],
          context
        );
        break;
    }
  });
export type StoryAgentRunDto = z.infer<typeof StoryAgentRunDtoSchema>;

export const StoryAgentRunRealtimeEventSchema = z
  .object({
    kind: z.literal("story_agent_run_changed"),
    workspaceId: StoryAgentUuidSchema,
    projectId: StoryAgentUuidSchema,
    run: StoryAgentRunDtoSchema,
    ts: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.workspaceId !== event.run.workspaceId) {
      addRunIssue(context, ["workspaceId"], "Event workspaceId must match the embedded run.");
    }
    if (event.projectId !== event.run.projectId) {
      addRunIssue(context, ["projectId"], "Event projectId must match the embedded run.");
    }
  });
export type StoryAgentRunRealtimeEvent = z.infer<typeof StoryAgentRunRealtimeEventSchema>;

type StoryAgentRunNullableField =
  | "confirmedByUserId"
  | "confirmedAt"
  | "cancelledByUserId"
  | "startedAt"
  | "completedAt"
  | "cancelledAt"
  | "resultDraftRevision"
  | "resultLayoutRevision"
  | "error";

function requireNullRunFields(
  run: Record<StoryAgentRunNullableField, unknown>,
  fields: StoryAgentRunNullableField[],
  context: z.RefinementCtx
): void {
  fields.forEach((field) => {
    if (run[field] !== null) {
      addRunIssue(context, [field], `${field} must be null for this status.`);
    }
  });
}

function requirePresentRunFields(
  run: Record<StoryAgentRunNullableField, unknown>,
  fields: StoryAgentRunNullableField[],
  context: z.RefinementCtx
): void {
  fields.forEach((field) => {
    if (run[field] === null) {
      addRunIssue(context, [field], `${field} is required for this status.`);
    }
  });
}

function addDuplicateIdIssues(ids: string[], path: PropertyKey[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      addRunIssue(context, [...path, index], "Identifiers must be unique.");
    }
    seen.add(id);
  });
}

function addRunIssue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

/**
 * The nodes a patch WROTE, for a canvas that wants to show the creator what
 * just changed.
 *
 * Only `put_node`. A removed node cannot be focused — it is gone — and a
 * reorder touches so many that pointing at them is the same as pointing at
 * nothing. Entry-node changes move a marker, not a node's content. So this is
 * narrower than "operations that mention a node id" on purpose: it answers
 * "where did the agent write", which is the only question a viewport can act on.
 *
 * Typed over the discriminated union rather than reaching into `payload` by
 * string, so a new node-writing operation kind fails to compile here instead of
 * silently never being focused.
 */
export function storyPatchWrittenNodeIds(operations: readonly StoryPatchOperation[]): string[] {
  const written: string[] = [];
  for (const operation of operations) {
    if (operation.kind === "story_graph.put_node") {
      written.push(operation.payload.node.nodeId);
    }
  }
  return [...new Set(written)];
}
