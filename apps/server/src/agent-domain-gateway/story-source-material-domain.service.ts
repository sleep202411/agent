import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentDocumentAnalysisArtifactKind,
  AgentDocumentAnalysisJobStatus,
  AgentPlatformAttachmentKind,
  AgentPlatformAttachmentStatus,
  Prisma,
} from '@prisma/client';
import {
  AgentDocumentFinalAnalysisSchema,
  type AgentDocumentFinalAnalysis,
} from '@repo/shared/agent-platform';

import { StoryPermissionService } from '../story-studio/story-permission.service';
import type {
  AgentDomainToolRequest,
  AgentDomainToolResult,
} from './agent-domain.dto';
import {
  parsePersistedStorySourceMaterialIndex,
  queryStorySourceMaterial,
  StorySourceAnalysisQueryArgumentsSchema,
  StorySourceMaterialQueryArgumentsSchema,
  type StorySourceAnalysisQueryArguments,
  type StorySourceMaterialIndex,
} from './story-source-material-index';

const MAX_ANALYSIS_TOOL_PAYLOAD_BYTES = 64 * 1024;
const ACTIVE_ANALYSIS_STATUSES = new Set<AgentDocumentAnalysisJobStatus>([
  AgentDocumentAnalysisJobStatus.queued,
  AgentDocumentAnalysisJobStatus.dispatching,
  AgentDocumentAnalysisJobStatus.running,
  AgentDocumentAnalysisJobStatus.reducing,
]);

type StoryRequest = AgentDomainToolRequest & {
  scope: Extract<AgentDomainToolRequest['scope'], { surface: 'story-studio' }>;
};

@Injectable()
export class StorySourceMaterialDomainService {
  constructor(private readonly permissions: StoryPermissionService) {}

