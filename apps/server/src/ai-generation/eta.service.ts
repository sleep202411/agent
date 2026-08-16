import { Injectable } from '@nestjs/common';
import type { AiEtaConfidence, AiJob, AiModelDefinition } from './types';

export interface AiEta {
  estimatedWaitSeconds: number;
  estimatedRunSeconds: number;
  estimatedTotalSeconds: number;
  etaConfidence: AiEtaConfidence;
}

@Injectable()
export class AiGenerationEtaService {
  estimateForNewJob(
    model: AiModelDefinition,
    input: Record<string, unknown>,
    queuePosition: number,
  ): AiEta {
    const estimatedRunSeconds = this.estimateRunSeconds(model, input);
    const concurrency = Math.max(1, model.queue.globalConcurrency);
    const estimatedWaitSeconds = Math.ceil(
      (queuePosition * estimatedRunSeconds) / concurrency,
    );
    return {
      estimatedWaitSeconds,
      estimatedRunSeconds,
      estimatedTotalSeconds: estimatedWaitSeconds + estimatedRunSeconds,
      etaConfidence: 'low',
    };
  }

  estimateForJob(job: AiJob, model: AiModelDefinition): AiEta {
    const run = this.estimateRunSeconds(model, job.normalizedInput);
    const wait =
      typeof job.queuePosition === 'number'
        ? Math.max(0, job.queuePosition)
        : 0;
    const concurrency = Math.max(1, model.queue.globalConcurrency);
    const estimatedWaitSeconds = Math.ceil((wait * run) / concurrency);
    return {
      estimatedWaitSeconds,
      estimatedRunSeconds: run,
      estimatedTotalSeconds: estimatedWaitSeconds + run,
      etaConfidence: job.etaConfidence ?? 'low',
    };
  }

  private estimateRunSeconds(
    model: AiModelDefinition,
    input: Record<string, unknown>,
  ): number {
    if (model.type === 'image') {
      const n = Math.max(1, Number(input.n) || 1);
      const quality =
        typeof input.quality === 'string' ? input.quality : 'medium';
      const qualityFactor =
        quality === 'high' ? 1.4 : quality === 'low' ? 0.75 : 1;
      return Math.ceil(75 * n * qualityFactor);
    }

    if (model.type === 'audio') {
      const requestedSeconds = Number(
        input.durationSeconds ?? input.duration ?? 0,
      );
      const seconds = Number.isFinite(requestedSeconds)
        ? Math.max(0, requestedSeconds)
        : 0;
      return Math.ceil(12 + seconds * 1.5);
    }

    const seconds = Math.max(1, Number(input.seconds) || 4);
    const size = typeof input.size === 'string' ? input.size : '';
    const resolutionFactor =
      size.includes('1920') || size.includes('1080') ? 1.6 : 1;
    return Math.ceil((90 + seconds * 35) * resolutionFactor);
  }
}
