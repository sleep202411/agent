import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  AgentDocumentAnalysisArtifactKind,
  AgentDocumentAnalysisJobStatus,
  AgentPlatformAttachmentStatus,
  Prisma,
} from '@prisma/client';
import {
  AgentLongDocumentArtifactContentSchema,
  AgentLongDocumentArtifactWriteRequestSchema,
  AgentLongDocumentArtifactsContextRequestSchema,
  AgentLongDocumentCompleteRequestSchema,
  AgentLongDocumentFailRequestSchema,
  AgentLongDocumentManifestSchema,
  AgentLongDocumentSectionContextSchema,
  type AgentDocumentFinalAnalysis,
  type AgentDocumentSectionAnalysis,
  type AgentDocumentSynthesis,
  type AgentLongDocumentArtifactContent,
  type AgentLongDocumentArtifactRef,
  type AgentLongDocumentArtifactWriteRequest,
  type AgentLongDocumentArtifactsContext,
  type AgentLongDocumentManifest,
  type AgentLongDocumentSectionContext,
} from '@repo/shared/agent-platform';

import {
  parsePersistedStorySourceMaterialIndex,
  type StorySourceMaterialIndex,
} from '../agent-domain-gateway/story-source-material-index';
import { PrismaService } from '../infra/db/db.module';
import {
  canonicalJsonHash,
  canonicalJsonString,
} from '../story-studio/canonical-json';

const MAX_ARTIFACT_BYTES = 256 * 1024;
// How long a retryable terminal failure waits before the dispatcher may
// redeliver it. A redelivered run re-executes real analysis work, so its own
// duration is what actually paces the retries; this only stops the sweep that
// observes the failure from picking it straight back up in the same second.
const RETRYABLE_FAILURE_REDELIVERY_MS = 30_000;
const ACTIVE_ANALYSIS_STATUSES = new Set<AgentDocumentAnalysisJobStatus>([
  AgentDocumentAnalysisJobStatus.dispatching,
  AgentDocumentAnalysisJobStatus.running,
  AgentDocumentAnalysisJobStatus.reducing,
]);

const ANALYSIS_SOURCE_SELECT = {
  id: true,
  attachmentId: true,
  status: true,
  sourceContentHash: true,
  temporalWorkflowId: true,
  startedAt: true,
  totalUnits: true,
  attachment: {
    select: {
      id: true,
      status: true,
      locale: true,
      fileName: true,
      contentHash: true,
      documentText: true,
      documentCharCount: true,
      documentIndex: true,
      documentIndexVersion: true,
      revokedAt: true,
    },
  },
} satisfies Prisma.AgentDocumentAnalysisJobSelect;

type AnalysisSource = Prisma.AgentDocumentAnalysisJobGetPayload<{
  select: typeof ANALYSIS_SOURCE_SELECT;
}>;

