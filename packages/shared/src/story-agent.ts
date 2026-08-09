import { z } from "zod";
import { findUnprojectableChecks } from "./zod-json-schema-fidelity.js";

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
    assertComplexityLimit("nestingDepth", stats.nestingDepth, current.path);

    if (current.value === null) {
      addSerializedBytes(stats, 4, current.path);
      continue;
    }
    if (typeof current.value === "string") {
      addSerializedBytes(stats, jsonStringBytes(current.value), current.path);
      continue;
    }
    if (typeof current.value === "boolean") {
      addSerializedBytes(stats, current.value ? 4 : 5, current.path);
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw invalidJson(current.path, "Numbers must be finite.");
      }
      addSerializedBytes(
        stats,
        jsonStringBytes(Object.is(current.value, -0) ? 0 : current.value),
        current.path
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
    assertComplexityLimit("containers", stats.containers, current.path);

    if (Array.isArray(current.value)) {
      stats.arrayItems += current.value.length;
      assertComplexityLimit("arrayItems", stats.arrayItems, current.path);
      addSerializedBytes(stats, 2 + Math.max(0, current.value.length - 1), current.path);
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
    addSerializedBytes(stats, 2 + Math.max(0, keys.length - 1), current.path);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const child = record[key];
      if (child === undefined) {
        throw invalidJson(`${current.path}.${key}`, "Undefined values are not allowed.");
      }
      addSerializedBytes(stats, jsonStringBytes(key) + 1, current.path);
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
  path: string
): void {
  const maximum = STORY_PATCH_COMPLEXITY_LIMITS[metric];
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

function addSerializedBytes(stats: StoryPatchComplexityStats, bytes: number, path: string): void {
  stats.serializedBytes += bytes;
  assertComplexityLimit("serializedBytes", stats.serializedBytes, path);
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
export const StoryAgentCharacterSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    name: StoryAgentLocalizedTextSchema,
    summary: z.string().max(4_000),
  })
  .strict();
export type StoryAgentCharacter = z.infer<typeof StoryAgentCharacterSchema>;

export const StoryAgentGraphChoiceSchema = z
  .object({
    choiceId: StoryAgentStableIdSchema,
    label: StoryAgentLocalizedTextSchema,
    nextNodeId: StoryAgentStableIdSchema,
  })
  .strict();
export type StoryAgentGraphChoice = z.infer<typeof StoryAgentGraphChoiceSchema>;

/**
 * A clip node's editorial labels.
 *
 * Declared rather than inlined so the projection-fidelity guard can name them:
 * `.trim()` is a rewrite the JSON Schema projection cannot carry, and every
 * such schema is acknowledged by identity in STORY_PATCH_PROJECTION_GAPS.
 */
const StoryAgentNodeNameSchema = z.string().trim().max(120);
const StoryAgentNodeDescriptionSchema = z.string().trim().max(4_000);

export const StoryAgentGraphNodeSchema = z
  .object({
    kind: z.literal("clip"),
    nodeId: StoryAgentStableIdSchema,
    clipKey: StoryAgentClipKeySchema,
    name: StoryAgentNodeNameSchema.optional(),
    description: StoryAgentNodeDescriptionSchema.optional(),
    exit: z.discriminatedUnion("kind", [
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
  {
    schema: StoryAgentNodeDescriptionSchema,
    check: "overwrite",
    reason:
      "`.trim()` before max(4000) only. Same length-only argument as " +
      "StoryAgentNodeNameSchema.",
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
  })
  .strict();
export type StoryPatchBrief = z.infer<typeof StoryPatchBriefSchema>;

/** A run's durable proposal column: a drafting brief until authoring lands. */
export const StoryAgentRunProposalSchema = z.union([
  StoryPatchProposalSchema,
  StoryPatchBriefSchema,
]);
export type StoryAgentRunProposal = z.infer<typeof StoryAgentRunProposalSchema>;

export function isStoryPatchBrief(proposal: StoryAgentRunProposal): proposal is StoryPatchBrief {
  return proposal.schemaVersion === STORY_PATCH_BRIEF_SCHEMA_VERSION;
}

/** Statuses a run may hold while its proposal column is still a brief. */
const BRIEF_PROPOSAL_STATUSES: ReadonlySet<string> = new Set([
  "authoring",
  "authoring_failed",
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
        requirePresentRunFields(
          run,
          ["confirmedByUserId", "confirmedAt", "startedAt", "completedAt"],
          context
        );
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
