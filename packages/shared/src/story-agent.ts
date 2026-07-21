import { z } from "zod";

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
const StoryAgentLocaleSchema = z.string().trim().min(2).max(16);

/** Mutable-draft localized text may be empty while the creator is authoring. */
export const StoryAgentLocalizedTextSchema = z.record(
  StoryAgentLocaleSchema,
  z.string().max(4_000)
);
export const StoryAgentTextBodyLocalizedTextSchema = z.record(
  StoryAgentLocaleSchema,
  z.string().max(20_000)
);

export const StoryAgentCharacterSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    name: StoryAgentLocalizedTextSchema,
    summary: z.string().max(4_000),
  })
  .strict();
export type StoryAgentCharacter = z.infer<typeof StoryAgentCharacterSchema>;

export const StoryAgentEndingSchema = z
  .object({
    id: StoryAgentStableIdSchema,
    title: StoryAgentLocalizedTextSchema,
    summary: StoryAgentLocalizedTextSchema.optional(),
  })
  .strict();
export type StoryAgentEnding = z.infer<typeof StoryAgentEndingSchema>;

export const StoryAgentGraphChoiceSchema = z
  .object({
    choiceId: StoryAgentStableIdSchema,
    label: StoryAgentLocalizedTextSchema,
    nextNodeId: StoryAgentStableIdSchema,
  })
  .strict();
export type StoryAgentGraphChoice = z.infer<typeof StoryAgentGraphChoiceSchema>;

/**
 * A scene's background-music binding, named by the audio MediaAsset the creator
 * uploaded. The agent never authors one — it has no media to name — but the
 * node schema is `.strict()` and `story_graph.put_node` replaces a node
 * wholesale, so the field has to be expressible or a patch that echoes a node
 * back would be rejected outright. The executor is what actually protects a
 * creator's binding: an incoming node that omits `music` keeps the existing one.
 */
export const StoryAgentNodeMusicSchema = z.object({ mediaAssetId: z.uuid() }).strict();
export type StoryAgentNodeMusic = z.infer<typeof StoryAgentNodeMusicSchema>;

export const StoryAgentGraphNodeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clip"),
      nodeId: StoryAgentStableIdSchema,
      clipKey: StoryAgentClipKeySchema,
      name: z.string().trim().max(120).optional(),
      description: z.string().trim().max(4_000).optional(),
      music: StoryAgentNodeMusicSchema.optional(),
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
        z
          .object({
            kind: z.literal("checkpoint"),
            nextNodeId: StoryAgentStableIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal("ending"),
            endingId: StoryAgentStableIdSchema,
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      nodeId: StoryAgentStableIdSchema,
      title: StoryAgentLocalizedTextSchema.optional(),
      body: StoryAgentTextBodyLocalizedTextSchema,
      music: StoryAgentNodeMusicSchema.optional(),
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
        z
          .object({
            kind: z.literal("checkpoint"),
            nextNodeId: StoryAgentStableIdSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal("ending"),
            endingId: StoryAgentStableIdSchema,
          })
          .strict(),
      ]),
    })
    .strict(),
]);
export type StoryAgentGraphNode = z.infer<typeof StoryAgentGraphNodeSchema>;

const StoryAgentOperationBaseShape = {
  operationId: StoryAgentUuidSchema,
  summary: z.string().trim().min(1).max(500),
} as const;

const StoryAgentPutIntentSchema = z.enum(["create", "replace"]);

const StoryAgentOverviewPayloadSchema = z
  .object({
    logline: z.string().max(1_000).optional(),
    synopsis: z.string().max(20_000).optional(),
    worldview: z.string().max(20_000).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.logline !== undefined ||
      payload.synopsis !== undefined ||
      payload.worldview !== undefined,
    "At least one story-bible overview field is required."
  );

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
      kind: z.literal("story_bible.put_ending"),
      payload: z
        .object({
          intent: StoryAgentPutIntentSchema,
          ending: StoryAgentEndingSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...StoryAgentOperationBaseShape,
      kind: z.literal("story_bible.remove_ending"),
      payload: z.object({ endingId: StoryAgentStableIdSchema }).strict(),
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

export const StoryPatchOperationSchema = z
  .unknown()
  .superRefine(addStoryPatchPreflightIssue)
  .pipe(StoryPatchOperationShapeSchema);
export type StoryPatchOperation = z.infer<typeof StoryPatchOperationSchema>;

/** Safe parser for an entire operation list, including aggregate limits. */
export const StoryPatchOperationsSchema = z
  .unknown()
  .superRefine(addStoryPatchPreflightIssue)
  .pipe(z.array(StoryPatchOperationShapeSchema).min(1).max(STORY_AGENT_MAX_PROPOSAL_OPERATIONS));

/**
 * Every operation kind the Story Agent may propose. Derived from the schema so
 * prompt documentation and validators can be proven complete against it.
 */
export const STORY_PATCH_OPERATION_KINDS = StoryPatchOperationShapeSchema.options.map(
  (option) => option.shape.kind.value
) as readonly StoryPatchOperation["kind"][];

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
  "worldview",
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
