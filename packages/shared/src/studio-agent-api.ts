import { z } from "zod";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionSchema,
  StudioAgentActivityKindSchema,
  StudioAgentApprovalSchema,
  StudioAgentAttachmentMessagePartSchema,
  StudioAgentContentHashSchema,
  StudioAgentErrorSchema,
  StudioAgentEventSchema,
  StudioAgentIdSchema,
  StudioAgentInputDeliverySchema,
  StudioAgentInputSchema,
  StudioAgentManifestRefSchema,
  StudioAgentMessagePartSchema,
  StudioAgentMessageSchema,
  StudioAgentModelStepOutcomeSchema,
  StudioAgentPermissionModeSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentPermissionRuleSchema,
  StudioAgentRunSchema,
  StudioAgentSchemaVersionSchema,
  StudioAgentThreadSchema,
  StudioAgentThreadScopeSchema,
  StudioAgentTimestampSchema,
  StudioAgentWorkflowInputSchema,
} from "./studio-agent.js";

/**
 * Public HTTP contracts for every Studio Agent surface.
 *
 * These are intentionally product-neutral. Story Studio and Creative Studio
 * supply different scenario/scope values, but share one transport and runtime.
 */

export const StudioAgentResolveThreadRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    surfaceId: z.string().trim().min(1).max(160),
    scenario: StudioAgentManifestRefSchema,
    scope: StudioAgentThreadScopeSchema,
    locale: z.string().trim().min(2).max(32),
  })
  .strict();

export const StudioAgentResolveThreadResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    thread: StudioAgentThreadSchema,
    created: z.boolean(),
  })
  .strict();

export const StudioAgentActivitySnapshotSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    activityId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    parentActivityId: StudioAgentIdSchema.nullable(),
    kind: StudioAgentActivityKindSchema,
    label: z.string().trim().min(1).max(240),
    detail: z.string().trim().min(1).max(8_000).nullable(),
    progress: z.number().min(0).max(1).nullable(),
    status: z.enum(["running", "succeeded", "failed", "cancelled"]),
    startedAt: StudioAgentTimestampSchema,
    completedAt: StudioAgentTimestampSchema.nullable(),
    firstEventSequence: z.number().int().positive(),
    lastEventSequence: z.number().int().positive(),
  })
  .strict()
  .superRefine((activity, context) => {
    if (activity.parentActivityId === activity.activityId) {
      context.addIssue({
        code: "custom",
        message: "An activity cannot be its own parent.",
        path: ["parentActivityId"],
      });
    }
    if (activity.lastEventSequence < activity.firstEventSequence) {
      context.addIssue({
        code: "custom",
        message: "lastEventSequence cannot precede firstEventSequence.",
        path: ["lastEventSequence"],
      });
    }
    if ((activity.status === "running") !== (activity.completedAt === null)) {
      context.addIssue({
        code: "custom",
        message: "Only a running activity may omit completedAt.",
        path: ["completedAt"],
      });
    }
    if (
      activity.completedAt !== null &&
      Date.parse(activity.completedAt) < Date.parse(activity.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "completedAt cannot precede startedAt.",
        path: ["completedAt"],
      });
    }
  });

/**
 * The turn window a snapshot payload covers.
 *
 * A thread is a conversation that never ends, so a snapshot carries a tail of
 * whole turns (a root run plus its subtree) rather than all history.
 * `earliestRootRunId` is the opaque cursor a client passes back as
 * `beforeRootRunId` to fetch the turns immediately before this window.
 */
export const StudioAgentTurnWindowSchema = z
  .object({
    earliestRootRunId: StudioAgentIdSchema.nullable(),
    hasEarlier: z.boolean(),
  })
  .strict()
  .superRefine((window, context) => {
    if (window.hasEarlier && window.earliestRootRunId === null) {
      context.addIssue({
        code: "custom",
        message: "An empty turn window cannot have earlier turns.",
        path: ["hasEarlier"],
      });
    }
  });

export const StudioAgentThreadSnapshotSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    thread: StudioAgentThreadSchema,
    messages: z.array(StudioAgentMessageSchema),
    runs: z.array(StudioAgentRunSchema),
    actions: z.array(StudioAgentActionSchema),
    approvals: z.array(StudioAgentApprovalSchema),
    inputs: z.array(StudioAgentInputSchema),
    activities: z.array(StudioAgentActivitySnapshotSchema),
    turnWindow: StudioAgentTurnWindowSchema,
    latestEventSequence: z.number().int().nonnegative(),
  })
  .strict();

export const StudioAgentSubmitMessageRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    clientMessageId: StudioAgentIdSchema,
    parts: z.array(StudioAgentMessagePartSchema).min(1).max(128),
    /**
     * The product context that the actor is submitting from.
     *
     * A thread is container-scoped and may be shared by several tabs. Focus
     * and locale therefore belong to this command, not to mutable thread
     * state. The server re-authorizes and freezes both values on the run/input.
     */
    scope: StudioAgentThreadScopeSchema,
    locale: z.string().trim().min(2).max(32),
    targetRunId: StudioAgentIdSchema.nullable(),
    delivery: StudioAgentInputDeliverySchema.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.targetRunId === null) !== (request.delivery === null)) {
      context.addIssue({
        code: "custom",
        message: "targetRunId and delivery must either both be present or both be null.",
        path: ["delivery"],
      });
    }
  });

export const StudioAgentSubmitMessageResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    message: StudioAgentMessageSchema,
    run: StudioAgentRunSchema.nullable(),
    input: StudioAgentInputSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if ((result.run === null) === (result.input === null)) {
      context.addIssue({
        code: "custom",
        message: "A submitted message must create exactly one run or one input.",
        path: ["run"],
      });
    }
  });

