import { z } from "zod";

const agentPlatformIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const agentPlatformInputEventIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const agentPlatformConversationIdSchema = z.uuid();
const agentPlatformStoryIdSchema = z.uuid();
const agentPublicErrorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/);
const agentPublicMessageKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const agentPlatformLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "Invalid BCP 47 locale")
  .transform((value) => Intl.getCanonicalLocales(value)[0]);

const storyScopeRequestShape = {
  surface: z.literal("story-studio"),
  workspaceId: agentPlatformStoryIdSchema,
  projectId: agentPlatformStoryIdSchema,
  locale: agentPlatformLocaleSchema,
} as const;

const crewScopeRequestShape = {
  surface: z.literal("crew-management"),
  crewId: agentPlatformIdentifierSchema,
  locale: agentPlatformLocaleSchema,
} as const;

export const AgentPlatformPermissionModeSchema = z.enum(["ask", "smart", "full"]);
export type AgentPlatformPermissionMode = z.infer<typeof AgentPlatformPermissionModeSchema>;

export const AgentConversationResolveRequestSchema = z.discriminatedUnion("surface", [
  z
    .object({
      schemaVersion: z.literal("agent-conversation-resolve/v1"),
      ...storyScopeRequestShape,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("agent-conversation-resolve/v1"),
      ...crewScopeRequestShape,
    })
    .strict(),
]);

export type AgentConversationResolveRequest = z.infer<typeof AgentConversationResolveRequestSchema>;

export const AgentConversationCreateRequestSchema = z.discriminatedUnion("surface", [
  z
    .object({
      schemaVersion: z.literal("agent-conversation-create/v1"),
      ...storyScopeRequestShape,
      permissionMode: AgentPlatformPermissionModeSchema.optional(),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal("agent-conversation-create/v1"),
      ...crewScopeRequestShape,
      permissionMode: AgentPlatformPermissionModeSchema.optional(),
    })
    .strict(),
]);

export type AgentConversationCreateRequest = z.infer<typeof AgentConversationCreateRequestSchema>;

export const AgentSessionGrantRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-session-grant-request/v1"),
    conversationId: agentPlatformConversationIdSchema,
    locale: agentPlatformLocaleSchema,
  })
  .strict();

export type AgentSessionGrantRequest = z.infer<typeof AgentSessionGrantRequestSchema>;

export const AgentConversationPreferenceRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-conversation-preference/v1"),
    conversationId: agentPlatformConversationIdSchema,
    locale: agentPlatformLocaleSchema,
    permissionMode: AgentPlatformPermissionModeSchema,
  })
  .strict();

export type AgentConversationPreferenceRequest = z.infer<
  typeof AgentConversationPreferenceRequestSchema
>;

export function canonicalAgentSessionName(conversationId: string): string {
  return `agent:v1:conversation:${agentPlatformConversationIdSchema.parse(conversationId)}`;
}

export const AgentInvocationGatewayRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-gateway/v1"),
    conversationId: agentPlatformConversationIdSchema,
    inputEventId: agentPlatformInputEventIdSchema,
    clientMessageId: z.string().trim().min(1).max(512),
    /**
     * Present only for an AI SDK continuation (approval/tool-result response).
     * The transport publishes a new input event but reuses the original Ably
     * run; this pointer makes the product aggregate follow the same identity.
     */
    continuationOfInvocationId: z.uuid().optional(),
    sessionName: z.string().trim().min(1).max(128),
    locale: agentPlatformLocaleSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sessionName !== canonicalAgentSessionName(request.conversationId)) {
      context.addIssue({
        code: "custom",
        path: ["sessionName"],
        message: "sessionName does not match the conversation identity",
      });
    }
  });

export type AgentInvocationGatewayRequest = z.infer<typeof AgentInvocationGatewayRequestSchema>;

export const AgentCancellationGatewayRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-cancellation-gateway/v1"),
    conversationId: agentPlatformConversationIdSchema,
    invocationId: z.uuid(),
    locale: agentPlatformLocaleSchema,
  })
  .strict();

export type AgentCancellationGatewayRequest = z.infer<typeof AgentCancellationGatewayRequestSchema>;

export const AgentHistoryGatewayRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-history-gateway/v1"),
    conversationId: agentPlatformConversationIdSchema,
    locale: agentPlatformLocaleSchema,
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export type AgentHistoryGatewayRequest = z.infer<typeof AgentHistoryGatewayRequestSchema>;

