import type { InvocationData } from "@ably/ai-transport";
import type { PendingToolCall } from "@ably/ai-transport/vercel";
import { z } from "zod";

import { agentSessionContextSchema } from "../context/agent-context.js";

const identifierSchema = z.string().min(1).max(256);
const sessionNameSchema = z.string().min(1).max(512);
const publicErrorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const publicMessageKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]*$/u);

export const OPEN_RUN_MAX_ATTEMPTS = 5;
export const ENQUEUE_AGENT_INVOCATION_UPDATE = "enqueueFizzDragonAgentInvocation";
export const CANCEL_AGENT_INVOCATION_UPDATE = "cancelFizzDragonAgentInvocation";
export const RECENT_ATTEMPT_ID_LIMIT = 4_096;
export const AGGREGATE_ATTEMPT_CURSOR_LIMIT = 4_096;
export const LIFECYCLE_REPAIR_CYCLES_PER_RUN = 8;

export const agentInvocationCommandSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-command/v1"),
    invocation: z
      .object({
        inputEventId: identifierSchema,
        sessionName: sessionNameSchema,
      })
      .strict(),
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    provisionalRunId: z.string().uuid(),
    maxModelSteps: z.number().int().min(1).max(128),
    context: agentSessionContextSchema,
  })
  .strict()
  .superRefine((command, issueContext) => {
    if (command.invocation.sessionName !== command.context.sessionName) {
      issueContext.addIssue({
        code: "custom",
        path: ["invocation", "sessionName"],
        message: "invocation sessionName must match the signed agent context",
      });
    }
  });

export type AgentInvocationCommand = Omit<
  z.infer<typeof agentInvocationCommandSchema>,
  "invocation"
> & {
  invocation: InvocationData;
};

export const agentInvocationAdmissionSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-admission/v1"),
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    status: z.enum(["accepted", "already-accepted", "queue-full", "sequence-conflict"]),
  })
  .strict();

export type AgentInvocationAdmission = z.infer<typeof agentInvocationAdmissionSchema>;

export const agentCancellationCommandSchema = z
  .object({
    schemaVersion: z.literal("agent-cancellation-command/v1"),
    sessionName: sessionNameSchema,
    invocationId: z.string().uuid(),
  })
  .strict();

export type AgentCancellationCommand = z.infer<typeof agentCancellationCommandSchema>;

export const agentCancellationResultSchema = z
  .object({
    schemaVersion: z.literal("agent-cancellation-result/v1"),
    invocationId: z.string().uuid(),
    status: z.enum(["cancellation-requested", "already-terminal", "not-active"]),
  })
  .strict();

export type AgentCancellationResult = z.infer<typeof agentCancellationResultSchema>;

export const durableAttemptIdentitySchema = z
  .object({
    invocationId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
  })
  .strict();

export type DurableAttemptIdentity = z.infer<typeof durableAttemptIdentitySchema>;

export const aggregateAttemptCursorSchema = durableAttemptIdentitySchema
  .extend({
    phase: z.enum(["admitted", "waiting_for_approval", "terminal"]),
  })
  .strict();

export type AggregateAttemptCursor = z.infer<typeof aggregateAttemptCursorSchema>;

