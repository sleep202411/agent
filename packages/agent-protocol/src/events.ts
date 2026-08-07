import { z } from "zod";

import { AgentOsIdSchema, AgentOsIsoTimestampSchema, AgentOsNonEmptyIdSchema } from "./ids.js";
import { FizzAgentProtocolVersionSchema } from "./protocol.js";
export const AgentEventTypeSchema = z.enum([
  "RunStarted",
  "MessageStarted",
  "MessageDelta",
  "MessageCompleted",
  "PlanCreated",
  "PlanUpdated",
  "StepStarted",
  "StepProgress",
  "StepCompleted",
  "ToolProposed",
  "ApprovalRequired",
  "ApprovalResolved",
  "ToolStarted",
  "ToolProgress",
  "ToolCompleted",
  "ToolFailed",
  "ArtifactCreated",
  "ArtifactUpdated",
  "ProjectPatchProposed",
  "ProjectPatchApplied",
  "RunPaused",
  "RunResumed",
  "RunCancelled",
  "RunCompleted",
  "RunFailed",
]);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

const envelopeBase = {
  id: AgentOsIdSchema,
  protocolVersion: FizzAgentProtocolVersionSchema,
  sessionId: AgentOsNonEmptyIdSchema,
  runId: AgentOsIdSchema,
  conversationId: AgentOsIdSchema,
  /** Monotonic per conversation (or per run — Gateway documents the stream key). */
  sequence: z.number().int().nonnegative(),
  timestamp: AgentOsIsoTimestampSchema,
} as const;

export const AgentEventEnvelopeSchema = z
  .object({
    ...envelopeBase,
    type: AgentEventTypeSchema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>;

export const RunStartedDataSchema = z
  .object({
    status: z.literal("running"),
    workspaceType: z.string().min(1),
    modelProfileId: z.string().min(1),
  })
  .strict();

export const MessageDeltaDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    delta: z.string().min(1).max(16_384),
  })
  .strict();

export const MessageCompletedDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    text: z.string().max(200_000),
  })
  .strict();

export const ToolProposedDataSchema = z
  .object({
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()),
    risk: z.enum(["read", "reversible", "sensitive", "critical"]),
  })
  .strict();

export const ApprovalRequiredDataSchema = z
  .object({
    approvalId: AgentOsIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    title: z.string().min(1).max(240),
    description: z.string().min(1).max(8_000),
    estimatedCredits: z.number().nonnegative().optional(),
    reversible: z.boolean(),
    actions: z
      .array(z.enum(["approve", "edit_and_approve", "reject"]))
      .min(1)
      .max(3),
  })
  .strict();

export const ApprovalResolvedDataSchema = z
  .object({
    approvalId: AgentOsIdSchema,
    decision: z.enum(["approve", "edit_and_approve", "reject"]),
  })
  .strict();

export const ToolCompletedDataSchema = z
  .object({
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    result: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ToolFailedDataSchema = z
  .object({
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

export const ProjectPatchProposedDataSchema = z
  .object({
    previewId: AgentOsIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    title: z.string().min(1).max(160).optional(),
    summary: z.string().min(1).max(4_000).optional(),
    operationCount: z.number().int().positive(),
  })
  .strict();

export const ProjectPatchAppliedDataSchema = z
  .object({
    previewId: AgentOsIdSchema.optional(),
    toolCallId: AgentOsNonEmptyIdSchema,
    projectVersion: z.number().int().nonnegative(),
  })
  .strict();

export const RunTerminalDataSchema = z
  .object({
    status: z.enum(["completed", "failed", "cancelled"]),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(4_000),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function assertMonotonicSequence(previous: number, next: number): void {
  if (!Number.isInteger(next) || next < 0) {
    throw new Error(`Invalid event sequence: ${next}`);
  }
  if (next <= previous) {
    throw new Error(`Event sequence must be strictly monotonic: previous=${previous} next=${next}`);
  }
}