export const AgentConversationSummarySchema = z
  .object({
    id: agentPlatformConversationIdSchema,
    surface: z.enum(["story-studio", "crew-management"]),
    title: z.string().trim().min(1).max(240).nullable(),
    permissionMode: AgentPlatformPermissionModeSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type AgentConversationSummary = z.infer<typeof AgentConversationSummarySchema>;

export const AgentConversationGrantSchema = z
  .object({
    schemaVersion: z.literal("agent-conversation-grant/v1"),
    conversation: AgentConversationSummarySchema,
    sessionName: z.string().trim().min(1).max(128),
    ablyToken: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.sessionName !== canonicalAgentSessionName(grant.conversation.id)) {
      context.addIssue({
        code: "custom",
        path: ["sessionName"],
        message: "sessionName does not match the conversation identity",
      });
    }
  });

export type AgentConversationGrant = z.infer<typeof AgentConversationGrantSchema>;

export const AgentInvocationAcceptedSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-accepted/v1"),
    invocationId: z.uuid(),
  })
  .strict();

export type AgentInvocationAccepted = z.infer<typeof AgentInvocationAcceptedSchema>;

/**
 * The only error shape allowed to cross the Agent runtime/product boundary.
 *
 * `messageKey` is the stable localization identity, `message` is the safe
 * English fallback, and `diagnosticId` correlates private telemetry without
 * leaking provider, transport, stack, or workflow internals into transcripts.
 */
export const AgentPublicErrorSchema = z
  .object({
    code: agentPublicErrorCodeSchema,
    messageKey: agentPublicMessageKeySchema,
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    diagnosticId: z.uuid(),
  })
  .strict();

export type AgentPublicError = z.infer<typeof AgentPublicErrorSchema>;

export const AgentInvocationLifecycleRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-lifecycle/v1"),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    conversationId: agentPlatformConversationIdSchema,
    runId: z.uuid(),
    status: z.enum(["running", "waiting_for_approval", "succeeded", "failed", "cancelled"]),
    error: AgentPublicErrorSchema.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.status === "failed") !== (request.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "error must be present exactly when status is failed",
      });
    }
  });

export type AgentInvocationLifecycleRequest = z.infer<typeof AgentInvocationLifecycleRequestSchema>;

export const AgentInvocationLifecycleAcknowledgementSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-lifecycle-ack/v1"),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
  })
  .strict();

export type AgentInvocationLifecycleAcknowledgement = z.infer<
  typeof AgentInvocationLifecycleAcknowledgementSchema
>;

export const AgentInvocationAttemptStatusSchema = z
  .object({
    attemptId: z.uuid(),
    ordinal: z.number().int().nonnegative(),
    inputEventId: agentPlatformInputEventIdSchema,
    clientMessageId: z.string().trim().min(1).max(512),
    status: z.enum(["admitting", "dispatched", "rejected"]),
    error: AgentPublicErrorSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if ((attempt.status === "rejected") !== (attempt.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "error must be present exactly when status is rejected",
      });
    }
  });

export type AgentInvocationAttemptStatus = z.infer<typeof AgentInvocationAttemptStatusSchema>;

export const AgentInvocationStatusSchema = z
  .object({
    invocationId: z.uuid(),
    runId: z.uuid(),
    clientMessageId: z.string().trim().min(1).max(512),
    inputEventId: agentPlatformInputEventIdSchema,
    status: z.enum([
      "admitting",
      "queued",
      "running",
      "waiting_for_approval",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    error: AgentPublicErrorSchema.nullable(),
    latestAttempt: AgentInvocationAttemptStatusSchema,
    createdAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).nullable(),
    completedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((invocation, context) => {
    if ((invocation.status === "failed") !== (invocation.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "error must be present exactly when status is failed",
      });
    }
  });

export type AgentInvocationStatus = z.infer<typeof AgentInvocationStatusSchema>;

export const AgentInvocationStatusRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-status-request/v1"),
    conversationId: agentPlatformConversationIdSchema,
    locale: agentPlatformLocaleSchema,
    sinceRevision: z
      .string()
      .max(19)
      .regex(/^(0|[1-9][0-9]*)$/)
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export type AgentInvocationStatusRequest = z.infer<typeof AgentInvocationStatusRequestSchema>;

export const AgentInvocationStatusPageSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-status-page/v1"),
    revision: z
      .string()
      .max(19)
      .regex(/^(0|[1-9][0-9]*)$/),
    hasMore: z.boolean(),
    invocations: z.array(AgentInvocationStatusSchema).max(700),
  })
  .strict();

export type AgentInvocationStatusPage = z.infer<typeof AgentInvocationStatusPageSchema>;

