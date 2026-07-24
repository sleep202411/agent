import { z } from "zod";

/**
 * Wire-contract version for the provider-independent Studio Agent runtime.
 *
 * This is deliberately a literal rather than a permissive version field:
 * producers and consumers must upgrade the contract intentionally.
 */
export const STUDIO_AGENT_SCHEMA_VERSION = "studio-agent-v1" as const;
export const STUDIO_AGENT_CONTROL_TASK_QUEUE = "studio-agent-control-v1" as const;
export const STUDIO_AGENT_ACTIVITY_TASK_QUEUE = "studio-agent-activities-v1" as const;
/**
 * Stable Temporal Worker Deployment identity shared by the control and
 * activity workers. Namespace isolation separates environments; immutable
 * build IDs separate releases inside one deployment.
 */
export const STUDIO_AGENT_WORKER_DEPLOYMENT_NAME = "fizzdragon-studio-agent" as const;

export const StudioAgentSchemaVersionSchema = z.literal(STUDIO_AGENT_SCHEMA_VERSION);
export const StudioAgentIdSchema = z.uuid();
export const StudioAgentActorIdSchema = z.string().trim().min(1).max(160);
export const StudioAgentTimestampSchema = z.iso.datetime({ offset: true });
export const StudioAgentStableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/, "Use a stable lowercase key.");
export const StudioAgentManifestVersionSchema = z
  .string()
  .trim()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/,
    "Use a semantic version."
  );
export const StudioAgentContentHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256 digest.");

export type StudioAgentJsonValue =
  | string
  | number
  | boolean
  | null
  | StudioAgentJsonValue[]
  | { [key: string]: StudioAgentJsonValue };

export type StudioAgentJsonObject = Record<string, StudioAgentJsonValue>;

export const StudioAgentJsonValueSchema: z.ZodType<StudioAgentJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(StudioAgentJsonValueSchema),
    z.record(z.string(), StudioAgentJsonValueSchema),
  ])
);

export const StudioAgentJsonObjectSchema: z.ZodType<StudioAgentJsonObject> = z.record(
  z.string(),
  StudioAgentJsonValueSchema
);

export const StudioAgentResourceRefSchema = z
  .object({
    resourceType: StudioAgentStableKeySchema,
    resourceId: z.string().trim().min(1).max(256),
    revision: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export const StudioAgentManifestRefSchema = z
  .object({
    id: StudioAgentStableKeySchema,
    version: StudioAgentManifestVersionSchema,
  })
  .strict();

export const StudioAgentErrorSchema = z
  .object({
    code: StudioAgentStableKeySchema,
    message: z.string().trim().min(1).max(8_000),
    retryable: z.boolean(),
    details: StudioAgentJsonObjectSchema.nullable(),
  })
  .strict();

export const StudioAgentCapabilityEffectSchema = z.enum([
  "read",
  "write",
  "delete",
  "generate",
  "publish",
  "external",
]);
export const StudioAgentRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export const StudioAgentPermissionDecisionSchema = z.enum(["allow", "ask", "deny"]);
export const StudioAgentPermissionModeSchema = z.enum(["ask", "smart", "full", "custom"]);

export const StudioAgentPermissionRuleSelectorSchema = z
  .object({
    scenarioId: StudioAgentStableKeySchema.nullable(),
    capabilityId: StudioAgentStableKeySchema.nullable(),
    capabilityVersion: StudioAgentManifestVersionSchema.nullable(),
    resourceType: StudioAgentStableKeySchema.nullable(),
    effect: StudioAgentCapabilityEffectSchema.nullable(),
    risk: StudioAgentRiskLevelSchema.nullable(),
  })
  .strict();

export const StudioAgentPermissionRuleSchema = z
  .object({
    ruleId: StudioAgentIdSchema,
    priority: z.number().int().min(0),
    selector: StudioAgentPermissionRuleSelectorSchema,
    decision: StudioAgentPermissionDecisionSchema,
  })
  .strict();

/**
 * User-selectable permission policy. Server-side non-bypassable safety rules
 * are intentionally outside this contract and always take precedence.
 */
export const StudioAgentPermissionPolicySchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    policyId: StudioAgentIdSchema,
    revision: z.number().int().positive(),
    mode: StudioAgentPermissionModeSchema,
    rules: z.array(StudioAgentPermissionRuleSchema).max(256),
    createdAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentPermissionPolicyRefSchema = z
  .object({
    policyId: StudioAgentIdSchema,
    revision: z.number().int().positive(),
  })
  .strict();

export const StudioAgentThreadScopeSchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(256),
    container: StudioAgentResourceRefSchema,
    focus: StudioAgentResourceRefSchema.nullable(),
  })
  .strict();

export const StudioAgentThreadStatusSchema = z.enum(["active", "archived"]);

export const StudioAgentThreadSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    surfaceId: StudioAgentStableKeySchema,
    scenario: StudioAgentManifestRefSchema,
    scope: StudioAgentThreadScopeSchema,
    title: z.string().trim().min(1).max(240).nullable(),
    ownerActorId: StudioAgentActorIdSchema,
    status: StudioAgentThreadStatusSchema,
    permissionPolicy: StudioAgentPermissionPolicySchema,
    activeRunId: StudioAgentIdSchema.nullable(),
    createdAt: StudioAgentTimestampSchema,
    updatedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentMessageRoleSchema = z.enum(["user", "assistant"]);
export const StudioAgentMessageStatusSchema = z.enum([
  "accepted",
  "streaming",
  "completed",
  "failed",
  "cancelled",
]);

export const StudioAgentTextMessagePartSchema = z
  .object({
    type: z.literal("text"),
    format: z.enum(["plain_text", "markdown"]),
    text: z.string().max(200_000),
  })
  .strict();

