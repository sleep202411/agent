import { Injectable, Logger } from '@nestjs/common';
import type { AiJob } from './types';

/**
 * Product planes may attach durable domain state to a generic generation job.
 * The observer runs only after the canonical completed AiJob and all of its
 * output rows have committed. Observers MUST be idempotent: this callback is a
 * low-latency signal, while each product remains responsible for reconciling a
 * missed callback after a crash or deployment.
 */
export interface AiGenerationCompletionObserver {
  onAiGenerationCompleted(job: AiJob): Promise<void>;
}

@Injectable()
export class AiGenerationCompletionObserverRegistry {
  private readonly logger = new Logger(
    AiGenerationCompletionObserverRegistry.name,
  );
  private readonly observers = new Set<AiGenerationCompletionObserver>();

  register(observer: AiGenerationCompletionObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  async notifyCompleted(job: AiJob): Promise<void> {
    for (const observer of this.observers) {
      try {
        await observer.onAiGenerationCompleted(job);
      } catch (error) {
        // Completion already committed and must never be rolled back or made
        // invisible because a product projection is temporarily unavailable.
        // The product's durable reconciliation loop will replay this job.
        this.logger.error(
          `completion observer failed for AiJob ${job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
