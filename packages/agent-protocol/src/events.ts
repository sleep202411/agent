import { z } from "zod";

import { AgentOsIdSchema, AgentOsIsoTimestampSchema, AgentOsNonEmptyIdSchema } from "./ids.js";
import { AgentDisplayLocaleSchema } from "./hitl.js";
import { FizzAgentProtocolVersionSchema } from "./protocol.js";
export const AgentEventTypeSchema = z.enum([
  "RunStarted",
  /** Durable user turn text for transcript restore after panel close / reload. */
  "UserMessage",
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
  "UserInputRequired",
  "UserInputResolved",
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

/**
 * One durable user submission and the Assistant activity/messages it causes.
 * A single Agent run may contain multiple turns when it pauses for HITL.
 */
export const AgentTurnIdSchema = AgentOsIdSchema;
export type AgentTurnId = z.infer<typeof AgentTurnIdSchema>;

export const AgentMessageSegmentKindSchema = z.enum([
  "lead_in",
  "acknowledgement",
  "response",
  "result",
]);
export type AgentMessageSegmentKind = z.infer<typeof AgentMessageSegmentKindSchema>;

export const AgentMessageFinishReasonSchema = z.enum([
  "stop",
  "tool_call",
  "external_result",
  /**
   * A durable partial segment that was closed during crash recovery because
   * its LangGraph checkpoint could not prove that appending to it was safe.
   * Projectors must not present this segment as Assistant output.
   */
  "superseded",
  "cancelled",
  "failed",
]);
export type AgentMessageFinishReason = z.infer<typeof AgentMessageFinishReasonSchema>;

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
    turnId: AgentTurnIdSchema,
    status: z.literal("running"),
    workspaceType: z.string().min(1),
    modelProfileId: z.string().min(1),
    projectKind: z.string().min(1).optional(),
    workbenchMode: z.string().min(1).optional(),
    workbenchContext: z.record(z.string(), z.string()).optional(),
    skillIds: z.array(z.string().min(1)).optional(),
    projectSkillResolutionId: z.string().min(1).optional(),
    projectSkillVersionIds: z.array(z.string().min(1)).optional(),
    projectSkillChecksum: z.string().min(1).optional(),
    toolIds: z.array(z.string().min(1)).optional(),
    skippedSkillIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const AgentUserMessageAttachmentSchema = z
  .object({
    id: AgentOsIdSchema,
    filename: z.string().trim().min(1).max(500),
  })
  .strict();
export type AgentUserMessageAttachment = z.infer<typeof AgentUserMessageAttachmentSchema>;

export const UserMessageDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    turnId: AgentTurnIdSchema,
    /** Exact user-authored text. Empty is valid only for an attachment-only turn. */
    text: z.string().max(20_000),
    /** Ordered display metadata only; attachment contents remain outside the transcript. */
    attachments: z.array(AgentUserMessageAttachmentSchema).min(1).max(20).optional(),
    /**
     * A user action submitted through Agent UI is still a real user message.
     * Keep its structured value beside the human-readable transcript text so
     * the interaction can be correlated, replayed, and rendered after reload.
     */
    interaction: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("user_input"),
            requestId: AgentOsIdSchema,
            responseId: AgentOsIdSchema,
            answers: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(64)),
          })
          .strict(),
        z
          .object({
            kind: z.literal("approval"),
            approvalId: AgentOsIdSchema,
            /** Stable identity for one semantic decision across transport retries. */
            responseId: AgentOsIdSchema,
            decision: z.enum(["approve", "edit_and_approve", "reject"]),
            /** Locale of the durable display copy; not authorization state. */
            locale: AgentDisplayLocaleSchema,
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((data) => data.text.trim().length > 0 || Boolean(data.attachments?.length), {
    message: "UserMessage requires text or at least one attachment",
    path: ["text"],
  });

const UserMessageWriteDataSchema = UserMessageDataSchema.refine(
  (data) =>
    data.interaction?.kind !== "approval" || data.interaction.decision !== "edit_and_approve",
  {
    message: "edit_and_approve is not implemented by the current approval contract",
    path: ["interaction", "decision"],
  }
);

export const MessageStartedDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    turnId: AgentTurnIdSchema,
    segmentKind: AgentMessageSegmentKindSchema,
  })
  .strict();

export const MessageDeltaDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    turnId: AgentTurnIdSchema,
    delta: z.string().min(1).max(16_384),
  })
  .strict();

export const MessageCompletedDataSchema = z
  .object({
    messageId: AgentOsNonEmptyIdSchema,
    turnId: AgentTurnIdSchema,
    text: z.string().max(200_000),
    finishReason: AgentMessageFinishReasonSchema,
  })
  .strict();

export const ToolProposedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()),
    risk: z.enum(["read", "reversible", "sensitive", "critical"]),
  })
  .strict();