export const StudioAgentAttachmentMessagePartSchema = z
  .object({
    type: z.literal("attachment"),
    attachmentId: StudioAgentIdSchema,
    fileName: z.string().trim().min(1).max(512),
    mediaType: z.string().trim().min(1).max(160),
    sizeBytes: z.number().int().nonnegative().nullable(),
    status: z.enum(["processing", "ready", "failed"]),
  })
  .strict();

export const StudioAgentResourceMessagePartSchema = z
  .object({
    type: z.literal("resource"),
    resource: StudioAgentResourceRefSchema,
    label: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

export const StudioAgentMessagePartSchema = z.discriminatedUnion("type", [
  StudioAgentTextMessagePartSchema,
  StudioAgentAttachmentMessagePartSchema,
  StudioAgentResourceMessagePartSchema,
]);

export const StudioAgentMessageSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    messageId: StudioAgentIdSchema,
    /** Present for actor-submitted messages; null for assistant output. */
    clientMessageId: StudioAgentIdSchema.nullable(),
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema.nullable(),
    ordinal: z.number().int().nonnegative(),
    role: StudioAgentMessageRoleSchema,
    status: StudioAgentMessageStatusSchema,
    parts: z.array(StudioAgentMessagePartSchema).min(1).max(128),
    createdAt: StudioAgentTimestampSchema,
    completedAt: StudioAgentTimestampSchema.nullable(),
  })
  .strict();

export const StudioAgentRunKindSchema = z.enum(["turn", "task"]);
export const StudioAgentRunTriggerSchema = z.enum(["message", "retry", "resume", "system"]);
export const StudioAgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
]);

export const StudioAgentTaskDescriptorSchema = z
  .object({
    taskKey: StudioAgentStableKeySchema,
    title: z.string().trim().min(1).max(240),
  })
  .strict();

export const StudioAgentRunSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    runId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    rootRunId: StudioAgentIdSchema,
    parentRunId: StudioAgentIdSchema.nullable(),
    kind: StudioAgentRunKindSchema,
    task: StudioAgentTaskDescriptorSchema.nullable(),
    trigger: StudioAgentRunTriggerSchema,
    triggerMessageId: StudioAgentIdSchema.nullable(),
    scenario: StudioAgentManifestRefSchema,
    permissionPolicy: StudioAgentPermissionPolicySchema,
    status: StudioAgentRunStatusSchema,
    phase: StudioAgentStableKeySchema.nullable(),
    createdAt: StudioAgentTimestampSchema,
    startedAt: StudioAgentTimestampSchema.nullable(),
    completedAt: StudioAgentTimestampSchema.nullable(),
    error: StudioAgentErrorSchema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.kind === "turn" && (run.parentRunId !== null || run.task !== null)) {
      context.addIssue({
        code: "custom",
        message: "A turn run cannot have a parent run or task descriptor.",
        path: ["kind"],
      });
    }
    if (run.kind === "task" && (run.parentRunId === null || run.task === null)) {
      context.addIssue({
        code: "custom",
        message: "A task run requires a parent run and task descriptor.",
        path: ["kind"],
      });
    }
  });

export const StudioAgentInputDeliverySchema = z.enum(["steer", "enqueue", "stop_and_send"]);
export const StudioAgentInputStatusSchema = z.enum([
  "accepted",
  "consumed",
  "promoted",
  "cancelled",
]);

export const StudioAgentInputSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    inputId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    targetRunId: StudioAgentIdSchema,
    messageId: StudioAgentIdSchema,
    delivery: StudioAgentInputDeliverySchema,
    status: StudioAgentInputStatusSchema,
    sequence: z.number().int().positive(),
    promotedToRunId: StudioAgentIdSchema.nullable(),
    acceptedAt: StudioAgentTimestampSchema,
    consumedAt: StudioAgentTimestampSchema.nullable(),
  })
  .strict();

export const StudioAgentActionStatusSchema = z.enum([
  "proposed",
  "waiting_for_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "denied",
  "cancelled",
]);

export const StudioAgentActionSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    actionId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    capability: StudioAgentManifestRefSchema,
    effect: StudioAgentCapabilityEffectSchema,
    risk: StudioAgentRiskLevelSchema,
    status: StudioAgentActionStatusSchema,
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(4_000),
    target: StudioAgentResourceRefSchema.nullable(),
    input: StudioAgentJsonObjectSchema,
    inputHash: StudioAgentContentHashSchema,
    approvalId: StudioAgentIdSchema.nullable(),
    idempotencyKey: z.string().trim().min(1).max(256).nullable(),
    output: StudioAgentJsonValueSchema.nullable(),
    error: StudioAgentErrorSchema.nullable(),
    createdAt: StudioAgentTimestampSchema,
    startedAt: StudioAgentTimestampSchema.nullable(),
    completedAt: StudioAgentTimestampSchema.nullable(),
  })
  .strict();

export const StudioAgentApprovalStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);

export const StudioAgentApprovalDecisionRecordSchema = z
  .object({
    decision: z.enum(["approved", "denied"]),
    actorId: StudioAgentActorIdSchema,
    note: z.string().trim().max(2_000).nullable(),
    decidedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentApprovalSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    approvalId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    actionId: StudioAgentIdSchema,
    status: StudioAgentApprovalStatusSchema,
    reason: z.string().trim().min(1).max(4_000),
    actionInputHash: StudioAgentContentHashSchema,
    requestedAt: StudioAgentTimestampSchema,
    expiresAt: StudioAgentTimestampSchema.nullable(),
    decision: StudioAgentApprovalDecisionRecordSchema.nullable(),
  })
  .strict();

export const StudioAgentIdempotencyModeSchema = z.enum(["none", "supported", "required"]);

export const StudioAgentCapabilityManifestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    capabilityId: StudioAgentStableKeySchema,
    version: StudioAgentManifestVersionSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    effect: StudioAgentCapabilityEffectSchema,
    risk: StudioAgentRiskLevelSchema,
    executionMode: z.enum(["action", "child_run"]),
    reversible: z.boolean(),
    streaming: z.boolean(),
    idempotency: StudioAgentIdempotencyModeSchema,
    requiredScopes: z.array(StudioAgentStableKeySchema).max(128),
    inputSchema: StudioAgentJsonObjectSchema,
    outputSchema: StudioAgentJsonObjectSchema,
  })
  .strict();