@Injectable()
export class AgentPlatformDocumentAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(jobId: string): Promise<AgentLongDocumentManifest> {
    return this.prisma.$transaction(async (transaction) => {
      await lockJob(transaction, jobId);
      const source = await transaction.agentDocumentAnalysisJob.findUnique({
        where: { id: jobId },
        select: ANALYSIS_SOURCE_SELECT,
      });
      const index = requireActiveSource(source);
      const artifacts =
        await transaction.agentDocumentAnalysisArtifact.findMany({
          where: { jobId },
          orderBy: [{ level: 'asc' }, { ordinal: 'asc' }, { kind: 'asc' }],
          select: {
            id: true,
            kind: true,
            level: true,
            ordinal: true,
            sourceChunkIds: true,
          },
        });
      await transaction.agentDocumentAnalysisJob.update({
        where: { id: jobId },
        data: {
          status: AgentDocumentAnalysisJobStatus.running,
          stage: 'mapping',
          startedAt: source?.startedAt ?? new Date(),
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
          error: Prisma.DbNull,
        },
      });
      return AgentLongDocumentManifestSchema.parse({
        schemaVersion: 'agent-long-document-manifest/v1',
        jobId,
        attachmentId: source!.attachmentId,
        locale: source!.attachment.locale,
        sourceContentHash: source!.sourceContentHash,
        document: {
          title: index.document.title,
          format: index.document.format,
          characterCount: index.document.characterCount,
          chunkCount: index.document.chunkCount,
        },
        sections: index.chunks.map((chunk) => ({
          chunkId: chunk.id,
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          abstract: chunk.abstract,
        })),
        completedArtifacts: artifacts.map(artifactRef),
      });
    });
  }

  async section(
    jobId: string,
    chunkId: string,
  ): Promise<AgentLongDocumentSectionContext> {
    const source = await this.prisma.agentDocumentAnalysisJob.findUnique({
      where: { id: jobId },
      select: ANALYSIS_SOURCE_SELECT,
    });
    const index = requireActiveSource(source);
    const chunk = index.chunks.find((candidate) => candidate.id === chunkId);
    if (!chunk) throw analysisChunkNotFound();
    const text = source!.attachment.documentText!.slice(chunk.start, chunk.end);
    return AgentLongDocumentSectionContextSchema.parse({
      schemaVersion: 'agent-long-document-section-context/v1',
      jobId,
      locale: source!.attachment.locale,
      document: {
        title: index.document.title,
        format: index.document.format,
        characterCount: index.document.characterCount,
        chunkCount: index.document.chunkCount,
      },
      section: {
        chunkId: chunk.id,
        ordinal: chunk.ordinal,
        heading: chunk.heading,
        text,
      },
    });
  }

  async artifactsContext(
    rawRequest: unknown,
  ): Promise<AgentLongDocumentArtifactsContext> {
    const request =
      AgentLongDocumentArtifactsContextRequestSchema.parse(rawRequest);
    const source = await this.prisma.agentDocumentAnalysisJob.findUnique({
      where: { id: request.jobId },
      select: ANALYSIS_SOURCE_SELECT,
    });
    requireActiveSource(source);
    const rows = await this.prisma.agentDocumentAnalysisArtifact.findMany({
      where: {
        jobId: request.jobId,
        id: { in: request.artifactIds },
      },
      select: {
        id: true,
        kind: true,
        level: true,
        ordinal: true,
        sourceChunkIds: true,
        content: true,
      },
    });
    if (rows.length !== request.artifactIds.length) {
      throw analysisArtifactNotFound();
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      schemaVersion: 'agent-long-document-artifacts-context/v1',
      jobId: request.jobId,
      artifacts: request.artifactIds.map((id) => {
        const row = byId.get(id);
        if (!row) throw analysisArtifactNotFound();
        return {
          artifactId: row.id,
          kind: row.kind,
          level: row.level,
          ordinal: row.ordinal,
          sourceChunkIds: row.sourceChunkIds,
          content: AgentLongDocumentArtifactContentSchema.parse(row.content),
        };
      }),
    };
  }

  async writeArtifact(
    rawRequest: unknown,
  ): Promise<AgentLongDocumentArtifactRef> {
    const request =
      AgentLongDocumentArtifactWriteRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async (transaction) => {
      await lockJob(transaction, request.jobId);
      const source = await transaction.agentDocumentAnalysisJob.findUnique({
        where: { id: request.jobId },
        select: ANALYSIS_SOURCE_SELECT,
      });
      const index = requireActiveSource(source);
      const existing =
        await transaction.agentDocumentAnalysisArtifact.findUnique({
          where: {
            jobId_kind_level_ordinal: {
              jobId: request.jobId,
              kind: request.kind,
              level: request.level,
              ordinal: request.ordinal,
            },
          },
        });
      if (existing) {
        await validateArtifactLineage(transaction, request, index, {
          validateGeneratedContent: false,
        });
        if (
          !sameStrings(existing.sourceChunkIds, request.sourceChunkIds) ||
          !sameStrings(existing.inputArtifactIds, request.inputArtifactIds)
        ) {
          throw new ConflictException({
            code: 'AGENT_DOCUMENT_ANALYSIS_CHECKPOINT_CONFLICT',
            message:
              'A document analysis retry used different immutable inputs for an existing checkpoint.',
            retryable: false,
          });
        }
        // The coordinate and input lineage are the idempotency key. Once a
        // checkpoint is durable, an Activity retry after a lost response must
        // return that exact immutable checkpoint even if a non-deterministic
        // model would generate different wording on the retry.
        return artifactRef(existing);
      }
      const serialized = canonicalJsonString(request.content);
      if (Buffer.byteLength(serialized) > MAX_ARTIFACT_BYTES) {
        throw new PayloadTooLargeException({
          code: 'AGENT_DOCUMENT_ANALYSIS_ARTIFACT_TOO_LARGE',
          message: 'A document analysis checkpoint exceeded 256 KiB.',
          retryable: false,
        });
      }
      await validateArtifactLineage(transaction, request, index, {
        validateGeneratedContent: true,
      });
      validateEvidence(
        request.content,
        index,
        source!.attachment.documentText!,
      );
      const contentHash = canonicalJsonHash(request.content);
      const created = await transaction.agentDocumentAnalysisArtifact.create({
        data: {
          jobId: request.jobId,
          kind: request.kind,
          level: request.level,
          ordinal: request.ordinal,
          sourceChunkIds: request.sourceChunkIds,
          inputArtifactIds: request.inputArtifactIds,
          content: request.content as unknown as Prisma.InputJsonObject,
          contentHash,
        },
      });
      const completedUnits =
        await transaction.agentDocumentAnalysisArtifact.count({
          where: { jobId: request.jobId },
        });
      if (completedUnits > source!.totalUnits) {
        throw new ConflictException({
          code: 'AGENT_DOCUMENT_ANALYSIS_PLAN_DIVERGED',
          message:
            'Document analysis produced more checkpoints than its durable plan permits.',
          retryable: false,
        });
      }
      await transaction.agentDocumentAnalysisJob.update({
        where: { id: request.jobId },
        data: {
          status:
            request.kind === AgentDocumentAnalysisArtifactKind.section
              ? AgentDocumentAnalysisJobStatus.running
              : AgentDocumentAnalysisJobStatus.reducing,
          stage:
            request.kind === AgentDocumentAnalysisArtifactKind.section
              ? 'mapping'
              : request.kind === AgentDocumentAnalysisArtifactKind.reduce
                ? `reducing_level_${request.level}`
                : 'finalizing',
          completedUnits,
        },
      });
      return artifactRef(created);
    });
  }

  async complete(rawRequest: unknown): Promise<AgentLongDocumentArtifactRef> {
    const request = AgentLongDocumentCompleteRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async (transaction) => {
      await lockJob(transaction, request.jobId);
      const source = await transaction.agentDocumentAnalysisJob.findUnique({
        where: { id: request.jobId },
        select: ANALYSIS_SOURCE_SELECT,
      });
      if (source?.status === AgentDocumentAnalysisJobStatus.succeeded) {
        const existingFinal =
          await transaction.agentDocumentAnalysisArtifact.findFirst({
            where: {
              id: request.finalArtifactId,
              jobId: request.jobId,
              kind: AgentDocumentAnalysisArtifactKind.final,
            },
          });
        if (!existingFinal) throw analysisArtifactNotFound();
        return artifactRef(existingFinal);
      }
      const index = requireActiveSource(source);
      const final = await transaction.agentDocumentAnalysisArtifact.findFirst({
        where: {
          id: request.finalArtifactId,
          jobId: request.jobId,
          kind: AgentDocumentAnalysisArtifactKind.final,
        },
      });
      if (!final) throw analysisArtifactNotFound();
      const content = AgentLongDocumentArtifactContentSchema.parse(
        final.content,
      );
      if (
        content.schemaVersion !== 'agent-document-final-analysis/v1' ||
        !sameStrings(
          final.sourceChunkIds,
          index.chunks.map((chunk) => chunk.id),
        )
      ) {
        throw new ConflictException({
          code: 'AGENT_DOCUMENT_ANALYSIS_COVERAGE_INCOMPLETE',
          message:
            'The final document analysis does not cover every indexed source section.',
          retryable: false,
        });
      }
      const completedUnits =
        await transaction.agentDocumentAnalysisArtifact.count({
          where: { jobId: request.jobId },
        });
      if (completedUnits !== source!.totalUnits) {
        throw new ConflictException({
          code: 'AGENT_DOCUMENT_ANALYSIS_PLAN_INCOMPLETE',
          message:
            'The final document analysis cannot complete before every planned checkpoint exists.',
          retryable: false,
        });
      }
      await transaction.agentDocumentAnalysisJob.update({
        where: { id: request.jobId },
        data: {
          status: AgentDocumentAnalysisJobStatus.succeeded,
          stage: 'completed',
          completedUnits,
          error: Prisma.DbNull,
          completedAt: new Date(),
          deadLetteredAt: null,
          dispatchLeaseToken: null,
          dispatchLeaseUntil: null,
        },
      });
      return artifactRef(final);
    });
  }

  async fail(rawRequest: unknown): Promise<void> {
    const request = AgentLongDocumentFailRequestSchema.parse(rawRequest);
    const now = new Date();
    await this.prisma.agentDocumentAnalysisJob.updateMany({
      where: {
        id: request.jobId,
        status: {
          in: [
            AgentDocumentAnalysisJobStatus.dispatching,
            AgentDocumentAnalysisJobStatus.running,
            AgentDocumentAnalysisJobStatus.reducing,
          ],
        },
      },
      data: {
        status: AgentDocumentAnalysisJobStatus.failed,
        stage: 'failed',
        error: request.error,
        completedAt: now,
        // A retryable failure names the moment the dispatcher may redeliver
        // it. The failure is terminal for this Workflow run, not for the job:
        // its finished sections are durable checkpoints the next run resumes
        // from, and dispatch_attempt_count still bounds how often that happens.
        nextDispatchAt: request.error.retryable
          ? new Date(now.getTime() + RETRYABLE_FAILURE_REDELIVERY_MS)
          : undefined,
        dispatchLeaseToken: null,
        dispatchLeaseUntil: null,
      },
    });
  }
}

