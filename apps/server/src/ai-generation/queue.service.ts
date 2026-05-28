/**
 * AiGenerationQueueService — thin DI wrapper around the BullMQ Queue
 * instances. Other modules call `enqueue(queueName, jobId, delayMs?)`
 * instead of holding their own Queue references.
 *
 * Lifecycle: queues are constructed lazily on first use and closed in
 * onApplicationShutdown so SIGTERM doesn't leak Redis connections.
 */
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  createAiQueue,
  createAiRedisConnection,
  type AiQueueJobData,
  type AiQueueName,
} from './queue';

@Injectable()
export class AiGenerationQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(AiGenerationQueueService.name);
  private connection: Redis | null = null;
  private readonly queues = new Map<AiQueueName, Queue<AiQueueJobData>>();

  async enqueue(
    queueName: AiQueueName,
    jobId: string,
    delayMs = 0,
    /**
     * BullMQ priority — smaller = served first. The submit path freezes
     * this value from the entitlement policy snapshot, so later plan
     * changes do not reshuffle an accepted job.
     */
    priority = 5,
    op: AiQueueJobData['op'] = 'start',
  ): Promise<void> {
    const queue = this.queueFor(queueName);
    // BullMQ jobIds must be globally unique within the queue and
    // cannot contain `:` (it reserves that as a Redis key separator).
    // Suffix with a monotonic millisecond stamp so a single DB job
    // can be enqueued multiple times (initial submission + N retries)
    // without colliding. The DB jobId stays in the payload so the
    // worker always reads the canonical row.
    const queueJobId = `${jobId}__${op ?? 'start'}__${Date.now().toString(36)}`;
    await queue.add(
      'process',
      { jobId, op },
      {
        jobId: queueJobId,
        delay: delayMs > 0 ? delayMs : undefined,
        priority,
      },
    );
  }

  /** Used by the worker to subscribe to the same connection. */
  getConnection(): Redis {
    if (!this.connection) {
      this.connection = createAiRedisConnection();
    }
    return this.connection;
  }

  private queueFor(name: AiQueueName): Queue<AiQueueJobData> {
    let q = this.queues.get(name);
    if (!q) {
      q = createAiQueue(name, this.getConnection());
      this.queues.set(name, q);
    }
    return q;
  }

  async onApplicationShutdown() {
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `queue close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (this.connection) {
      try {
        await this.connection.quit();
      } catch (err) {
        this.logger.warn(
          `redis quit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

export { AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from './queue';
export type { AiQueueName } from './queue';