export const StudioAgentCapabilityRequirementSchema = z
  .object({
    capability: StudioAgentManifestRefSchema,
    required: z.boolean(),
  })
  .strict();

export const StudioAgentSkillManifestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    skillId: StudioAgentStableKeySchema,
    version: StudioAgentManifestVersionSchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    instructionSetId: StudioAgentStableKeySchema,
    capabilities: z.array(StudioAgentCapabilityRequirementSchema).max(128),
    inputSchema: StudioAgentJsonObjectSchema,
    outputSchema: StudioAgentJsonObjectSchema,
  })
  .strict();

export const StudioAgentSkillRequirementSchema = z
  .object({
    skill: StudioAgentManifestRefSchema,
    enabledByDefault: z.boolean(),
  })
  .strict();

export const StudioAgentScenarioManifestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    scenarioId: StudioAgentStableKeySchema,
    version: StudioAgentManifestVersionSchema,
    surfaceId: StudioAgentStableKeySchema,
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    instructionSetId: StudioAgentStableKeySchema,
    capabilities: z.array(StudioAgentCapabilityRequirementSchema).max(256),
    skills: z.array(StudioAgentSkillRequirementSchema).max(256),
    defaultPermissionMode: StudioAgentPermissionModeSchema,
    scopeSchema: StudioAgentJsonObjectSchema,
  })
  .strict();

export const StudioAgentChangeSetSummarySchema = z
  .object({
    changeSetId: StudioAgentIdSchema,
    actionId: StudioAgentIdSchema,
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(8_000),
    targets: z.array(StudioAgentResourceRefSchema).min(1).max(256),
    operationCount: z.number().int().positive(),
    reversible: z.boolean(),
  })
  .strict();

/**
 * Small, durable workflow input. Mutable thread, message, and manifest data
 * remains in canonical storage and is loaded by revision-aware activities.
 */
export const StudioAgentWorkflowInputSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    rootRunId: StudioAgentIdSchema,
    parentRunId: StudioAgentIdSchema.nullable(),
    kind: StudioAgentRunKindSchema,
    scenario: StudioAgentManifestRefSchema,
    permissionPolicy: StudioAgentPermissionPolicyRefSchema,
  })
  .strict();

export const StudioAgentInputSignalSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    inputId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    targetRunId: StudioAgentIdSchema,
    delivery: StudioAgentInputDeliverySchema,
    emittedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentApprovalSignalSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    approvalId: StudioAgentIdSchema,
    actionId: StudioAgentIdSchema,
    targetRunId: StudioAgentIdSchema,
    actionInputHash: StudioAgentContentHashSchema,
    decision: z.enum(["approved", "denied"]),
    actorId: StudioAgentActorIdSchema,
    note: z.string().trim().max(2_000).nullable(),
    decidedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentCancelSignalSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    targetRunId: StudioAgentIdSchema,
    requestedByActorId: StudioAgentActorIdSchema,
    reason: z.string().trim().min(1).max(2_000),
    requestedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentPreparedActionSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    action: StudioAgentActionSchema,
    permissionDecision: StudioAgentPermissionDecisionSchema,
    approval: StudioAgentApprovalSchema.nullable(),
  })
  .strict()
  .superRefine((prepared, context) => {
    if (prepared.permissionDecision === "ask" && prepared.approval === null) {
      context.addIssue({
        code: "custom",
        message: "An action requiring approval must include its approval record.",
        path: ["approval"],
      });
    }
    if (prepared.permissionDecision !== "ask" && prepared.approval !== null) {
      context.addIssue({
        code: "custom",
        message: "Only an action requiring approval may include an approval record.",
        path: ["approval"],
      });
    }
  });

export const StudioAgentActionExecutionStatusSchema = z.enum(["succeeded", "failed", "cancelled"]);

export const StudioAgentActionExecutionSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    executionId: StudioAgentIdSchema,
    actionId: StudioAgentIdSchema,
    status: StudioAgentActionExecutionStatusSchema,
    output: StudioAgentJsonValueSchema.nullable(),
    error: StudioAgentErrorSchema.nullable(),
    changeSet: StudioAgentChangeSetSummarySchema.nullable(),
    startedAt: StudioAgentTimestampSchema,
    completedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentChildRunDescriptorSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    rootRunId: StudioAgentIdSchema,
    parentRunId: StudioAgentIdSchema,
    task: StudioAgentTaskDescriptorSchema,
    scenario: StudioAgentManifestRefSchema,
    permissionPolicy: StudioAgentPermissionPolicyRefSchema,
    triggerMessageId: StudioAgentIdSchema.nullable(),
  })
  .strict();

export const StudioAgentModelStepContextSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    stepId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    scenario: StudioAgentManifestRefSchema,
    contextRevision: z.number().int().positive(),
    contextCheckpointId: StudioAgentIdSchema.nullable(),
    messageIds: z.array(StudioAgentIdSchema).min(1).max(4_096),
    capabilities: z.array(StudioAgentManifestRefSchema).max(256),
    skills: z.array(StudioAgentManifestRefSchema).max(256),
    locale: z.string().trim().min(2).max(32),
  })
  .strict();

export const StudioAgentModelBinarySourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("base64"),
      data: z.string().min(1),
      mediaType: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      kind: z.literal("url"),
      url: z.url(),
      mediaType: z.string().trim().min(1).max(160).nullable(),
    })
    .strict(),
]);

export const StudioAgentModelTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().max(200_000),
  })
  .strict();

export const StudioAgentModelImagePartSchema = z
  .object({
    type: z.literal("image"),
    source: StudioAgentModelBinarySourceSchema,
  })
  .strict();