async function validateArtifactLineage(
  transaction: Prisma.TransactionClient,
  request: AgentLongDocumentArtifactWriteRequest,
  index: StorySourceMaterialIndex,
  options: Readonly<{ validateGeneratedContent: boolean }>,
): Promise<void> {
  const allChunkIds = index.chunks.map((chunk) => chunk.id);
  if (request.kind === AgentDocumentAnalysisArtifactKind.section) {
    const chunk = index.chunks[request.ordinal];
    if (
      !chunk ||
      request.sourceChunkIds.length !== 1 ||
      request.sourceChunkIds[0] !== chunk.id ||
      request.inputArtifactIds.length !== 0 ||
      request.content.schemaVersion !== 'agent-document-section-analysis/v1' ||
      request.content.chunkId !== chunk.id
    ) {
      throw lineageInvalid();
    }
    return;
  }
  if (
    (request.kind === AgentDocumentAnalysisArtifactKind.reduce &&
      request.content.schemaVersion !== 'agent-document-synthesis/v1') ||
    (request.kind === AgentDocumentAnalysisArtifactKind.final &&
      request.content.schemaVersion !== 'agent-document-final-analysis/v1')
  ) {
    throw lineageInvalid();
  }
  const inputs = await transaction.agentDocumentAnalysisArtifact.findMany({
    where: {
      jobId: request.jobId,
      id: { in: request.inputArtifactIds },
    },
    orderBy: [{ level: 'asc' }, { ordinal: 'asc' }],
  });
  if (inputs.length !== request.inputArtifactIds.length) {
    throw analysisArtifactNotFound();
  }
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const orderedInputs = request.inputArtifactIds.map((id) => byId.get(id)!);
  const expectedChunks = uniqueInDocumentOrder(
    orderedInputs.flatMap((input) => input.sourceChunkIds),
    allChunkIds,
  );
  if (!sameStrings(request.sourceChunkIds, expectedChunks)) {
    throw lineageInvalid();
  }
  if (
    request.kind === AgentDocumentAnalysisArtifactKind.final &&
    !sameStrings(request.sourceChunkIds, allChunkIds)
  ) {
    throw lineageInvalid();
  }
  if (!options.validateGeneratedContent) return;
}