  async analysis(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
  ): Promise<AgentDomainToolResult> {
    const request = requireStoryRequest(rawRequest);
    const args = StorySourceAnalysisQueryArgumentsSchema.parse(rawArguments);
    await this.authorize(tx, request);
    const attachment = await tx.agentPlatformAttachment.findFirst({
      where: {
        id: args.attachmentId,
        conversationId: request.scope.conversationId,
        ownerActorId: request.actor.id,
        kind: AgentPlatformAttachmentKind.document_text,
        status: AgentPlatformAttachmentStatus.ready,
        revokedAt: null,
      },
      select: {
        id: true,
        fileName: true,
        contentHash: true,
        documentCharCount: true,
        documentIndex: true,
        documentIndexVersion: true,
        analysisJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            analysisVersion: true,
            sourceContentHash: true,
            status: true,
            stage: true,
            completedUnits: true,
            totalUnits: true,
            error: true,
            artifacts: {
              where: { kind: AgentDocumentAnalysisArtifactKind.final },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                sourceChunkIds: true,
                content: true,
              },
            },
          },
        },
      },
    });
    if (
      !attachment ||
      !attachment.contentHash ||
      attachment.documentCharCount === null
    ) {
      throw sourceMaterialNotFound();
    }
    const sourceAttachment = {
      contentHash: attachment.contentHash,
      documentCharCount: attachment.documentCharCount,
      documentIndex: attachment.documentIndex,
      documentIndexVersion: attachment.documentIndexVersion,
    };
    const index = requireSourceIndex(sourceAttachment);
    const job = attachment.analysisJobs[0];
    if (!job || job.sourceContentHash !== attachment.contentHash) {
      throw new ConflictException({
        code: 'STORY_SOURCE_ANALYSIS_LIFECYCLE_INVALID',
        message:
          'The durable source analysis job is missing or does not match this document version.',
      });
    }
    const progress = {
      completedUnits: job.completedUnits,
      totalUnits: job.totalUnits,
      percent: Math.min(
        100,
        Math.floor((job.completedUnits / job.totalUnits) * 100),
      ),
      stage: job.stage,
    };
    if (ACTIVE_ANALYSIS_STATUSES.has(job.status)) {
      return {
        status: 'succeeded',
        data: {
          schemaVersion: 'story-source-analysis-result/v1',
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          analysisVersion: job.analysisVersion,
          status: 'processing',
          progress,
          source: sourceIdentity(sourceAttachment, index),
          analysis: null,
          error: null,
        },
      };
    }
    if (job.status !== AgentDocumentAnalysisJobStatus.succeeded) {
      return {
        status: 'succeeded',
        data: {
          schemaVersion: 'story-source-analysis-result/v1',
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          analysisVersion: job.analysisVersion,
          status: 'failed',
          progress,
          source: sourceIdentity(sourceAttachment, index),
          analysis: null,
          error: safeAnalysisFailure(job.error),
        },
      };
    }
    const artifact = job.artifacts[0];
    if (!artifact) throw finalAnalysisInvalid();
    const content = AgentDocumentFinalAnalysisSchema.safeParse(
      artifact.content,
    );
    const allChunkIds = index.chunks.map((chunk) => chunk.id);
    if (
      !content.success ||
      content.data.sourceCoverage.chunkCount !== allChunkIds.length ||
      content.data.sourceCoverage.analyzedChunkCount !== allChunkIds.length ||
      content.data.sourceCoverage.missingChunkIds.length !== 0 ||
      !sameStrings(artifact.sourceChunkIds, allChunkIds)
    ) {
      throw finalAnalysisInvalid();
    }
    const projected = projectFinalAnalysis(content.data, args.lens, args.limit);
    const response = {
      schemaVersion: 'story-source-analysis-result/v1',
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      analysisVersion: job.analysisVersion,
      finalArtifactId: artifact.id,
      status: 'ready',
      progress,
      source: sourceIdentity(sourceAttachment, index),
      analysis: projected,
      error: null,
    };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      MAX_ANALYSIS_TOOL_PAYLOAD_BYTES
    ) {
      throw new ConflictException({
        code: 'STORY_SOURCE_ANALYSIS_PROJECTION_TOO_LARGE',
        message:
          'The bounded source analysis projection exceeded its tool payload contract.',
      });
    }
    return { status: 'succeeded', data: response };
  }

  async query(
    tx: Prisma.TransactionClient,
    rawRequest: AgentDomainToolRequest,
    rawArguments: unknown,
  ): Promise<AgentDomainToolResult> {
    const request = requireStoryRequest(rawRequest);
    const args = StorySourceMaterialQueryArgumentsSchema.parse(rawArguments);
    await this.authorize(tx, request);
    const attachment = await tx.agentPlatformAttachment.findFirst({
      where: {
        id: args.attachmentId,
        conversationId: request.scope.conversationId,
        ownerActorId: request.actor.id,
        kind: AgentPlatformAttachmentKind.document_text,
        status: AgentPlatformAttachmentStatus.ready,
        revokedAt: null,
      },
      select: {
        id: true,
        fileName: true,
        documentText: true,
        documentCharCount: true,
        contentHash: true,
        documentIndex: true,
        documentIndexVersion: true,
      },
    });
    if (!attachment) throw sourceMaterialNotFound();
    if (
      !attachment.documentText ||
      !attachment.contentHash ||
      attachment.documentCharCount !== attachment.documentText.length
    ) {
      throw new ConflictException({
        code: 'STORY_SOURCE_MATERIAL_INDEX_UNAVAILABLE',
        message:
          'The source document projection is incomplete. Re-register the attachment before querying it.',
      });
    }
    let index: StorySourceMaterialIndex;
    try {
      index = parsePersistedStorySourceMaterialIndex({
        value: attachment.documentIndex,
        schemaVersion: attachment.documentIndexVersion,
        expectedContentHash: attachment.contentHash,
        expectedCharacterCount: attachment.documentCharCount,
      });
    } catch {
      throw new ConflictException({
        code: 'STORY_SOURCE_MATERIAL_INDEX_UNAVAILABLE',
        message:
          'The source document index is missing or inconsistent. Re-register the attachment before querying it.',
      });
    }
    return {
      status: 'succeeded',
      data: queryStorySourceMaterial({
        attachmentId: attachment.id,
        text: attachment.documentText,
        index,
        query: args,
      }),
    };
  }

  private async authorize(
    tx: Prisma.TransactionClient,
    request: StoryRequest,
  ): Promise<void> {
    const authorization = await this.permissions.requireProjectInTransaction(
      tx,
      request.actor.id,
      request.scope.projectId,
      'story.read',
    );
    if (authorization.project.workspaceId !== request.scope.workspaceId) {
      throw sourceMaterialNotFound();
    }
  }
}

function requireSourceIndex(attachment: {
  contentHash: string;
  documentCharCount: number;
  documentIndex: Prisma.JsonValue;
  documentIndexVersion: string | null;
}): StorySourceMaterialIndex {
  try {
    return parsePersistedStorySourceMaterialIndex({
      value: attachment.documentIndex,
      schemaVersion: attachment.documentIndexVersion,
      expectedContentHash: attachment.contentHash,
      expectedCharacterCount: attachment.documentCharCount,
    });
  } catch {
    throw new ConflictException({
      code: 'STORY_SOURCE_MATERIAL_INDEX_UNAVAILABLE',
      message:
        'The source document index is missing or inconsistent. Re-register the attachment before querying it.',
    });
  }
}

