/**
 * BullMQ queue + worker wiring for AI generation.
 *
 * Two queues, one per job type, so image throughput doesn't share a
 * concurrency budget with video (which is slower and rarer). Each
 * queue owns a separate Redis prefix space; Bull's stalled detection
 * and delayed-job timers apply per-queue.
 *
 * Submit path:    queue.add('process', { jobId, op }, { jobId: uniqueQueueJobId, delay })
 * Worker path:    Worker('ai-image-generation', async (job) => ..., { connection })
 *
 * payload.jobId === DB jobId. BullMQ's queue job id is unique per
 * enqueue attempt so the same DB job can be requeued for retries and
 * async-provider polls. The DB row is the source of truth for
 * inputs/outputs; the queue payload is only `{ jobId, op }` (`start`
 * or async-provider `poll`) — workers re-read the row to avoid stale
 * data.
 */
import IORedis, { type Redis } from 'ioredis';
import { Queue, Worker, type Processor } from 'bullmq';

export const AI_QUEUE_IMAGE = 'ai-image-generation';
export const AI_QUEUE_VIDEO = 'ai-video-generation';

export type AiQueueName = typeof AI_QUEUE_IMAGE | typeof AI_QUEUE_VIDEO;

export interface AiQueueJobData {
  jobId: string;
  op?: 'start' | 'poll';
}

/**
 * Dedicated BullMQ connection. BullMQ requires `maxRetriesPerRequest:
 * null` because it issues BRPOPLPUSH-style blocking commands that
 * shouldn't be auto-reconnected mid-block.
 */
export function createAiRedisConnection(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380';
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export function createAiQueue(
  name: AiQueueName,
  connection: Redis,
): Queue<AiQueueJobData> {
  return new Queue<AiQueueJobData>(name, {
    connection,
    defaultJobOptions: {
      // Successful jobs disappear after 24h (the DB row keeps the
      // permanent record). Failed jobs stay 7d for triage.
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
      // BullMQ-side retry attempts. We layer our own retry on top
      // for finer-grained backoff (the worker requeues with custom
      // delays based on error type), so this is a safety cap.
      attempts: 1,
    },
  });
}

export function createAiWorker(
  name: AiQueueName,
  processor: Processor<AiQueueJobData>,
  connection: Redis,
  concurrency: number,
): Worker<AiQueueJobData> {
  return new Worker<AiQueueJobData>(name, processor, {
    connection,
    concurrency,
    // How long a job can hold the lock before BullMQ flags it stalled
    // and re-claims. Set to longer than the longest expected runJob
    // (gpt-image-2 high can exceed 180s).
    lockDuration: 5 * 60_000,
    stalledInterval: 30_000,
  });
}