function validateEvidence(
  content: AgentLongDocumentArtifactContent,
  index: StorySourceMaterialIndex,
  documentText: string,
): void {
  const chunks = new Map(
    index.chunks.map((chunk) => [
      chunk.id,
      documentText.slice(chunk.start, chunk.end).normalize('NFC'),
    ]),
  );
  for (const evidence of evidenceItems(content)) {
    const source = chunks.get(evidence.chunkId);
    if (!source || !source.includes(evidence.quote.normalize('NFC'))) {
      throw new ConflictException({
        code: 'AGENT_DOCUMENT_ANALYSIS_EVIDENCE_INVALID',
        message:
          'A document analysis checkpoint cited text that is not present in its source section.',
        retryable: false,
      });
    }
  }
}

function evidenceItems(content: AgentLongDocumentArtifactContent) {
  switch (content.schemaVersion) {
    case 'agent-document-section-analysis/v1':
      return sectionEvidence(content);
    case 'agent-document-synthesis/v1':
      return synthesisEvidence(content);
    case 'agent-document-final-analysis/v1':
      return finalEvidence(content);
  }
}

function sectionEvidence(content: AgentDocumentSectionAnalysis) {
  return [
    ...content.storyBeats.flatMap((finding) => finding.evidence),
    ...content.characters.flatMap((finding) => finding.evidence),
    ...content.locations.flatMap((finding) => finding.evidence),
    ...content.plotThreads.flatMap((finding) => finding.evidence),
    ...content.continuityFindings.flatMap((finding) => finding.evidence),
    ...content.themes.flatMap((finding) => finding.evidence),
  ];
}