function sourceIdentity(
  attachment: { contentHash: string; documentCharCount: number },
  index: StorySourceMaterialIndex,
) {
  return {
    contentHash: attachment.contentHash,
    characterCount: attachment.documentCharCount,
    chunkCount: index.chunks.length,
  };
}

type FinalAnalysis = AgentDocumentFinalAnalysis;
type FindingCategory =
  | 'storyStructure'
  | 'characters'
  | 'locations'
  | 'plotThreads'
  | 'continuityFindings'
  | 'themes'
  | 'productionRecommendations';
type Lens = StorySourceAnalysisQueryArguments['lens'];
type AnalysisFinding =
  | FinalAnalysis['storyStructure'][number]
  | FinalAnalysis['characters'][number];

const LENS_CATEGORY: Record<Exclude<Lens, 'overview'>, FindingCategory> = {
  structure: 'storyStructure',
  characters: 'characters',
  locations: 'locations',
  plot: 'plotThreads',
  continuity: 'continuityFindings',
  themes: 'themes',
  production: 'productionRecommendations',
};

function projectFinalAnalysis(
  analysis: FinalAnalysis,
  lens: Lens,
  limit: number,
) {
  const categories = Object.keys(LENS_CATEGORY).map(
    (key) => LENS_CATEGORY[key as Exclude<Lens, 'overview'>],
  );
  const selected =
    lens === 'overview'
      ? roundRobinFindings(analysis, categories, limit)
      : categoryFindings(analysis, LENS_CATEGORY[lens])
          .slice(0, limit)
          .map((finding) => [LENS_CATEGORY[lens], finding] as const);
  return {
    lens,
    executiveSummary: analysis.executiveSummary,
    sourceCoverage: analysis.sourceCoverage,
    findings: selected.map(([category, finding]) => ({
      category,
      label: 'label' in finding ? finding.label : finding.name,
      analysis:
        finding.analysis.length <= 900
          ? finding.analysis
          : `${finding.analysis.slice(0, 899)}…`,
      evidence: finding.evidence.slice(0, 2),
    })),
    truncated:
      selected.length <
      (lens === 'overview'
        ? categories.reduce(
            (total, category) => total + analysis[category].length,
            0,
          )
        : categoryFindings(analysis, LENS_CATEGORY[lens]).length),
  };
}

function roundRobinFindings(
  analysis: FinalAnalysis,
  categories: readonly FindingCategory[],
  limit: number,
) {
  const selected: Array<readonly [FindingCategory, AnalysisFinding]> = [];
  for (let ordinal = 0; selected.length < limit; ordinal += 1) {
    let found = false;
    for (const category of categories) {
      const finding = categoryFindings(analysis, category)[ordinal];
      if (!finding) continue;
      selected.push([category, finding]);
      found = true;
      if (selected.length === limit) break;
    }
    if (!found) break;
  }
  return selected;
}

function categoryFindings(
  analysis: FinalAnalysis,
  category: FindingCategory,
): readonly AnalysisFinding[] {
  switch (category) {
    case 'storyStructure':
      return analysis.storyStructure;
    case 'characters':
      return analysis.characters;
    case 'locations':
      return analysis.locations;
    case 'plotThreads':
      return analysis.plotThreads;
    case 'continuityFindings':
      return analysis.continuityFindings;
    case 'themes':
      return analysis.themes;
    case 'productionRecommendations':
      return analysis.productionRecommendations;
  }
}

function safeAnalysisFailure(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      code: 'STORY_SOURCE_ANALYSIS_FAILED',
      message:
        'The durable source analysis did not complete. Retry the analysis before requesting a whole-document result.',
      retryable: true,
    };
  }
  return {
    code:
      typeof value.code === 'string'
        ? value.code.slice(0, 128)
        : 'STORY_SOURCE_ANALYSIS_FAILED',
    message:
      typeof value.message === 'string'
        ? value.message.slice(0, 2_000)
        : 'The durable source analysis did not complete.',
    retryable: typeof value.retryable === 'boolean' ? value.retryable : true,
  };
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function finalAnalysisInvalid(): ConflictException {
  return new ConflictException({
    code: 'STORY_SOURCE_ANALYSIS_FINAL_INVALID',
    message:
      'The final source analysis is missing, malformed, or does not cover every indexed source section.',
  });
}

function requireStoryRequest(request: AgentDomainToolRequest): StoryRequest {
  if (request.scope.surface !== 'story-studio') {
    throw new ConflictException({
      code: 'AGENT_DOMAIN_SCOPE_MISMATCH',
      message:
        'Story source material can only be queried from a signed Story Studio scope.',
    });
  }
  return request as StoryRequest;
}

function sourceMaterialNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_SOURCE_MATERIAL_NOT_FOUND',
    message: 'The source document is not available in this Story conversation.',
  });
}