export const StudioAgentModelFilePartSchema = z
  .object({
    type: z.literal("file"),
    source: StudioAgentModelBinarySourceSchema,
    fileName: z.string().trim().min(1).max(512).nullable(),
  })
  .strict();

export const StudioAgentModelToolCallPartSchema = z
  .object({
    type: z.literal("tool-call"),
    toolCallId: z.string().trim().min(1).max(512),
    toolName: StudioAgentStableKeySchema,
    input: StudioAgentJsonObjectSchema,
  })
  .strict();

export const StudioAgentModelToolResultOutputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      value: z.string().max(200_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("json"),
      value: StudioAgentJsonValueSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("execution-denied"),
      reason: z.string().trim().min(1).max(4_000).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error-text"),
      value: z.string().max(200_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("error-json"),
      value: StudioAgentJsonValueSchema,
    })
    .strict(),
]);

export const StudioAgentModelToolResultPartSchema = z
  .object({
    type: z.literal("tool-result"),
    toolCallId: z.string().trim().min(1).max(512),
    toolName: StudioAgentStableKeySchema,
    output: StudioAgentModelToolResultOutputSchema,
  })
  .strict();

export const StudioAgentSystemModelMessageJsonSchema = z
  .object({
    role: z.literal("system"),
    content: z.string().max(400_000),
  })
  .strict();

export const StudioAgentUserModelMessageJsonSchema = z
  .object({
    role: z.literal("user"),
    content: z.union([
      z.string().max(200_000),
      z
        .array(
          z.discriminatedUnion("type", [
            StudioAgentModelTextPartSchema,
            StudioAgentModelImagePartSchema,
            StudioAgentModelFilePartSchema,
          ])
        )
        .min(1)
        .max(128),
    ]),
  })
  .strict();

export const StudioAgentAssistantModelMessageJsonSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.union([
      z.string().max(200_000),
      z
        .array(
          z.discriminatedUnion("type", [
            StudioAgentModelTextPartSchema,
            StudioAgentModelFilePartSchema,
            StudioAgentModelToolCallPartSchema,
            StudioAgentModelToolResultPartSchema,
          ])
        )
        .min(1)
        .max(128),
    ]),
  })
  .strict();

export const StudioAgentToolModelMessageJsonSchema = z
  .object({
    role: z.literal("tool"),
    content: z.array(StudioAgentModelToolResultPartSchema).min(1).max(128),
  })
  .strict();

/**
 * JSON-safe projection of AI SDK ModelMessage. Provider options, URL objects,
 * and binary instances are resolved only inside the model activity.
 */
export const StudioAgentModelMessageJsonSchema = z.discriminatedUnion("role", [
  StudioAgentSystemModelMessageJsonSchema,
  StudioAgentUserModelMessageJsonSchema,
  StudioAgentAssistantModelMessageJsonSchema,
  StudioAgentToolModelMessageJsonSchema,
]);

const StudioAgentModelExecutionPlanBaseSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    context: StudioAgentModelStepContextSchema,
    provider: StudioAgentStableKeySchema,
    modelId: z.string().trim().min(1).max(256),
    system: z.string().max(400_000),
    messages: z.array(StudioAgentModelMessageJsonSchema).min(1).max(4_096),
    maxOutputTokens: z.number().int().positive().max(65_536),
    timeoutMs: z.number().int().min(1_000).max(900_000),
  })
  .strict();

export const StudioAgentResponseModelExecutionPlanSchema =
  StudioAgentModelExecutionPlanBaseSchema.extend({
    kind: z.literal("response"),
    capabilities: z.array(StudioAgentCapabilityManifestSchema).max(256),
    assistantMessageId: StudioAgentIdSchema,
    segmentId: StudioAgentIdSchema,
  }).strict();

export const StudioAgentContextCompactionScopeSchema = z.enum(["thread_prefix", "run_suffix"]);

export const StudioAgentContextCompactionDescriptorSchema = z
  .object({
    checkpointId: StudioAgentIdSchema,
    attemptId: StudioAgentIdSchema,
    activityId: StudioAgentIdSchema,
    scope: StudioAgentContextCompactionScopeSchema,
    scopeRunId: StudioAgentIdSchema.nullable(),
    previousCheckpointId: StudioAgentIdSchema.nullable(),
    boundaryOrdinal: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .nullable(),
    coveredThroughMessageId: StudioAgentIdSchema,
    coveredMessageCount: z.number().int().positive(),
    retainedMessageCount: z.number().int().nonnegative(),
    sourceHash: StudioAgentContentHashSchema,
    sourceHasImages: z.boolean(),
    sourceMessageIds: z.array(StudioAgentIdSchema).min(1).max(4_096),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (new Set(descriptor.sourceMessageIds).size !== descriptor.sourceMessageIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceMessageIds"],
        message: "Compaction source message IDs must be unique.",
      });
    }
    if (
      (descriptor.scope === "thread_prefix" && descriptor.scopeRunId !== null) ||
      (descriptor.scope === "run_suffix" && descriptor.scopeRunId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scopeRunId"],
        message:
          "thread_prefix checkpoints are thread-scoped; run_suffix checkpoints require a run.",
      });
    }
    if (
      (descriptor.scope === "thread_prefix" && descriptor.boundaryOrdinal !== null) ||
      (descriptor.scope === "run_suffix" && descriptor.boundaryOrdinal === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundaryOrdinal"],
        message: "Only a run_suffix checkpoint may carry its immutable task boundary.",
      });
    }
  });

export const StudioAgentContextCompactionModelExecutionPlanSchema =
  StudioAgentModelExecutionPlanBaseSchema.extend({
    kind: z.literal("context_compaction"),
    compaction: StudioAgentContextCompactionDescriptorSchema,
  }).strict();

export const StudioAgentModelExecutionPlanSchema = z.discriminatedUnion("kind", [
  StudioAgentResponseModelExecutionPlanSchema,
  StudioAgentContextCompactionModelExecutionPlanSchema,
]);

export const StudioAgentPrepareActionRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    stepId: StudioAgentIdSchema,
    toolCallId: z.string().trim().min(1).max(512),
    name: StudioAgentStableKeySchema,
    input: StudioAgentJsonObjectSchema,
  })
  .strict();

export const StudioAgentAssistantSegmentOutputSchema = z
  .object({
    segmentId: StudioAgentIdSchema,
    ordinal: z.number().int().nonnegative(),
    kind: z.enum(["answer", "commentary"]),
    format: z.enum(["plain_text", "markdown"]),
    content: z.string().max(200_000),
  })
  .strict();

export const StudioAgentModelUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    reasoningTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const StudioAgentCompleteContextCompactionRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    workflow: StudioAgentWorkflowInputSchema,
    attemptId: StudioAgentIdSchema,
    sourceHash: StudioAgentContentHashSchema,
    summaryText: z.string().trim().min(1).max(200_000),
    providerResponseId: z.string().trim().min(1).max(512).nullable(),
    usage: StudioAgentModelUsageSchema,
    completedAt: StudioAgentTimestampSchema,
  })
  .strict();

export const StudioAgentFailContextCompactionRequestSchema = z.discriminatedUnion("status", [
  z
    .object({
      schemaVersion: StudioAgentSchemaVersionSchema,
      workflow: StudioAgentWorkflowInputSchema,
      attemptId: StudioAgentIdSchema,
      status: z.literal("failed"),
      error: StudioAgentErrorSchema,
      completedAt: StudioAgentTimestampSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: StudioAgentSchemaVersionSchema,
      workflow: StudioAgentWorkflowInputSchema,
      attemptId: StudioAgentIdSchema,
      status: z.literal("cancelled"),
      completedAt: StudioAgentTimestampSchema,
    })
    .strict(),
]);

export const StudioAgentContextCompactionCommitResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    checkpointId: StudioAgentIdSchema,
    event: z.lazy(() => StudioAgentEventSchema),
    created: z.boolean(),
  })
  .strict();

export const StudioAgentModelStepOutcomeSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    stepId: StudioAgentIdSchema,
    providerResponseId: z.string().trim().min(1).max(512).nullable(),
    assistantSegments: z.array(StudioAgentAssistantSegmentOutputSchema).max(128),
    preparedActions: z.array(StudioAgentPreparedActionSchema).max(128),
    childRuns: z.array(StudioAgentChildRunDescriptorSchema).max(64),
    directive: z.enum(["continue", "wait_for_input", "complete"]),
    usage: StudioAgentModelUsageSchema,
    completedAt: StudioAgentTimestampSchema,
  })
  .strict();

const StudioAgentEventBaseSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    eventId: StudioAgentIdSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    rootRunId: StudioAgentIdSchema,
    parentRunId: StudioAgentIdSchema.nullable(),
    sequence: z.number().int().positive(),
    occurredAt: StudioAgentTimestampSchema,
  })
  .strict();

const StudioAgentEventDraftBaseSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    rootRunId: StudioAgentIdSchema,
    parentRunId: StudioAgentIdSchema.nullable(),
    occurredAt: StudioAgentTimestampSchema,
    idempotencyKey: z.string().trim().min(1).max(256),
  })
  .strict();

function studioAgentEventSchema<const TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload
) {
  const event = StudioAgentEventBaseSchema.extend({
    type: z.literal(type),
    payload,
  }).strict();
  const draft = StudioAgentEventDraftBaseSchema.extend({
    type: z.literal(type),
    payload,
  }).strict();
  return Object.assign(event, { draft });
}