export const AgentCancellationResultSchema = z
  .object({
    schemaVersion: z.literal("agent-cancellation-result/v1"),
    invocationId: z.uuid(),
    status: z.enum(["cancellation-requested", "already-terminal", "not-active"]),
  })
  .strict();

export type AgentCancellationResult = z.infer<typeof AgentCancellationResultSchema>;

export const AgentHistoryPageSchema = z
  .object({
    schemaVersion: z.literal("agent-history-page/v1"),
    messages: z.array(
      z
        .object({
          id: z.string().min(1).max(512),
          role: z.enum(["user", "assistant"]),
          parts: z.array(z.unknown()),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
    ),
    nextCursor: z.string().min(1).max(2_048).nullable(),
  })
  .strict();

export type AgentHistoryPage = z.infer<typeof AgentHistoryPageSchema>;

export const AgentAttachmentRegisterRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-attachment-register/v1"),
    conversationId: agentPlatformConversationIdSchema,
    mediaAssetId: z.uuid(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          [...value].every((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint > 31 && codePoint !== 127;
          }),
        "fileName must not contain control characters"
      ),
    locale: agentPlatformLocaleSchema,
  })
  .strict();

export type AgentAttachmentRegisterRequest = z.infer<typeof AgentAttachmentRegisterRequestSchema>;

export const AgentAttachmentRevokeRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-attachment-revoke/v1"),
    conversationId: agentPlatformConversationIdSchema,
    attachmentId: z.uuid(),
    locale: agentPlatformLocaleSchema,
  })
  .strict();

export type AgentAttachmentRevokeRequest = z.infer<typeof AgentAttachmentRevokeRequestSchema>;

export const AgentAttachmentStatusRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-attachment-status-request/v1"),
    conversationId: agentPlatformConversationIdSchema,
    attachmentId: z.uuid(),
    locale: agentPlatformLocaleSchema,
  })
  .strict();

export type AgentAttachmentStatusRequest = z.infer<typeof AgentAttachmentStatusRequestSchema>;

const AgentAttachmentIngestProgressSchema = z
  .object({
    stage: z.string().min(1).max(64),
    progress: z.number().int().min(0).max(100),
    attempt: z.number().int().nonnegative(),
    maximumAttempts: z.number().int().min(1).max(10),
    nextAttemptAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const AgentDocumentAnalysisSummarySchema = z
  .object({
    jobId: z.uuid(),
    status: z.enum([
      "queued",
      "dispatching",
      "running",
      "reducing",
      "succeeded",
      "failed",
      "dead_lettered",
      "cancelled",
    ]),
    stage: z.string().min(1).max(64),
    completedUnits: z.number().int().nonnegative(),
    totalUnits: z.number().int().positive(),
    progress: z.number().int().min(0).max(100),
    finalArtifactId: z.uuid().nullable(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type AgentDocumentAnalysisSummary = z.infer<typeof AgentDocumentAnalysisSummarySchema>;

export const AgentAttachmentSummarySchema = z
  .object({
    schemaVersion: z.literal("agent-attachment/v1"),
    id: z.uuid(),
    conversationId: agentPlatformConversationIdSchema,
    mediaAssetId: z.uuid(),
    fileName: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(128),
    sizeBytes: z.string().regex(/^[1-9][0-9]*$/),
    status: z.enum(["processing", "ready", "failed", "revoked"]),
    uri: z.string().startsWith("fizzdragon-media://"),
    ingest: AgentAttachmentIngestProgressSchema.nullable(),
    analysis: AgentDocumentAnalysisSummarySchema.nullable(),
    error: z
      .object({
        code: z.string().min(1).max(128),
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type AgentAttachmentSummary = z.infer<typeof AgentAttachmentSummarySchema>;

const agentDocumentChunkIdSchema = z
  .string()
  .regex(/^chunk-[0-9]{6}$/)
  .max(32);

export const AgentLongDocumentWorkflowInputSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-analysis-workflow/v1"),
    jobId: z.uuid(),
  })
  .strict();

export type AgentLongDocumentWorkflowInput = z.infer<typeof AgentLongDocumentWorkflowInputSchema>;

export const AgentLongDocumentArtifactRefSchema = z
  .object({
    artifactId: z.uuid(),
    kind: z.enum(["section", "reduce", "final"]),
    level: z.number().int().nonnegative(),
    ordinal: z.number().int().nonnegative(),
    sourceChunkIds: z.array(agentDocumentChunkIdSchema).min(1).max(256),
  })
  .strict();

export type AgentLongDocumentArtifactRef = z.infer<typeof AgentLongDocumentArtifactRefSchema>;

export const AgentLongDocumentManifestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-manifest/v1"),
    jobId: z.uuid(),
    attachmentId: z.uuid(),
    locale: agentPlatformLocaleSchema,
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    document: z
      .object({
        title: z.string().min(1).max(255),
        format: z.enum(["screenplay", "markdown", "prose"]),
        characterCount: z.number().int().positive().max(200_000),
        chunkCount: z.number().int().positive().max(256),
      })
      .strict(),
    sections: z
      .array(
        z
          .object({
            chunkId: agentDocumentChunkIdSchema,
            ordinal: z.number().int().nonnegative(),
            heading: z.string().max(240).nullable(),
            abstract: z.string().max(420),
          })
          .strict()
      )
      .min(1)
      .max(256),
    completedArtifacts: z.array(AgentLongDocumentArtifactRefSchema).max(512),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.sections.length !== manifest.document.chunkCount ||
      manifest.sections.some(
        (section, index) =>
          section.ordinal !== index || section.chunkId !== `chunk-${String(index).padStart(6, "0")}`
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "sections must exhaustively and contiguously cover the source index",
      });
    }
  });

export type AgentLongDocumentManifest = z.infer<typeof AgentLongDocumentManifestSchema>;

export const AgentLongDocumentSectionContextSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-section-context/v1"),
    jobId: z.uuid(),
    locale: agentPlatformLocaleSchema,
    document: AgentLongDocumentManifestSchema.shape.document,
    section: z
      .object({
        chunkId: agentDocumentChunkIdSchema,
        ordinal: z.number().int().nonnegative(),
        heading: z.string().max(240).nullable(),
        text: z.string().min(1).max(2_400),
      })
      .strict(),
  })
  .strict();

export type AgentLongDocumentSectionContext = z.infer<typeof AgentLongDocumentSectionContextSchema>;

export const AgentDocumentEvidenceSchema = z
  .object({
    chunkId: agentDocumentChunkIdSchema,
    quote: z.string().trim().min(1).max(400),
  })
  .strict();

export const AgentDocumentFindingSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    analysis: z.string().trim().min(1).max(1_500),
    evidence: z.array(AgentDocumentEvidenceSchema).min(1).max(12),
  })
  .strict();

const agentDocumentEntityAnalysisSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    analysis: z.string().trim().min(1).max(1_500),
    evidence: z.array(AgentDocumentEvidenceSchema).min(1).max(12),
  })
  .strict();

export const AgentDocumentSectionAnalysisSchema = z
  .object({
    schemaVersion: z.literal("agent-document-section-analysis/v1"),
    chunkId: agentDocumentChunkIdSchema,
    heading: z.string().max(240).nullable(),
    summary: z.string().trim().min(1).max(2_000),
    storyBeats: z.array(AgentDocumentFindingSchema).max(16),
    characters: z.array(agentDocumentEntityAnalysisSchema).max(24),
    locations: z.array(agentDocumentEntityAnalysisSchema).max(16),
    plotThreads: z.array(AgentDocumentFindingSchema).max(16),
    continuityFindings: z.array(AgentDocumentFindingSchema).max(16),
    themes: z.array(AgentDocumentFindingSchema).max(12),
  })
  .strict()
  .superRefine((analysis, context) => {
    const evidence = [
      ...analysis.storyBeats,
      ...analysis.characters,
      ...analysis.locations,
      ...analysis.plotThreads,
      ...analysis.continuityFindings,
      ...analysis.themes,
    ].flatMap((finding) => finding.evidence);
    if (evidence.some((item) => item.chunkId !== analysis.chunkId)) {
      context.addIssue({
        code: "custom",
        path: ["chunkId"],
        message: "section evidence must cite the analyzed chunk",
      });
    }
  });

export type AgentDocumentSectionAnalysis = z.infer<typeof AgentDocumentSectionAnalysisSchema>;

export const AgentDocumentSynthesisSchema = z
  .object({
    schemaVersion: z.literal("agent-document-synthesis/v1"),
    level: z.number().int().positive().max(16),
    summary: z.string().trim().min(1).max(4_000),
    storyStructure: z.array(AgentDocumentFindingSchema).max(64),
    characters: z.array(agentDocumentEntityAnalysisSchema).max(64),
    locations: z.array(agentDocumentEntityAnalysisSchema).max(48),
    plotThreads: z.array(AgentDocumentFindingSchema).max(64),
    continuityFindings: z.array(AgentDocumentFindingSchema).max(64),
    themes: z.array(AgentDocumentFindingSchema).max(32),
  })
  .strict();

export type AgentDocumentSynthesis = z.infer<typeof AgentDocumentSynthesisSchema>;