export const agentSessionWorkflowInputSchema = z
  .object({
    schemaVersion: z.literal("agent-session-workflow/v2"),
    sessionName: sessionNameSchema,
    pendingInvocations: z.array(agentInvocationCommandSchema).max(512),
    cancelledPendingInvocationIds: z.array(z.string().uuid()).max(512),
    recentAttempts: z.array(durableAttemptIdentitySchema).max(RECENT_ATTEMPT_ID_LIMIT),
    aggregateAttempts: z.array(aggregateAttemptCursorSchema).max(AGGREGATE_ATTEMPT_CURSOR_LIMIT),
  })
  .strict()
  .superRefine((input, issueContext) => {
    const seenAttempts = new Set(input.recentAttempts.map((attempt) => attempt.attemptId));
    if (seenAttempts.size !== input.recentAttempts.length) {
      issueContext.addIssue({
        code: "custom",
        path: ["recentAttempts"],
        message: "recent attempt identities must be unique",
      });
    }
    const aggregateCursors = new Map(
      input.aggregateAttempts.map((cursor) => [cursor.invocationId, cursor])
    );
    if (aggregateCursors.size !== input.aggregateAttempts.length) {
      issueContext.addIssue({
        code: "custom",
        path: ["aggregateAttempts"],
        message: "aggregate attempt cursors must be unique by invocation",
      });
    }
    const pendingIds = new Set<string>();
    for (const [index, command] of input.pendingInvocations.entries()) {
      if (
        command.invocation.sessionName !== input.sessionName ||
        command.context.sessionName !== input.sessionName
      ) {
        issueContext.addIssue({
          code: "custom",
          path: ["pendingInvocations", index],
          message: "pending invocation must belong to the session Workflow",
        });
      }
      if (seenAttempts.has(command.attemptId)) {
        issueContext.addIssue({
          code: "custom",
          path: ["pendingInvocations", index, "attemptId"],
          message: "pending and recent attempt identities must be unique",
        });
      }
      seenAttempts.add(command.attemptId);
      if (pendingIds.has(command.invocationId)) {
        issueContext.addIssue({
          code: "custom",
          path: ["pendingInvocations", index, "invocationId"],
          message: "an aggregate may have only one admitted pending attempt",
        });
      }
      pendingIds.add(command.invocationId);
      const cursor = aggregateCursors.get(command.invocationId);
      if (
        !cursor ||
        cursor.phase !== "admitted" ||
        cursor.attemptId !== command.attemptId ||
        cursor.attemptOrdinal !== command.attemptOrdinal
      ) {
        issueContext.addIssue({
          code: "custom",
          path: ["pendingInvocations", index],
          message: "pending invocation must match its admitted aggregate cursor",
        });
      }
    }
    for (const [index, cursor] of input.aggregateAttempts.entries()) {
      if (cursor.phase === "admitted" && !pendingIds.has(cursor.invocationId)) {
        issueContext.addIssue({
          code: "custom",
          path: ["aggregateAttempts", index],
          message: "an admitted aggregate cursor must have one pending attempt",
        });
      }
    }
    for (const [index, invocationId] of input.cancelledPendingInvocationIds.entries()) {
      if (!pendingIds.has(invocationId)) {
        issueContext.addIssue({
          code: "custom",
          path: ["cancelledPendingInvocationIds", index],
          message: "cancelled pending invocation must exist in the pending queue",
        });
      }
    }
    if (
      new Set(input.cancelledPendingInvocationIds).size !==
      input.cancelledPendingInvocationIds.length
    ) {
      issueContext.addIssue({
        code: "custom",
        path: ["cancelledPendingInvocationIds"],
        message: "cancelled pending invocation identities must be unique",
      });
    }
  });

export type AgentSessionWorkflowInput = Omit<
  z.infer<typeof agentSessionWorkflowInputSchema>,
  "pendingInvocations"
> & {
  pendingInvocations: AgentInvocationCommand[];
};

export const agentPublicErrorSchema = z
  .object({
    code: publicErrorCodeSchema,
    retryable: z.boolean(),
    messageKey: publicMessageKeySchema,
    message: z.string().min(1).max(1_000),
    diagnosticId: z.uuid(),
  })
  .strict();

export type AgentPublicError = z.infer<typeof agentPublicErrorSchema>;

export const agentInvocationLifecycleStatusSchema = z.enum([
  "running",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

export type AgentInvocationLifecycleStatus = z.infer<typeof agentInvocationLifecycleStatusSchema>;

export const agentInvocationLifecycleProjectionSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-lifecycle-projection/v1"),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    runId: z.uuid(),
    context: agentSessionContextSchema,
    status: agentInvocationLifecycleStatusSchema,
    error: agentPublicErrorSchema.nullable(),
  })
  .strict()
  .superRefine((projection, issueContext) => {
    if ((projection.status === "failed") !== (projection.error !== null)) {
      issueContext.addIssue({
        code: "custom",
        path: ["error"],
        message: "error must be present exactly when lifecycle status is failed",
      });
    }
  });

export type AgentInvocationLifecycleProjection = z.infer<
  typeof agentInvocationLifecycleProjectionSchema
>;

export const lifecycleProjectionWorkflowInputSchema = z
  .object({
    schemaVersion: z.literal("agent-lifecycle-projection-workflow/v1"),
    pendingProjections: z.array(agentInvocationLifecycleProjectionSchema).min(1).max(16),
    repairCycle: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((input, issueContext) => {
    const invocationIds = new Set(
      input.pendingProjections.map((projection) => projection.invocationId)
    );
    if (invocationIds.size !== 1) {
      issueContext.addIssue({
        code: "custom",
        path: ["pendingProjections"],
        message: "a lifecycle projector may own only one invocation",
      });
    }
  });

export type LifecycleProjectionWorkflowInput = z.infer<
  typeof lifecycleProjectionWorkflowInputSchema
>;

export type DurableRunIds = Readonly<{
  runId: string;
  invocationId: string;
  triggerEventId: string;
}>;

export type OpenRunResult =
  | Readonly<{
      kind: "opened";
      ids: DurableRunIds;
      approvedToolCalls: ReadonlyArray<PendingToolCall>;
    }>
  | Readonly<{
      kind: "already-terminal";
      runId: string;
      status: "complete" | "cancelled" | "error";
    }>;

export type InferenceActivityResult =
  | Readonly<{
      kind: "tool-calls";
      toolCalls: ReadonlyArray<PendingToolCall>;
    }>
  | Readonly<{ kind: "continue" }>
  | Readonly<{
      kind: "awaiting-approval";
      toolCallIds: ReadonlyArray<string>;
    }>
  | Readonly<{ kind: "complete" }>
  | Readonly<{ kind: "cancelled" }>;
