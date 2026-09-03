import { AiJobStatus, type Prisma } from '@prisma/client';

export interface StoryProductionGenerationTargetLink {
  projectId: string;
  chapterId: string;
  generationId: string;
  target:
    | { kind: 'asset_spec'; id: string }
    | { kind: 'storyboard_clip'; id: string; sequenceId: string };
}

interface StoryProductionGenerationProgressRow {
  submissionSnapshot: Prisma.JsonValue;
  materializedAt: Date | null;
  materializationError: Prisma.JsonValue | null;
  reconcileAttempts: number;
  nextReconcileAt: Date | null;
  aiJob: {
    id: string;
    modelId: string;
    schemaVersion: string;
    status: AiJobStatus;
    stage: string;
    progress: number | null;
    queuePosition: number | null;
    estimatedWaitSeconds: number | null;
    estimatedRunSeconds: number | null;
    estimatedTotalSeconds: number | null;
    etaConfidence: string | null;
    error: Prisma.JsonValue | null;
  };
}

export function storyProductionGenerationBasePath(
  input: StoryProductionGenerationTargetLink,
): string {
  const chapterPath = `/aurora/story-projects/${input.projectId}/chapters/${input.chapterId}`;
  if (input.target.kind === 'asset_spec') {
    return `${chapterPath}/asset-specs/${input.target.id}/generations/${input.generationId}`;
  }
  return `${chapterPath}/storyboard/sequences/${input.target.sequenceId}/clips/${input.target.id}/generations/${input.generationId}`;
}

export function toStoryProductionGenerationProgressDto(
  row: StoryProductionGenerationProgressRow,
) {
  const requestedOutputCount = storyGenerationRequestedOutputCount(
    row.submissionSnapshot,
  );
  const materializationError = jsonObject(row.materializationError);
  const hasMaterializationError = Object.keys(materializationError).length > 0;
  const attachmentRetryable = materializationError.attachmentRetryable === true;
  const materializationStatus = row.materializedAt
    ? 'completed'
    : row.aiJob.status === AiJobStatus.completed &&
        hasMaterializationError &&
        row.nextReconcileAt === null
      ? 'failed'
      : row.aiJob.status === AiJobStatus.completed
        ? 'pending'
        : 'waiting_for_job';

  return {
    requestedOutputCount,
    aiJob: {
      id: row.aiJob.id,
      modelId: row.aiJob.modelId,
      schemaVersion: row.aiJob.schemaVersion,
      status: row.aiJob.status,
      stage: row.aiJob.stage,
      progress: row.aiJob.progress,
      queuePosition: row.aiJob.queuePosition,
      estimatedWaitSeconds: row.aiJob.estimatedWaitSeconds,
      estimatedRunSeconds: row.aiJob.estimatedRunSeconds,
      estimatedTotalSeconds: row.aiJob.estimatedTotalSeconds,
      etaConfidence: row.aiJob.etaConfidence,
      error: row.aiJob.error,
    },
    materialization: {
      status: materializationStatus,
      attempts: row.reconcileAttempts,
      canRetry: materializationStatus === 'failed' && attachmentRetryable,
      error: hasMaterializationError ? materializationError : null,
      materializedAt: row.materializedAt?.toISOString() ?? null,
      nextReconcileAt: row.nextReconcileAt?.toISOString() ?? null,
    },
  };
}

function storyGenerationRequestedOutputCount(
  submissionSnapshot: Prisma.JsonValue,
): number {
  const effectiveOptions = jsonObject(
    jsonObject(submissionSnapshot).effectiveOptions,
  );
  const value = effectiveOptions.numOutputs;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
