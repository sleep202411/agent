import type { AssetEvent } from '@repo/shared';
import { redactProviderAssetRefs } from '../characters/asset-ref.util';
import type { AiJob } from './types';

export function toAiJobEvent(job: AiJob): AssetEvent {
  return {
    kind: 'ai_job_update',
    ts: Date.now(),
    job: {
      id: job.id,
      type: job.type,
      workspaceId: job.workspaceId ?? null,
      projectId: job.projectId ?? null,
      documentId: job.documentId ?? null,
      sourceSurface: job.sourceSurface ?? null,
      modelId: job.modelId,
      status: job.status,
      stage: job.stage,
      prompt: job.prompt,
      // asset:// provider handles are stripped — never leave the server (§2.3).
      input: redactProviderAssetRefs(job.normalizedInput) ?? undefined,
      outputs: job.outputs.map((o) => ({
        id: o.id,
        assetId: o.assetId,
        type: o.type,
        url: o.url,
        accessUrl: o.accessUrl,
        width: o.width,
        height: o.height,
        mimeType: o.mimeType,
        createdAt: o.createdAt,
      })),
      error: job.error
        ? {
            code: job.error.code,
            userMessage: job.error.userMessage,
            retryable: job.error.retryable,
          }
        : undefined,
      queuePosition: job.queuePosition ?? null,
      progress: job.progress ?? null,
      estimatedWaitSeconds: job.estimatedWaitSeconds ?? null,
      estimatedRunSeconds: job.estimatedRunSeconds ?? null,
      estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
      etaConfidence: job.etaConfidence ?? 'low',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
  };
}