/**
 * Durable, domain-owned content which is rendered inside an Assistant turn.
 * The Agent journal stores only the immutable identity and correlation data;
 * the referenced domain record remains the authority for the rich payload.
 */
export const StoryStageProposalArtifactReferenceSchema = z
  .object({
    kind: z.literal("story_stage_proposal"),
    storyAgentRunId: AgentOsIdSchema,
    storyProjectId: AgentOsIdSchema,
    storyChapterId: AgentOsIdSchema,
    workspaceId: AgentOsIdSchema,
    stage: z.enum(["script", "plot", "assets", "storyboard", "noop", "patch"]),
    schemaVersion: z.string().trim().min(1).max(128),
  })
  .strict();
export type StoryStageProposalArtifactReference = z.infer<
  typeof StoryStageProposalArtifactReferenceSchema
>;

/**
 * A creator-confirmed Story media batch. The journal owns only this immutable
 * correlation; queue state and generated media remain authoritative in the
 * Story generation domain and can therefore keep changing after the Agent run
 * itself has completed.
 */
export const StoryGenerationBatchArtifactReferenceSchema = z
  .object({
    kind: z.literal("story_generation_batch"),
    generationBatchId: AgentOsIdSchema,
    storyProjectId: AgentOsIdSchema,
    storyChapterId: AgentOsIdSchema,
    /** Replay compatibility for journals written before Project Scope. */
    workspaceId: AgentOsIdSchema.optional(),
    schemaVersion: z.literal("story-generation-batch-artifact/v1"),
  })
  .strict();
export type StoryGenerationBatchArtifactReference = z.infer<
  typeof StoryGenerationBatchArtifactReferenceSchema
>;

export const AgentArtifactReferenceSchema = z.discriminatedUnion("kind", [
  StoryStageProposalArtifactReferenceSchema,
  StoryGenerationBatchArtifactReferenceSchema,
]);
export type AgentArtifactReference = z.infer<typeof AgentArtifactReferenceSchema>;

export const AgentArtifactStatusSchema = z.enum([
  "proposed",
  "active",
  "applying",
  "applied",
  "rejected",
  "failed",
  "cancelled",
]);
export type AgentArtifactStatus = z.infer<typeof AgentArtifactStatusSchema>;

export const ArtifactCreatedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    artifactId: AgentOsIdSchema,
    artifact: AgentArtifactReferenceSchema,
    status: z.enum(["proposed", "active"]),
  })
  .strict();
export type ArtifactCreatedData = z.infer<typeof ArtifactCreatedDataSchema>;

export const ArtifactUpdatedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    artifactId: AgentOsIdSchema,
    status: AgentArtifactStatusSchema.exclude(["proposed", "active"]),
  })
  .strict();
export type ArtifactUpdatedData = z.infer<typeof ArtifactUpdatedDataSchema>;

export const ApprovalRequiredDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
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

const ApprovalRequiredWriteDataSchema = ApprovalRequiredDataSchema.refine(
  (data) => !data.actions.includes("edit_and_approve"),
  {
    message: "edit_and_approve is not implemented by the current approval contract",
    path: ["actions"],
  }
);

export const ApprovalResolvedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    approvalId: AgentOsIdSchema,
    /** Stable identity for one semantic decision across transport retries. */
    responseId: AgentOsIdSchema,
    decision: z.enum(["approve", "edit_and_approve", "reject"]),
  })
  .strict();

const ApprovalResolvedWriteDataSchema = ApprovalResolvedDataSchema.refine(
  (data) => data.decision !== "edit_and_approve",
  {
    message: "edit_and_approve is not implemented by the current approval contract",
    path: ["decision"],
  }
);

const UserInputOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(180).optional(),
  })
  .strict();

const UserInputQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    header: z.string().trim().min(1).max(40),
    question: z.string().trim().min(1).max(500),
    options: z.array(UserInputOptionSchema).min(2).max(12),
  })
  .strict();

export const UserInputRequiredDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    requestId: AgentOsIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    formId: z.string().trim().min(1).max(64).optional(),
    knownValues: z
      .record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(64))
      .optional(),
    resumeAcknowledgement: z.string().trim().min(1).max(1_000),
    questions: z.array(UserInputQuestionSchema).min(1).max(4),
  })
  .strict();

export const UserInputResolvedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    requestId: AgentOsIdSchema,
    responseId: AgentOsIdSchema,
    answers: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1).max(64)),
  })
  .strict();

export const ToolCompletedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    result: z.record(z.string(), z.unknown()).optional(),
    agentHandoff: z
      .object({
        kind: z.literal("external_job"),
        jobId: AgentOsIdSchema,
        startedMessage: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ToolFailedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    toolId: z.string().min(1).max(128),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(4_000),
    retryable: z.boolean(),
  })
  .strict();

export const ProjectPatchProposedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    previewId: AgentOsIdSchema,
    toolCallId: AgentOsNonEmptyIdSchema,
    title: z.string().min(1).max(160).optional(),
    summary: z.string().min(1).max(4_000).optional(),
    operationCount: z.number().int().positive(),
  })
  .strict();

