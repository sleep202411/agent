import { z } from "zod";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionSchema,
  StudioAgentActivityKindSchema,
  StudioAgentApprovalSchema,
  StudioAgentAttachmentMessagePartSchema,
  StudioAgentContentHashSchema,
  StudioAgentDeliveryTriggerSchema,
  StudioAgentErrorSchema,
  StudioAgentIdSchema,
  StudioAgentInputSchema,
  StudioAgentManifestRefSchema,
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

export const StudioAgentUpdatePermissionPolicyRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    expectedRevision: z.number().int().positive(),
    mode: StudioAgentPermissionModeSchema,
    rules: z.array(StudioAgentPermissionRuleSchema).max(256),
  })
  .strict();

export const StudioAgentCancelRunRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    reason: z.string().trim().min(1).max(2_000),
  })
  .strict();

/**
 * Retire this thread so the next resolve opens a fresh one.
 *
 * "New conversation" is a status flip, not a delete. `findActiveThread` filters
 * on `status: 'active'` and nothing enforces one thread per scope, so archiving
 * is the whole mechanism: the next resolve finds nothing active and creates a
 * new thread, with a new id, a new Ably channel, and an empty transcript. The
 * retired thread keeps every row it owns — runs, actions, approvals and their
 * composite foreign keys are untouched — it simply stops being reachable,
 * because nothing lists archived threads.
 *
 * Deliberately unconditional, even mid-turn. A creator who asks for a new
 * conversation has already decided this one is over, and refusing while a run
 * looks live would strand anyone whose thread is wedged — a workflow that dies
 * without reporting leaves `activeRunId` pointing at a run that never
 * terminalizes, and every later message on that thread 409s. This endpoint is
 * that escape hatch, so it terminalizes what it finds rather than depending on
 * it being terminalizable.
 */
export const StudioAgentArchiveThreadResponseSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    threadId: StudioAgentIdSchema,
    /** Runs this archive had to end because nothing else was going to. */
    cancelledRunIds: z.array(StudioAgentIdSchema),
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

/**
 * Workflow to delivery: publish the run's terminal on the conversation channel.
 *
 * Not an HTTP contract — it is the argument of the `closeAgentRun` Temporal
 * activity, and it lives here because the workflow (which may not import the
 * transport) and the activity (which does) both need its shape.
 *
 * `reason` is deliberately the transport's vocabulary, not ours: a run ends
 * `complete`, `cancelled` or `error` on the wire, while Postgres keeps the
 * richer `StudioAgentRun.status`.
 *
 * `error` is the COARSE failure, stamped on `ai-run-end` as an
 * `Ably.ErrorInfo`. It is not a duplicate of the rich
 * `data-studio-agent-failure` part: that part is published by the model step,
 * so a run that failed BEFORE its first step — an open that failed, a control
 * plane that refused the turn — has no step to publish it and the terminal is
 * the only thing the creator will ever receive. Null for `complete` and
 * `cancelled`, and for an error whose detail already travelled as a part.
 */
export const StudioAgentCloseRunRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    workflow: StudioAgentWorkflowInputSchema,
    reason: z.enum(["complete", "cancelled", "error"]),
    error: StudioAgentErrorSchema.nullable(),
  })
  .strict();

/**
 * Workflow to delivery: put the run on the channel, or put it back.
 *
 * ONE ACTIVITY, TWO LIFECYCLE EVENTS, AND THE LIBRARY PICKS WHICH. `createRun`
 * publishes `ai-run-start` for a fresh trigger and `ai-run-resume` for one whose
 * `ai-input` carries a `run-id` header — `agent-session.ts`'s
 * `resolveTriggerMetadata` sets `resolvedContinuation` from exactly that, and
 * `startRun` branches on it. The worker therefore does NOT choose; it hands over
 * the trigger it was given and the wire says what this is. Which is why the
 * trigger is a parameter and not read off `workflow.delivery`: the resume's
 * trigger is a different event, minted by the browser when the creator answered.
 */
export const StudioAgentOpenRunRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    workflow: StudioAgentWorkflowInputSchema,
    trigger: StudioAgentDeliveryTriggerSchema,
  })
  .strict();

/**
 * Workflow to delivery: publish `ai-run-suspend` so the panel stops saying
 * "working".
 *
 * The gap this closes was measured, not imagined: a run parked on an approval
 * sat 90+ seconds with the run still OPEN on the channel, so every subscriber
 * — including a second creator watching the same thread — rendered a spinner
 * for a turn that was waiting on a button nobody had told them about. A suspend
 * is not a terminal: the run stays live and `createRun().start()` on the
 * approval's trigger resumes it under the same run id.
 */
export const StudioAgentSuspendRunRequestSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    workflow: StudioAgentWorkflowInputSchema,
  })
  .strict();

/** Runtime to control plane: commit the creator's approval decisions. */
export const StudioAgentResolveApprovalResultSchema = z
  .object({
    schemaVersion: StudioAgentSchemaVersionSchema,
    approvals: z.array(StudioAgentApprovalSchema).min(1).max(128),
  })
  .strict();

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
export type StudioAgentRegisterAttachmentRequest = z.infer<
  typeof StudioAgentRegisterAttachmentRequestSchema
>;
export type StudioAgentRegisterAttachmentResult = z.infer<
  typeof StudioAgentRegisterAttachmentResultSchema
>;
export type StudioAgentDeleteAttachmentResult = z.infer<
  typeof StudioAgentDeleteAttachmentResultSchema
>;
export type StudioAgentUpdatePermissionPolicyRequest = z.infer<
  typeof StudioAgentUpdatePermissionPolicyRequestSchema
>;
export type StudioAgentResolveApprovalResult = z.infer<
  typeof StudioAgentResolveApprovalResultSchema
>;
export type StudioAgentCancelRunRequest = z.infer<typeof StudioAgentCancelRunRequestSchema>;
export type StudioAgentArchiveThreadResponse = z.infer<
  typeof StudioAgentArchiveThreadResponseSchema
>;
export type StudioAgentExecuteActionRequest = z.infer<typeof StudioAgentExecuteActionRequestSchema>;
export type StudioAgentDenyActionRequest = z.infer<typeof StudioAgentDenyActionRequestSchema>;
export type StudioAgentRunTransitionRequest = z.infer<typeof StudioAgentRunTransitionRequestSchema>;
export type StudioAgentCloseRunRequest = z.infer<typeof StudioAgentCloseRunRequestSchema>;
export type StudioAgentOpenRunRequest = z.infer<typeof StudioAgentOpenRunRequestSchema>;
export type StudioAgentSuspendRunRequest = z.infer<typeof StudioAgentSuspendRunRequestSchema>;

export { STUDIO_AGENT_SCHEMA_VERSION };