/**
 * Composer uploads are confirmed by the media domain first, then registered
 * as an actor-owned, thread-scoped Studio Agent artifact. The returned
 * attachment part is the only canonical metadata a client may submit later.
 */
export const StudioAgentRegisterAttachmentRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    mediaAssetId: StudioAgentIdSchema,
    fileName: z.string().trim().min(1).max(255),
  })
  .strict();

export const StudioAgentRegisterAttachmentResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    attachment: StudioAgentAttachmentMessagePartSchema,
    created: z.boolean(),
  })
  .strict();

export const StudioAgentDeleteAttachmentResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    attachmentId: StudioAgentIdSchema,
    cleanupStatus: z.enum(["scheduled", "cleaned"]),
  })
  .strict();

export const StudioAgentEventPageSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    events: z.array(StudioAgentEventSchema),
    latestSequence: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

export const StudioAgentUpdatePermissionPolicyRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    expectedRevision: z.number().int().positive(),
    mode: StudioAgentPermissionModeSchema,
    rules: z.array(StudioAgentPermissionRuleSchema).max(256),
  })
  .strict();

export const StudioAgentResolveApprovalRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    decision: z.enum(["approved", "denied"]),
    actionInputHash: StudioAgentContentHashSchema,
    note: z.string().trim().max(2_000).nullable(),
    persistentGrant: z
      .object({
        expectedPolicyRevision: z.number().int().positive(),
        capability: StudioAgentManifestRefSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.decision === "denied" && request.persistentGrant !== null) {
      context.addIssue({
        code: "custom",
        message: "A denied action cannot create a persistent allow grant.",
        path: ["persistentGrant"],
      });
    }
  });

export const StudioAgentResolveApprovalResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    approval: StudioAgentApprovalSchema,
    permissionPolicy: StudioAgentPermissionPolicySchema,
  })
  .strict();

export const StudioAgentCancelRunRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

/**
 * Runtime-only command contracts. The runtime authenticates with its own
 * service credential; these endpoints are never exposed to a browser.
 */
export const StudioAgentExecuteActionRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    actionId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    inputHash: StudioAgentContentHashSchema,
  })
  .strict();

export const StudioAgentDenyActionRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    actionId: StudioAgentIdSchema,
    runId: StudioAgentIdSchema,
    approvalId: StudioAgentIdSchema,
    actionInputHash: StudioAgentContentHashSchema,
    disposition: z.enum(["denied", "expired", "cancelled"]),
    reason: z.string().trim().min(1).max(4_000),
    decidedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const StudioAgentRunTransitionBaseSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    workflow: StudioAgentWorkflowInputSchema,
  })
  .strict();

export const StudioAgentRunTransitionRequestSchema = z.discriminatedUnion("transition", [
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("start"),
  }).strict(),
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("wait"),
    reason: z.enum(["approval", "input"]),
    referenceId: StudioAgentIdSchema,
  }).strict(),
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("resume"),
    resumedFrom: z.enum(["approval", "input"]),
    referenceId: StudioAgentIdSchema,
  }).strict(),
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("complete"),
    outcome: StudioAgentModelStepOutcomeSchema,
  }).strict(),
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("fail"),
    error: StudioAgentErrorSchema,
  }).strict(),
  StudioAgentRunTransitionBaseSchema.extend({
    transition: z.literal("cancel"),
    reason: z.string().trim().min(1).max(2_000),
    requestedByInputId: StudioAgentIdSchema.nullable(),
  }).strict(),
]);

export const StudioAgentEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z
    .object({
      code: z.literal(200),
      data,
    })
    .strict();

export type StudioAgentResolveThreadRequest = z.infer<typeof StudioAgentResolveThreadRequestSchema>;
export type StudioAgentResolveThreadResult = z.infer<typeof StudioAgentResolveThreadResultSchema>;
export type StudioAgentActivitySnapshot = z.infer<typeof StudioAgentActivitySnapshotSchema>;
export type StudioAgentTurnWindow = z.infer<typeof StudioAgentTurnWindowSchema>;
export type StudioAgentThreadSnapshot = z.infer<typeof StudioAgentThreadSnapshotSchema>;
export type StudioAgentSubmitMessageRequest = z.infer<typeof StudioAgentSubmitMessageRequestSchema>;
export type StudioAgentSubmitMessageResult = z.infer<typeof StudioAgentSubmitMessageResultSchema>;
export type StudioAgentRegisterAttachmentRequest = z.infer<
  typeof StudioAgentRegisterAttachmentRequestSchema
>;
export type StudioAgentRegisterAttachmentResult = z.infer<
  typeof StudioAgentRegisterAttachmentResultSchema
>;
export type StudioAgentDeleteAttachmentResult = z.infer<
  typeof StudioAgentDeleteAttachmentResultSchema
>;
export type StudioAgentEventPage = z.infer<typeof StudioAgentEventPageSchema>;
export type StudioAgentUpdatePermissionPolicyRequest = z.infer<
  typeof StudioAgentUpdatePermissionPolicyRequestSchema
>;
export type StudioAgentResolveApprovalRequest = z.infer<
  typeof StudioAgentResolveApprovalRequestSchema
>;
export type StudioAgentResolveApprovalResult = z.infer<
  typeof StudioAgentResolveApprovalResultSchema
>;
export type StudioAgentCancelRunRequest = z.infer<typeof StudioAgentCancelRunRequestSchema>;
export type StudioAgentExecuteActionRequest = z.infer<typeof StudioAgentExecuteActionRequestSchema>;
export type StudioAgentDenyActionRequest = z.infer<typeof StudioAgentDenyActionRequestSchema>;
export type StudioAgentRunTransitionRequest = z.infer<typeof StudioAgentRunTransitionRequestSchema>;

export { STUDIO_AGENT_SCHEMA_VERSION };
