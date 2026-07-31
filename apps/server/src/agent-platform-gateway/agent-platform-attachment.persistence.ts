import { HttpException } from '@nestjs/common';
import {
  AgentDocumentAnalysisArtifactKind,
  AgentPlatformAttachmentIngestJobStatus,
  Prisma,
} from '@prisma/client';
import type { AgentAttachmentSummary } from '@repo/shared/agent-platform';

import { agentAttachmentUri } from './agent-platform-attachment.dto';

export const AGENT_DOCUMENT_ANALYSIS_VERSION =
  'story-document-analysis/v1' as const;
export const AGENT_DOCUMENT_REDUCE_FAN_IN = 8;

export const AGENT_ATTACHMENT_MEDIA_ASSET_SELECT = {
  id: true,
  workspaceId: true,
  kind: true,
  status: true,
  source: true,
  moderationStatus: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  checksumSha256: true,
  metadata: true,
  createdByUserId: true,
  deletedAt: true,
} satisfies Prisma.MediaAssetSelect;

export type AgentAttachmentMediaAssetRow = Prisma.MediaAssetGetPayload<{
  select: typeof AGENT_ATTACHMENT_MEDIA_ASSET_SELECT;
}>;

export const PUBLIC_ATTACHMENT_SELECT = {
  id: true,
  conversationId: true,
  mediaAssetId: true,
  ownerActorId: true,
  kind: true,
  status: true,
  fileName: true,
  mediaType: true,
  locale: true,
  sizeBytes: true,
  documentText: true,
  documentCharCount: true,
  documentPageCount: true,
  contentHash: true,
  documentIndex: true,
  documentIndexVersion: true,
  error: true,
  readyAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  ingestJob: {
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      stage: true,
      progress: true,
      availableAt: true,
      error: true,
    },
  },
  analysisJobs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      stage: true,
      completedUnits: true,
      totalUnits: true,
      error: true,
      artifacts: {
        where: { kind: AgentDocumentAnalysisArtifactKind.final },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  },
} satisfies Prisma.AgentPlatformAttachmentSelect;

export type PublicAttachmentRow = Prisma.AgentPlatformAttachmentGetPayload<{
  select: typeof PUBLIC_ATTACHMENT_SELECT;
}>;

export type AgentAttachmentFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export function toAttachmentSummary(
  attachment: PublicAttachmentRow,
): AgentAttachmentSummary {
  const ingest = attachment.ingestJob;
  const analysis = attachment.analysisJobs[0] ?? null;
  return {
    schemaVersion: 'agent-attachment/v1',
    id: attachment.id,
    conversationId: attachment.conversationId,
    mediaAssetId: attachment.mediaAssetId,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes.toString(),
    status: attachment.status,
    uri: agentAttachmentUri(attachment.id),
    ingest: ingest
      ? {
          stage: ingest.stage,
          progress: ingest.progress,
          attempt: ingest.attemptCount,
          maximumAttempts: ingest.maxAttempts,
          nextAttemptAt:
            ingest.status === AgentPlatformAttachmentIngestJobStatus.retry_wait
              ? ingest.availableAt.toISOString()
              : null,
        }
      : null,
    analysis: analysis
      ? {
          jobId: analysis.id,
          status: analysis.status,
          stage: analysis.stage,
          completedUnits: analysis.completedUnits,
          totalUnits: analysis.totalUnits,
          progress: Math.min(
            100,
            Math.floor((analysis.completedUnits / analysis.totalUnits) * 100),
          ),
          finalArtifactId: analysis.artifacts[0]?.id ?? null,
          error: parseAttachmentFailure(analysis.error),
        }
      : null,
    error: parseAttachmentFailure(attachment.error),
  };
}

export function parseAttachmentFailure(
  value: Prisma.JsonValue | null | undefined,
): AgentAttachmentFailure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = value.code;
  const message = value.message;
  const retryable = value.retryable;
  return typeof code === 'string' &&
    typeof message === 'string' &&
    typeof retryable === 'boolean'
    ? {
        code: code.slice(0, 128),
        message: message.slice(0, 2_000),
        retryable,
      }
    : null;
}

export function displayableAttachmentFailure(
  error: unknown,
): AgentAttachmentFailure {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const record =
      typeof response === 'string'
        ? { message: response }
        : (response as Record<string, unknown>);
    return {
      code:
        typeof record.code === 'string'
          ? record.code.slice(0, 128)
          : 'AGENT_ATTACHMENT_PROCESSING_FAILED',
      message:
        typeof record.message === 'string'
          ? record.message.slice(0, 2_000)
          : 'The attachment could not be processed.',
      retryable:
        typeof record.retryable === 'boolean'
          ? record.retryable
          : error.getStatus() === 429 || error.getStatus() >= 500,
    };
  }
  return {
    code: 'AGENT_ATTACHMENT_PROCESSING_FAILED',
    message: 'The attachment could not be processed.',
    retryable: true,
  };
}

export function documentAnalysisTotalUnits(chunkCount: number): number {
  if (!Number.isSafeInteger(chunkCount) || chunkCount <= 0) {
    throw new RangeError('Document analysis requires at least one chunk.');
  }
  let remaining = chunkCount;
  let total = chunkCount;
  while (remaining > 1) {
    remaining = Math.ceil(remaining / AGENT_DOCUMENT_REDUCE_FAN_IN);
    total += remaining;
  }
  return total + 1;
}