function synthesisEvidence(content: AgentDocumentSynthesis) {
  return [
    ...content.storyStructure.flatMap((finding) => finding.evidence),
    ...content.characters.flatMap((finding) => finding.evidence),
    ...content.locations.flatMap((finding) => finding.evidence),
    ...content.plotThreads.flatMap((finding) => finding.evidence),
    ...content.continuityFindings.flatMap((finding) => finding.evidence),
    ...content.themes.flatMap((finding) => finding.evidence),
  ];
}

function finalEvidence(content: AgentDocumentFinalAnalysis) {
  return [
    ...content.storyStructure.flatMap((finding) => finding.evidence),
    ...content.characters.flatMap((finding) => finding.evidence),
    ...content.locations.flatMap((finding) => finding.evidence),
    ...content.plotThreads.flatMap((finding) => finding.evidence),
    ...content.continuityFindings.flatMap((finding) => finding.evidence),
    ...content.themes.flatMap((finding) => finding.evidence),
    ...content.productionRecommendations.flatMap((finding) => finding.evidence),
  ];
}

function requireActiveSource(
  source: AnalysisSource | null,
): StorySourceMaterialIndex {
  if (!source) throw analysisNotFound();
  if (
    !ACTIVE_ANALYSIS_STATUSES.has(source.status) ||
    source.attachment.status !== AgentPlatformAttachmentStatus.ready ||
    source.attachment.revokedAt ||
    !source.attachment.documentText ||
    !source.attachment.contentHash ||
    source.attachment.contentHash !== source.sourceContentHash ||
    source.attachment.documentCharCount === null
  ) {
    throw new ConflictException({
      code: 'AGENT_DOCUMENT_ANALYSIS_SOURCE_UNAVAILABLE',
      message:
        'The source document is not available for this analysis workflow.',
      retryable: false,
    });
  }
  try {
    return parsePersistedStorySourceMaterialIndex({
      value: source.attachment.documentIndex,
      schemaVersion: source.attachment.documentIndexVersion,
      expectedContentHash: source.sourceContentHash,
      expectedCharacterCount: source.attachment.documentCharCount,
    });
  } catch {
    throw new ConflictException({
      code: 'AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID',
      message:
        'The indexed source document no longer matches this analysis workflow.',
      retryable: false,
    });
  }
}

async function lockJob(
  transaction: Prisma.TransactionClient,
  jobId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "agent_document_analysis_jobs"
    WHERE "id" = ${jobId}::uuid
    FOR UPDATE
  `;
}

function artifactRef(input: {
  id: string;
  kind: AgentDocumentAnalysisArtifactKind;
  level: number;
  ordinal: number;
  sourceChunkIds: string[];
}): AgentLongDocumentArtifactRef {
  return {
    artifactId: input.id,
    kind: input.kind,
    level: input.level,
    ordinal: input.ordinal,
    sourceChunkIds: input.sourceChunkIds,
  };
}

function uniqueInDocumentOrder(
  values: readonly string[],
  documentOrder: readonly string[],
): string[] {
  const selected = new Set(values);
  if (selected.size !== values.length) throw lineageInvalid();
  return documentOrder.filter((value) => selected.has(value));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function analysisNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_DOCUMENT_ANALYSIS_NOT_FOUND',
    message: 'Document analysis job not found.',
  });
}

function analysisChunkNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_DOCUMENT_ANALYSIS_CHUNK_NOT_FOUND',
    message: 'The requested indexed document section does not exist.',
  });
}

function analysisArtifactNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_DOCUMENT_ANALYSIS_ARTIFACT_NOT_FOUND',
    message: 'A required document analysis checkpoint does not exist.',
  });
}

function lineageInvalid(): ConflictException {
  return new ConflictException({
    code: 'AGENT_DOCUMENT_ANALYSIS_LINEAGE_INVALID',
    message:
      'A document analysis checkpoint does not match its durable input lineage.',
    retryable: false,
  });
}