const StudioAgentRunCreatedEventSchema = studioAgentEventSchema(
  "run.created",
  z.object({ run: StudioAgentRunSchema }).strict()
);
const StudioAgentRunStartedEventSchema = studioAgentEventSchema(
  "run.started",
  z.object({ startedAt: StudioAgentTimestampSchema }).strict()
);
const StudioAgentRunPhaseChangedEventSchema = studioAgentEventSchema(
  "run.phase_changed",
  z
    .object({
      previousPhase: StudioAgentStableKeySchema.nullable(),
      phase: StudioAgentStableKeySchema,
    })
    .strict()
);
const StudioAgentRunWaitingEventSchema = studioAgentEventSchema(
  "run.waiting",
  z
    .object({
      reason: z.enum(["approval", "input"]),
      referenceId: StudioAgentIdSchema,
    })
    .strict()
);
const StudioAgentRunResumedEventSchema = studioAgentEventSchema(
  "run.resumed",
  z
    .object({
      resumedFrom: z.enum(["approval", "input"]),
      referenceId: StudioAgentIdSchema,
      resumedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentRunCancellationRequestedEventSchema = studioAgentEventSchema(
  "run.cancellation_requested",
  z
    .object({
      requestedByInputId: StudioAgentIdSchema.nullable(),
      requestedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentRunCompletedEventSchema = studioAgentEventSchema(
  "run.completed",
  z
    .object({
      outputMessageId: StudioAgentIdSchema.nullable(),
      summary: z.string().trim().max(8_000).nullable(),
      completedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentRunFailedEventSchema = studioAgentEventSchema(
  "run.failed",
  z
    .object({
      error: StudioAgentErrorSchema,
      failedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentRunCancelledEventSchema = studioAgentEventSchema(
  "run.cancelled",
  z
    .object({
      reason: z.string().trim().min(1).max(2_000),
      cancelledAt: StudioAgentTimestampSchema,
    })
    .strict()
);

export const StudioAgentAssistantSegmentKindSchema = z.enum(["answer", "commentary"]);
export const StudioAgentAssistantSegmentFormatSchema = z.enum(["plain_text", "markdown"]);

const StudioAgentAssistantSegmentStartedEventSchema = studioAgentEventSchema(
  "assistant.segment.started",
  z
    .object({
      messageId: StudioAgentIdSchema,
      segmentId: StudioAgentIdSchema,
      ordinal: z.number().int().nonnegative(),
      kind: StudioAgentAssistantSegmentKindSchema,
      format: StudioAgentAssistantSegmentFormatSchema,
    })
    .strict()
);
const StudioAgentAssistantSegmentDeltaEventSchema = studioAgentEventSchema(
  "assistant.segment.delta",
  z
    .object({
      messageId: StudioAgentIdSchema,
      segmentId: StudioAgentIdSchema,
      delta: z.string().min(1).max(64_000),
    })
    .strict()
);
const StudioAgentAssistantSegmentCompletedEventSchema = studioAgentEventSchema(
  "assistant.segment.completed",
  z
    .object({
      messageId: StudioAgentIdSchema,
      segmentId: StudioAgentIdSchema,
      content: z.string().max(200_000),
      // "length" = the model hit its output-token ceiling and the answer is
      // truncated (valid content, but incomplete) — distinct from a clean
      // "stop" so it can be surfaced rather than silently presented as final.
      finishReason: z.enum(["stop", "length", "cancelled", "error"]),
      providerResponseId: z.string().trim().min(1).max(512).nullable(),
      usage: StudioAgentModelUsageSchema,
      completedAt: StudioAgentTimestampSchema,
    })
    .strict()
);

export const StudioAgentActivityKindSchema = z.enum([
  "read",
  "search",
  "analyze",
  "plan",
  "execute",
  "generate",
  "wait",
  "other",
]);

const StudioAgentActivityStartedEventSchema = studioAgentEventSchema(
  "activity.started",
  z
    .object({
      activityId: StudioAgentIdSchema,
      parentActivityId: StudioAgentIdSchema.nullable(),
      kind: StudioAgentActivityKindSchema,
      label: z.string().trim().min(1).max(240),
      startedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentActivityProgressEventSchema = studioAgentEventSchema(
  "activity.progress",
  z
    .object({
      activityId: StudioAgentIdSchema,
      progress: z.number().min(0).max(1).nullable(),
      detail: z.string().trim().min(1).max(2_000).nullable(),
    })
    .strict()
);
const StudioAgentActivityCompletedEventSchema = studioAgentEventSchema(
  "activity.completed",
  z
    .object({
      activityId: StudioAgentIdSchema,
      summary: z.string().trim().min(1).max(4_000).nullable(),
      completedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentActivityFailedEventSchema = studioAgentEventSchema(
  "activity.failed",
  z
    .object({
      activityId: StudioAgentIdSchema,
      error: StudioAgentErrorSchema,
      failedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentActivityCancelledEventSchema = studioAgentEventSchema(
  "activity.cancelled",
  z
    .object({
      activityId: StudioAgentIdSchema,
      cancelledAt: StudioAgentTimestampSchema,
    })
    .strict()
);

const StudioAgentActionProposedEventSchema = studioAgentEventSchema(
  "action.proposed",
  z.object({ action: StudioAgentActionSchema }).strict()
);
const StudioAgentActionStartedEventSchema = studioAgentEventSchema(
  "action.started",
  z
    .object({
      actionId: StudioAgentIdSchema,
      executionId: StudioAgentIdSchema,
      startedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentActionCompletedEventSchema = studioAgentEventSchema(
  "action.completed",
  z.object({ execution: StudioAgentActionExecutionSchema }).strict()
);

const StudioAgentApprovalRequestedEventSchema = studioAgentEventSchema(
  "approval.requested",
  z.object({ approval: StudioAgentApprovalSchema }).strict()
);
const StudioAgentApprovalResolvedEventSchema = studioAgentEventSchema(
  "approval.resolved",
  z.object({ approval: StudioAgentApprovalSchema }).strict()
);

const StudioAgentInputAcceptedEventSchema = studioAgentEventSchema(
  "input.accepted",
  z.object({ input: StudioAgentInputSchema }).strict()
);
const StudioAgentInputConsumedEventSchema = studioAgentEventSchema(
  "input.consumed",
  z
    .object({
      inputId: StudioAgentIdSchema,
      consumedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentInputPromotedEventSchema = studioAgentEventSchema(
  "input.promoted",
  z
    .object({
      inputId: StudioAgentIdSchema,
      promotedToRunId: StudioAgentIdSchema,
      promotedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentInputCancelledEventSchema = studioAgentEventSchema(
  "input.cancelled",
  z
    .object({
      inputId: StudioAgentIdSchema,
      reason: z.string().trim().min(1).max(2_000),
      cancelledAt: StudioAgentTimestampSchema,
    })
    .strict()
);

const StudioAgentContextCompactedEventSchema = studioAgentEventSchema(
  "context.compacted",
  z
    .object({
      checkpointId: StudioAgentIdSchema,
      scope: StudioAgentContextCompactionScopeSchema,
      coveredThroughMessageId: StudioAgentIdSchema,
      coveredMessageCount: z.number().int().positive(),
      retainedMessageCount: z.number().int().nonnegative(),
      summaryHash: StudioAgentContentHashSchema,
      sourceHash: StudioAgentContentHashSchema,
      compactedAt: StudioAgentTimestampSchema,
    })
    .strict()
);

const StudioAgentChangeSetProposedEventSchema = studioAgentEventSchema(
  "changeset.proposed",
  z.object({ changeSet: StudioAgentChangeSetSummarySchema }).strict()
);
const StudioAgentChangeSetAppliedEventSchema = studioAgentEventSchema(
  "changeset.applied",
  z
    .object({
      changeSetId: StudioAgentIdSchema,
      actionId: StudioAgentIdSchema,
      revisions: z.array(StudioAgentResourceRefSchema).min(1).max(256),
      appliedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentChangeSetRejectedEventSchema = studioAgentEventSchema(
  "changeset.rejected",
  z
    .object({
      changeSetId: StudioAgentIdSchema,
      actionId: StudioAgentIdSchema,
      reason: z.string().trim().min(1).max(4_000),
      rejectedAt: StudioAgentTimestampSchema,
    })
    .strict()
);

const StudioAgentTaskCreatedEventSchema = studioAgentEventSchema(
  "task.created",
  z.object({ taskRun: StudioAgentRunSchema }).strict()
);
const StudioAgentTaskStartedEventSchema = studioAgentEventSchema(
  "task.started",
  z
    .object({
      task: StudioAgentTaskDescriptorSchema,
      startedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentTaskCompletedEventSchema = studioAgentEventSchema(
  "task.completed",
  z
    .object({
      task: StudioAgentTaskDescriptorSchema,
      summary: z.string().trim().min(1).max(8_000).nullable(),
      completedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentTaskFailedEventSchema = studioAgentEventSchema(
  "task.failed",
  z
    .object({
      task: StudioAgentTaskDescriptorSchema,
      error: StudioAgentErrorSchema,
      failedAt: StudioAgentTimestampSchema,
    })
    .strict()
);
const StudioAgentTaskCancelledEventSchema = studioAgentEventSchema(
  "task.cancelled",
  z
    .object({
      task: StudioAgentTaskDescriptorSchema,
      reason: z.string().trim().min(1).max(2_000),
      cancelledAt: StudioAgentTimestampSchema,
    })
    .strict()
);

export const STUDIO_AGENT_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.phase_changed",
  "run.waiting",
  "run.resumed",
  "run.cancellation_requested",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "assistant.segment.started",
  "assistant.segment.delta",
  "assistant.segment.completed",
  "activity.started",
  "activity.progress",
  "activity.completed",
  "activity.failed",
  "activity.cancelled",
  "action.proposed",
  "action.started",
  "action.completed",
  "approval.requested",
  "approval.resolved",
  "input.accepted",
  "input.consumed",
  "input.promoted",
  "input.cancelled",
  "context.compacted",
  "changeset.proposed",
  "changeset.applied",
  "changeset.rejected",
  "task.created",
  "task.started",
  "task.completed",
  "task.failed",
  "task.cancelled",
] as const;

export const StudioAgentEventTypeSchema = z.enum(STUDIO_AGENT_EVENT_TYPES);

export const StudioAgentEventSchema = z.discriminatedUnion("type", [
  StudioAgentRunCreatedEventSchema,
  StudioAgentRunStartedEventSchema,
  StudioAgentRunPhaseChangedEventSchema,
  StudioAgentRunWaitingEventSchema,
  StudioAgentRunResumedEventSchema,
  StudioAgentRunCancellationRequestedEventSchema,
  StudioAgentRunCompletedEventSchema,
  StudioAgentRunFailedEventSchema,
  StudioAgentRunCancelledEventSchema,
  StudioAgentAssistantSegmentStartedEventSchema,
  StudioAgentAssistantSegmentDeltaEventSchema,
  StudioAgentAssistantSegmentCompletedEventSchema,
  StudioAgentActivityStartedEventSchema,
  StudioAgentActivityProgressEventSchema,
  StudioAgentActivityCompletedEventSchema,
  StudioAgentActivityFailedEventSchema,
  StudioAgentActivityCancelledEventSchema,
  StudioAgentActionProposedEventSchema,
  StudioAgentActionStartedEventSchema,
  StudioAgentActionCompletedEventSchema,
  StudioAgentApprovalRequestedEventSchema,
  StudioAgentApprovalResolvedEventSchema,
  StudioAgentInputAcceptedEventSchema,
  StudioAgentInputConsumedEventSchema,
  StudioAgentInputPromotedEventSchema,
  StudioAgentInputCancelledEventSchema,
  StudioAgentContextCompactedEventSchema,
  StudioAgentChangeSetProposedEventSchema,
  StudioAgentChangeSetAppliedEventSchema,
  StudioAgentChangeSetRejectedEventSchema,
  StudioAgentTaskCreatedEventSchema,
  StudioAgentTaskStartedEventSchema,
  StudioAgentTaskCompletedEventSchema,
  StudioAgentTaskFailedEventSchema,
  StudioAgentTaskCancelledEventSchema,
]);

export const StudioAgentEventDraftSchema = z.discriminatedUnion("type", [
  StudioAgentRunCreatedEventSchema.draft,
  StudioAgentRunStartedEventSchema.draft,
  StudioAgentRunPhaseChangedEventSchema.draft,
  StudioAgentRunWaitingEventSchema.draft,
  StudioAgentRunResumedEventSchema.draft,
  StudioAgentRunCancellationRequestedEventSchema.draft,
  StudioAgentRunCompletedEventSchema.draft,
  StudioAgentRunFailedEventSchema.draft,
  StudioAgentRunCancelledEventSchema.draft,
  StudioAgentAssistantSegmentStartedEventSchema.draft,
  StudioAgentAssistantSegmentDeltaEventSchema.draft,
  StudioAgentAssistantSegmentCompletedEventSchema.draft,
  StudioAgentActivityStartedEventSchema.draft,
  StudioAgentActivityProgressEventSchema.draft,
  StudioAgentActivityCompletedEventSchema.draft,
  StudioAgentActivityFailedEventSchema.draft,
  StudioAgentActivityCancelledEventSchema.draft,
  StudioAgentActionProposedEventSchema.draft,
  StudioAgentActionStartedEventSchema.draft,
  StudioAgentActionCompletedEventSchema.draft,
  StudioAgentApprovalRequestedEventSchema.draft,
  StudioAgentApprovalResolvedEventSchema.draft,
  StudioAgentInputAcceptedEventSchema.draft,
  StudioAgentInputConsumedEventSchema.draft,
  StudioAgentInputPromotedEventSchema.draft,
  StudioAgentInputCancelledEventSchema.draft,
  StudioAgentContextCompactedEventSchema.draft,
  StudioAgentChangeSetProposedEventSchema.draft,
  StudioAgentChangeSetAppliedEventSchema.draft,
  StudioAgentChangeSetRejectedEventSchema.draft,
  StudioAgentTaskCreatedEventSchema.draft,
  StudioAgentTaskStartedEventSchema.draft,
  StudioAgentTaskCompletedEventSchema.draft,
  StudioAgentTaskFailedEventSchema.draft,
  StudioAgentTaskCancelledEventSchema.draft,
]);

export type StudioAgentResourceRef = z.infer<typeof StudioAgentResourceRefSchema>;
export type StudioAgentManifestRef = z.infer<typeof StudioAgentManifestRefSchema>;
export type StudioAgentError = z.infer<typeof StudioAgentErrorSchema>;
export type StudioAgentCapabilityEffect = z.infer<typeof StudioAgentCapabilityEffectSchema>;
export type StudioAgentRiskLevel = z.infer<typeof StudioAgentRiskLevelSchema>;
export type StudioAgentPermissionDecision = z.infer<typeof StudioAgentPermissionDecisionSchema>;
export type StudioAgentPermissionMode = z.infer<typeof StudioAgentPermissionModeSchema>;
export type StudioAgentPermissionRule = z.infer<typeof StudioAgentPermissionRuleSchema>;
export type StudioAgentPermissionPolicy = z.infer<typeof StudioAgentPermissionPolicySchema>;
export type StudioAgentPermissionPolicyRef = z.infer<typeof StudioAgentPermissionPolicyRefSchema>;
export type StudioAgentThreadScope = z.infer<typeof StudioAgentThreadScopeSchema>;
export type StudioAgentThread = z.infer<typeof StudioAgentThreadSchema>;
export type StudioAgentMessagePart = z.infer<typeof StudioAgentMessagePartSchema>;
export type StudioAgentMessage = z.infer<typeof StudioAgentMessageSchema>;
export type StudioAgentRunKind = z.infer<typeof StudioAgentRunKindSchema>;
export type StudioAgentRunStatus = z.infer<typeof StudioAgentRunStatusSchema>;
export type StudioAgentRun = z.infer<typeof StudioAgentRunSchema>;
export type StudioAgentInputDelivery = z.infer<typeof StudioAgentInputDeliverySchema>;
export type StudioAgentInputStatus = z.infer<typeof StudioAgentInputStatusSchema>;
export type StudioAgentInput = z.infer<typeof StudioAgentInputSchema>;
export type StudioAgentActionStatus = z.infer<typeof StudioAgentActionStatusSchema>;
export type StudioAgentAction = z.infer<typeof StudioAgentActionSchema>;
export type StudioAgentApprovalStatus = z.infer<typeof StudioAgentApprovalStatusSchema>;
export type StudioAgentApproval = z.infer<typeof StudioAgentApprovalSchema>;
export type StudioAgentCapabilityManifest = z.infer<typeof StudioAgentCapabilityManifestSchema>;
export type StudioAgentSkillManifest = z.infer<typeof StudioAgentSkillManifestSchema>;
export type StudioAgentScenarioManifest = z.infer<typeof StudioAgentScenarioManifestSchema>;
export type StudioAgentWorkflowInput = z.infer<typeof StudioAgentWorkflowInputSchema>;
export type StudioAgentInputSignal = z.infer<typeof StudioAgentInputSignalSchema>;
export type StudioAgentApprovalSignal = z.infer<typeof StudioAgentApprovalSignalSchema>;
export type StudioAgentCancelSignal = z.infer<typeof StudioAgentCancelSignalSchema>;
export type StudioAgentPreparedAction = z.infer<typeof StudioAgentPreparedActionSchema>;
export type StudioAgentActionExecution = z.infer<typeof StudioAgentActionExecutionSchema>;
export type StudioAgentChildRunDescriptor = z.infer<typeof StudioAgentChildRunDescriptorSchema>;
export type StudioAgentModelStepContext = z.infer<typeof StudioAgentModelStepContextSchema>;
export type StudioAgentModelMessageJson = z.infer<typeof StudioAgentModelMessageJsonSchema>;
export type StudioAgentModelExecutionPlan = z.infer<typeof StudioAgentModelExecutionPlanSchema>;
export type StudioAgentResponseModelExecutionPlan = z.infer<
  typeof StudioAgentResponseModelExecutionPlanSchema
>;
export type StudioAgentContextCompactionModelExecutionPlan = z.infer<
  typeof StudioAgentContextCompactionModelExecutionPlanSchema
>;
export type StudioAgentContextCompactionDescriptor = z.infer<
  typeof StudioAgentContextCompactionDescriptorSchema
>;
export type StudioAgentCompleteContextCompactionRequest = z.infer<
  typeof StudioAgentCompleteContextCompactionRequestSchema
>;
export type StudioAgentFailContextCompactionRequest = z.infer<
  typeof StudioAgentFailContextCompactionRequestSchema
>;
export type StudioAgentContextCompactionCommitResult = z.infer<
  typeof StudioAgentContextCompactionCommitResultSchema
>;
export type StudioAgentPrepareActionRequest = z.infer<typeof StudioAgentPrepareActionRequestSchema>;
export type StudioAgentModelStepOutcome = z.infer<typeof StudioAgentModelStepOutcomeSchema>;
export type StudioAgentAssistantSegmentOutput = z.infer<
  typeof StudioAgentAssistantSegmentOutputSchema
>;
export type StudioAgentAssistantSegmentKind = z.infer<typeof StudioAgentAssistantSegmentKindSchema>;
export type StudioAgentActivityKind = z.infer<typeof StudioAgentActivityKindSchema>;
export type StudioAgentChangeSetSummary = z.infer<typeof StudioAgentChangeSetSummarySchema>;
export type StudioAgentEventType = z.infer<typeof StudioAgentEventTypeSchema>;
export type StudioAgentEvent = z.infer<typeof StudioAgentEventSchema>;
export type StudioAgentEventDraft = z.infer<typeof StudioAgentEventDraftSchema>;
