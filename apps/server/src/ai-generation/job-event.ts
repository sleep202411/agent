import type { AssetEvent } from '@repo/shared';
import type { AiJob } from './types';

export function toAiJobEvent(job: AiJob): AssetEvent {
  return {
    kind: 'ai_job_update',
    ts: Date.now(),
    job: {
      id: job.id,
      type: job.type,
      modelId: job.modelId,
      status: job.status,
      stage: job.stage,
      prompt: job.prompt,
      input: job.normalizedInput,
      outputs: job.outputs.map((o) => ({
        id: o.id,
        type: o.type,
        url: o.url,
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
      estimatedTotalSeconds: job.estimatedTotalSeconds ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    },
  };
}
