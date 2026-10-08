import { backgroundTasksEnabled } from '../common/background-tasks';
import { PrismaService } from '../infra/db/db.module';
/**
 * AiGenerationQueueService — durable job reconciliation and BullMQ Queue
 * instances. Other modules call `enqueue(queueName, jobId, delayMs?)`
 * instead of holding their own Queue references.
 *
 * Lifecycle: queues are constructed lazily on first use and closed in
 * onApplicationShutdown so SIGTERM doesn't leak Redis connections.
 */
import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  createAiQueue,
  createAiRedisConnection,
  type AiQueueJobData,
  type AiQueueName,
} from './queue';

@Injectable()
export class AiGenerationQueueService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AiGenerationQueueService.name);
  private connection: Redis | null = null;
  private producerConnection: Redis | null = null;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private recoveryRun?: Promise<void>;
  private recoveryCursor?: string;
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (!backgroundTasksEnabled()) return;
    const recover = () => {
      if (this.recoveryRun) return;
      this.recoveryRun = this.recoverQueuedJobs()
        .catch((error: unknown) =>
          this.logger.error(
            `Queued generation recovery failed: ${String(error)}`,
          ),
        )
        .finally(() => {
          this.recoveryRun = undefined;
        });
    };
    recover();
    this.recoveryTimer = setInterval(recover, 30_000);
    this.recoveryTimer.unref();
  }

  private async recoverQueuedJobs(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    // Durable rows recover missing starts and polling, including exhausted queue
    // retries. Unknown acceptance and terminal work are never resubmitted.
    const jobs = await this.prisma.aiJob.findMany({
      where: {
        ...(this.recoveryCursor ? { id: { gt: this.recoveryCursor } } : {}),
        deletedAt: null,
        OR: [
          {
            status: 'in_queue',
            queuedAt: { lte: new Date(Date.now() - 30_000) },
          },
          {
            status: 'in_progress',
            providerJobId: { not: null },
            updatedAt: { lte: new Date(Date.now() - 30_000) },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: {
        id: true,
        queueName: true,
        version: true,
        status: true,
        routingSnapshot: true,
      },
    });
    this.recoveryCursor =
      jobs.length === 100 ? jobs[jobs.length - 1].id : undefined;
    for (const job of jobs) {
      if (this.stopping) break;
      if (
        ![
          'ai-image-generation',
          'ai-video-generation',
          'ai-audio-generation',
        ].includes(job.queueName)
      )
        continue;
      try {
        const snapshot = job.routingSnapshot as {
          policy?: { entitlement?: { queuePriority?: number } };
        } | null;
        if (job.status === 'in_progress') {
          await this.enqueue(
            job.queueName as AiQueueName,
            job.id,
            0,
            snapshot?.policy?.entitlement?.queuePriority ?? 5,
            'poll',
          );
          continue;
        }
        const queue = this.queueFor(job.queueName as AiQueueName);
        const recoveryId = `${job.id}__recover__${job.version}`;
        const existing = await queue.getJob(recoveryId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'failed') {
            await existing.retry('failed');
            continue;
          }
          if (state === 'completed') await existing.remove();
        }
        await queue.add(
          'process',
          { jobId: job.id, op: 'start' },
          {
            jobId: recoveryId,
            priority: snapshot?.policy?.entitlement?.queuePriority ?? 5,
          },
        );
      } catch (error: unknown) {
        // A removed/locked queue entry or a queue-specific failure must not
        // starve every later row in this page. Keep the database row intact;
        // the cursor wraps and retries it on a subsequent recovery scan.
        this.logger.warn(
          `Generation recovery dispatch failed for ${job.id} (${job.queueName}, ${job.status}): ${String(error)}`,
        );
      }
    }
  }

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
    // The job row is durable in Postgres; paused cells leave it for recovery
    // without connecting to a possibly shared production Redis queue.
    if (!backgroundTasksEnabled()) return;
    const queue = this.queueFor(queueName);
    // BullMQ jobIds must be globally unique within the queue and
    // cannot contain `:` (it reserves that as a Redis key separator).
    // Suffix with a monotonic millisecond stamp so a single DB job
    // can be enqueued multiple times (initial submission + N retries)
    // without colliding. The DB jobId stays in the payload so the
    // worker always reads the canonical row.
    const queueJobId =
      op === 'poll'
        ? `${jobId}__poll`
        : `${jobId}__start__${Date.now().toString(36)}`;
    if (op === 'poll') {
      const existing = await queue.getJob(queueJobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'active' && delayMs > 0) {
          // Preserve the current poll's backoff until completion dispatch.
          await existing.updateData({
            ...existing.data,
            nextPollAt: Math.max(
              existing.data.nextPollAt ?? 0,
              Date.now() + delayMs,
            ),
          });
        }
        if (state !== 'completed' && state !== 'failed' && state !== 'unknown')
          return;
        delayMs = Math.max(
          delayMs,
          (existing.data.nextPollAt ?? 0) - Date.now(),
        );
        // BullMQ refuses removal of locked active work. A concurrent recovery
        // cannot create a second active poll under this fixed ID.
        await existing.remove();
      }
    }
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
    if (!backgroundTasksEnabled())
      throw new ConflictException(
        'Background tasks are disabled in this environment.',
      );
    if (!this.connection) {
      this.connection = createAiRedisConnection();
    }
    return this.connection;
  }

  private queueFor(name: AiQueueName): Queue<AiQueueJobData> {
    if (!backgroundTasksEnabled())
      throw new ConflictException(
        'Background tasks are disabled in this environment.',
      );
    let q = this.queues.get(name);
    if (!q) {
      // Producers must reject unavailable Redis operations. Workers retain
      // unlimited reconnects on their separate blocking connection.
      this.producerConnection ??= createAiRedisConnection(false);
      q = createAiQueue(name, this.producerConnection);
      this.queues.set(name, q);
    }
    return q;
  }

  async onApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.recoveryTimer);
    await this.recoveryRun;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `queue close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.producerConnection?.disconnect();
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

export { AI_QUEUE_AUDIO, AI_QUEUE_IMAGE, AI_QUEUE_VIDEO } from './queue';
export type { AiQueueName } from './queue';
