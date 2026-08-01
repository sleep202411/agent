import { z } from "zod";

/*
 * Agent Platform owns an independently installable production artifact, so it
 * must not import the monorepo-private @repo/shared package at runtime. These
 * schemas are the runtime side of the versioned HTTP wire contract. The server
 * side lives in packages/shared/src/agent-platform.ts; both sides are locked to
 * the same golden compatibility suite in packages/shared/test-fixtures.
 */

const agentPublicErrorCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]*$/u);
const agentPublicMessageKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_.-]*$/u);
const agentDocumentChunkIdSchema = z.string().regex(/^chunk-[0-9]{6}$/u);
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

export const AgentPublicErrorSchema = z
  .object({
    code: agentPublicErrorCodeSchema,
    messageKey: agentPublicMessageKeySchema,
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    diagnosticId: z.uuid(),
  })
  .strict();

export const AgentInvocationLifecycleRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-lifecycle/v1"),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
    conversationId: z.uuid(),
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

export const AgentInvocationLifecycleAcknowledgementSchema = z
  .object({
    schemaVersion: z.literal("agent-invocation-lifecycle-ack/v1"),
    invocationId: z.uuid(),
    attemptId: z.uuid(),
    attemptOrdinal: z.number().int().nonnegative(),
  })
  .strict();

export const AgentLongDocumentArtifactRefSchema = z
  .object({
    artifactId: z.uuid(),
    kind: z.enum(["section", "reduce", "final"]),
    level: z.number().int().nonnegative(),
    ordinal: z.number().int().nonnegative(),
    sourceChunkIds: z.array(agentDocumentChunkIdSchema).min(1).max(256),
  })
  .strict();

export const AgentLongDocumentManifestSchema = z
  .object({
    schemaVersion: z.literal("agent-long-document-manifest/v1"),
    jobId: z.uuid(),
    attachmentId: z.uuid(),
    locale: agentPlatformLocaleSchema,
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
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

export const AgentDocumentEvidenceSchema = z
  .object({
    chunkId: agentDocumentChunkIdSchema,
    quote: z.string().trim().min(1).max(400),
  })
  .strict();

/*
 * Two evidence floors, one shape source. The wire contract keeps min(1):
 * a persisted finding must be citable. The model-tolerant variants accept
 * min(0), because a legal synthesis can merge a beat whose evidence the
 * budget squeezed out — the runtime then DROPS unevidenced findings before
 * the wire parse instead of failing the whole reduction (live incident
 * 2026-08-01: storyStructure[6].evidence=[] killed the final synthesis).
 */
const documentFindingSchema = (evidenceMinimum: number) =>
  z
    .object({
      label: z.string().trim().min(1).max(160),
      analysis: z.string().trim().min(1).max(1_500),
      evidence: z.array(AgentDocumentEvidenceSchema).min(evidenceMinimum).max(12),
    })
    .strict();
export const AgentDocumentFindingSchema = documentFindingSchema(1);
const modelTolerantFindingSchema = documentFindingSchema(0);

const documentEntityAnalysisSchema = (evidenceMinimum: number) =>
  z
    .object({
      name: z.string().trim().min(1).max(160),
      analysis: z.string().trim().min(1).max(1_500),
      evidence: z.array(AgentDocumentEvidenceSchema).min(evidenceMinimum).max(12),
    })
    .strict();
const agentDocumentEntityAnalysisSchema = documentEntityAnalysisSchema(1);
const modelTolerantEntityAnalysisSchema = documentEntityAnalysisSchema(0);

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

const documentSynthesisShape = (
  finding: ReturnType<typeof documentFindingSchema>,
  entity: ReturnType<typeof documentEntityAnalysisSchema>
) => ({
  schemaVersion: z.literal("agent-document-synthesis/v1"),
  level: z.number().int().positive().max(16),
  summary: z.string().trim().min(1).max(4_000),
  storyStructure: z.array(finding).max(64),
  characters: z.array(entity).max(64),
  locations: z.array(entity).max(48),
  plotThreads: z.array(finding).max(64),
  continuityFindings: z.array(finding).max(64),
  themes: z.array(finding).max(32),
});
export const AgentDocumentSynthesisSchema = z
  .object(documentSynthesisShape(AgentDocumentFindingSchema, agentDocumentEntityAnalysisSchema))
  .strict();
/** Model-facing variant: evidence may be empty; the runtime drops such findings. */
export const AgentDocumentSynthesisModelSchema = z
  .object(documentSynthesisShape(modelTolerantFindingSchema, modelTolerantEntityAnalysisSchema))
  .strict();

const documentFinalAnalysisShape = (
  finding: ReturnType<typeof documentFindingSchema>,
  entity: ReturnType<typeof documentEntityAnalysisSchema>
) => ({
  schemaVersion: z.literal("agent-document-final-analysis/v1"),
  executiveSummary: z.string().trim().min(1).max(6_000),
  sourceCoverage: z
    .object({
      chunkCount: z.number().int().positive().max(256),
      analyzedChunkCount: z.number().int().positive().max(256),
      missingChunkIds: z.array(agentDocumentChunkIdSchema).max(256),
    })
    .strict(),
  storyStructure: z.array(finding).max(96),
  characters: z.array(entity).max(96),
  locations: z.array(entity).max(64),
  plotThreads: z.array(finding).max(96),
  continuityFindings: z.array(finding).max(96),
  themes: z.array(finding).max(48),
  productionRecommendations: z.array(finding).max(64),
});
const requireCompleteCoverage = (
  analysis: {
    sourceCoverage: {
      chunkCount: number;
      analyzedChunkCount: number;
      missingChunkIds: readonly string[];
    };
  },
  context: z.RefinementCtx
) => {
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
};
export const AgentDocumentFinalAnalysisSchema = z
  .object(documentFinalAnalysisShape(AgentDocumentFindingSchema, agentDocumentEntityAnalysisSchema))
  .strict()
  .superRefine(requireCompleteCoverage);
/** Model-facing variant: evidence may be empty; the runtime drops such findings. */
export const AgentDocumentFinalAnalysisModelSchema = z
  .object(documentFinalAnalysisShape(modelTolerantFindingSchema, modelTolerantEntityAnalysisSchema))
  .strict()
  .superRefine(requireCompleteCoverage);

export const AgentLongDocumentArtifactContentSchema = z.discriminatedUnion("schemaVersion", [
  AgentDocumentSectionAnalysisSchema,
  AgentDocumentSynthesisSchema,
  AgentDocumentFinalAnalysisSchema,
]);

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