export const ProjectPatchAppliedDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
    previewId: AgentOsIdSchema.optional(),
    toolCallId: AgentOsNonEmptyIdSchema,
    projectVersion: z.number().int().nonnegative(),
  })
  .strict();

const RunPauseWorkbenchContextShape = {
  projectKind: z.string().trim().min(1).max(64).optional(),
  workbenchMode: z.string().trim().min(1).max(64).optional(),
  workbenchContext: z.record(z.string(), z.string()).optional(),
} as const;

/**
 * A pause is either an Agent UI interaction or an external durable job. The
 * external correlation fields are deliberately absent from every other arm,
 * so a stale/mixed projection cannot accidentally attach a callback to an
 * approval or question-card pause.
 */
export const RunPausedDataSchema = z.discriminatedUnion("status", [
  z
    .object({
      turnId: AgentTurnIdSchema,
      status: z.literal("waiting_for_approval"),
      ...RunPauseWorkbenchContextShape,
    })
    .strict(),
  z
    .object({
      turnId: AgentTurnIdSchema,
      status: z.literal("waiting_for_input"),
      ...RunPauseWorkbenchContextShape,
    })
    .strict(),
  z
    .object({
      turnId: AgentTurnIdSchema,
      status: z.literal("waiting_for_external"),
      externalJobId: AgentOsIdSchema,
      toolCallId: AgentOsNonEmptyIdSchema,
      toolId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      turnId: AgentTurnIdSchema,
      status: z.literal("paused"),
      reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
]);

export const RunResumedDataSchema = z.discriminatedUnion("reason", [
  z
    .object({
      turnId: AgentTurnIdSchema,
      reason: z.literal("approval_resolved"),
      approvalId: AgentOsIdSchema,
    })
    .strict(),
  z
    .object({
      turnId: AgentTurnIdSchema,
      reason: z.literal("user_input_resolved"),
      requestId: AgentOsIdSchema,
    })
    .strict(),
  z
    .object({
      turnId: AgentTurnIdSchema,
      reason: z.enum(["external_job_completed", "external_job_failed", "external_job_cancelled"]),
      externalJobId: AgentOsIdSchema,
    })
    .strict(),
]);

export const RunTerminalDataSchema = z
  .object({
    turnId: AgentTurnIdSchema,
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

/**
 * New writers are strict even though the replay envelope remains permissive
 * enough to read journals produced before turnId existed. This split lets us
 * restore old conversations without allowing current producers to regress to
 * uncorrelated `data: record` payloads.
 */
const TurnScopedEventDataSchema = z.object({ turnId: AgentTurnIdSchema }).passthrough();

export function parseAgentEventDataForWrite(
  type: AgentEventType,
  data: Record<string, unknown>
): Record<string, unknown> {
  switch (type) {
    case "RunStarted":
      return RunStartedDataSchema.parse(data);
    case "UserMessage":
      return UserMessageWriteDataSchema.parse(data);
    case "MessageStarted":
      return MessageStartedDataSchema.parse(data);
    case "MessageDelta":
      return MessageDeltaDataSchema.parse(data);
    case "MessageCompleted":
      return MessageCompletedDataSchema.parse(data);
    case "ToolProposed":
      return ToolProposedDataSchema.parse(data);
    case "ArtifactCreated":
      return ArtifactCreatedDataSchema.parse(data);
    case "ArtifactUpdated":
      return ArtifactUpdatedDataSchema.parse(data);
    case "ApprovalRequired":
      return ApprovalRequiredWriteDataSchema.parse(data);
    case "ApprovalResolved":
      return ApprovalResolvedWriteDataSchema.parse(data);
    case "UserInputRequired":
      return UserInputRequiredDataSchema.parse(data);
    case "UserInputResolved":
      return UserInputResolvedDataSchema.parse(data);
    case "ToolCompleted":
      return ToolCompletedDataSchema.parse(data);
    case "ToolFailed":
      return ToolFailedDataSchema.parse(data);
    case "ProjectPatchProposed":
      return ProjectPatchProposedDataSchema.parse(data);
    case "ProjectPatchApplied":
      return ProjectPatchAppliedDataSchema.parse(data);
    case "RunPaused":
      return RunPausedDataSchema.parse(data);
    case "RunResumed":
      return RunResumedDataSchema.parse(data);
    case "RunCompleted":
    case "RunFailed":
    case "RunCancelled":
      return RunTerminalDataSchema.parse(data);
    default:
      return TurnScopedEventDataSchema.parse(data);
  }
}

export function assertMonotonicSequence(previous: number, next: number): void {
  if (!Number.isInteger(next) || next < 0) {
    throw new Error(`Invalid event sequence: ${next}`);
  }
  if (next <= previous) {
    throw new Error(`Event sequence must be strictly monotonic: previous=${previous} next=${next}`);
  }
}
