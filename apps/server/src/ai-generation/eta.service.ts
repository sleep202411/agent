import { Injectable } from '@nestjs/common';
import type { AiEtaConfidence, AiJob, FoundryModelDefinition } from './types';

export interface AiEta {
  estimatedWaitSeconds: number;
  estimatedRunSeconds: number;
  estimatedTotalSeconds: number;
  etaConfidence: AiEtaConfidence;
}

@Injectable()
export class AiGenerationEtaService {
  estimateForNewJob(
    model: FoundryModelDefinition,
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

  estimateForJob(job: AiJob, model: FoundryModelDefinition): AiEta {
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
    model: FoundryModelDefinition,
    input: Record<string, unknown>,
  ): number {
    if (model.type === 'image') {
      const n = Math.max(1, Number(input.n) || 1);
      const quality = String(input.quality ?? 'medium');
      const qualityFactor =
        quality === 'high' ? 1.4 : quality === 'low' ? 0.75 : 1;
      return Math.ceil(75 * n * qualityFactor);
    }

    const seconds = Math.max(1, Number(input.seconds) || 4);
    const size = String(input.size ?? '');
    const resolutionFactor =
      size.includes('1920') || size.includes('1080') ? 1.6 : 1;
    return Math.ceil((90 + seconds * 35) * resolutionFactor);
  }
}