export const AgentDocumentFinalAnalysisSchema = z
  .object({
    schemaVersion: z.literal("agent-document-final-analysis/v1"),
    executiveSummary: z.string().trim().min(1).max(6_000),
    sourceCoverage: z
      .object({
        chunkCount: z.number().int().positive().max(256),
        analyzedChunkCount: z.number().int().positive().max(256),
        missingChunkIds: z.array(agentDocumentChunkIdSchema).max(256),
      })
      .strict(),
    storyStructure: z.array(AgentDocumentFindingSchema).max(96),
    characters: z.array(agentDocumentEntityAnalysisSchema).max(96),
    locations: z.array(agentDocumentEntityAnalysisSchema).max(64),
    plotThreads: z.array(AgentDocumentFindingSchema).max(96),
    continuityFindings: z.array(AgentDocumentFindingSchema).max(96),
    themes: z.array(AgentDocumentFindingSchema).max(48),
    productionRecommendations: z.array(AgentDocumentFindingSchema).max(64),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (
      analysis.sourceCoverage.analyzedChunkCount !== analysis.sourceCoverage.chunkCount ||
      analysis.sourceCoverage.missingChunkIds.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceCoverage"],
        message: "final analysis must account for every indexed source chunk",
      });
    }
  });

export type AgentDocumentFinalAnalysis = z.infer<typeof AgentDocumentFinalAnalysisSchema>;

export const AgentLongDocumentArtifactContentSchema = z.discriminatedUnion("schemaVersion", [
  AgentDocumentSectionAnalysisSchema,
  AgentDocumentSynthesisSchema,
  AgentDocumentFinalAnalysisSchema,
]);

export type AgentLongDocumentArtifactContent = z.infer<
  typeof AgentLongDocumentArtifactContentSchema
>;

export const AgentLongDocumentArtifactsContextRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-artifacts-context-request/v1"),
    jobId: z.uuid(),
    artifactIds: z.array(z.uuid()).min(1).max(8),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.artifactIds).size !== request.artifactIds.length) {
      context.addIssue({
        code: "custom",
        path: ["artifactIds"],
        message: "artifactIds must be unique",
      });
    }
  });

export const AgentLongDocumentArtifactsContextSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-artifacts-context/v1"),
    jobId: z.uuid(),
    artifacts: z
      .array(
        AgentLongDocumentArtifactRefSchema.extend({
          content: AgentLongDocumentArtifactContentSchema,
        }).strict()
      )
      .min(1)
      .max(8),
  })
  .strict();

export type AgentLongDocumentArtifactsContext = z.infer<
  typeof AgentLongDocumentArtifactsContextSchema
>;

export const AgentLongDocumentArtifactWriteRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-artifact-write/v1"),
    jobId: z.uuid(),
    kind: z.enum(["section", "reduce", "final"]),
    level: z.number().int().nonnegative().max(16),
    ordinal: z.number().int().nonnegative().max(511),
    sourceChunkIds: z.array(agentDocumentChunkIdSchema).min(1).max(256),
    inputArtifactIds: z.array(z.uuid()).max(8),
    content: AgentLongDocumentArtifactContentSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const valid =
      (request.kind === "section" &&
        request.level === 0 &&
        request.inputArtifactIds.length === 0 &&
        request.content.schemaVersion === "agent-document-section-analysis/v1") ||
      (request.kind === "reduce" &&
        request.level > 0 &&
        request.inputArtifactIds.length > 0 &&
        request.content.schemaVersion === "agent-document-synthesis/v1" &&
        request.content.level === request.level) ||
      (request.kind === "final" &&
        request.level > 0 &&
        request.inputArtifactIds.length === 1 &&
        request.content.schemaVersion === "agent-document-final-analysis/v1");
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "artifact kind, level, inputs and content are inconsistent",
      });
    }
  });

export type AgentLongDocumentArtifactWriteRequest = z.infer<
  typeof AgentLongDocumentArtifactWriteRequestSchema
>;

export const AgentLongDocumentCompleteRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-complete/v1"),
    jobId: z.uuid(),
    finalArtifactId: z.uuid(),
  })
  .strict();
export type AgentLongDocumentCompleteRequest = z.infer<
  typeof AgentLongDocumentCompleteRequestSchema
>;

export const AgentLongDocumentFailRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-fail/v1"),
    jobId: z.uuid(),
    error: z
      .object({
        code: agentPublicErrorCodeSchema,
        message: z.string().min(1).max(2_000),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type AgentLongDocumentFailRequest = z.infer<typeof AgentLongDocumentFailRequestSchema>;
