import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { TaskWorker } from './task.worker';

const QUEUE_NAME = 'pipeline-tasks';

/**
 * BullMQ-backed task queue.
 * - API process calls enqueue() to add tasks
 * - Worker process (or in-process) picks up and executes
 */
@Injectable()
export class TaskQueue implements OnModuleDestroy {
  private readonly logger = new Logger(TaskQueue.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — TaskQueue disabled');
      return;
    }

    const connection = parseRedisConnection(redisUrl);

    this.queue = new Queue(QUEUE_NAME, { connection });
    this.logger.log('TaskQueue initialized');
  }

  /**
   * Start processing jobs. Call this in the worker process
   * (or in the API process for single-server setups).
   */
  startWorker(taskWorker: TaskWorker): void {
    if (!this.queue) return;

    const connection = this.queue.opts?.connection;
    if (!connection) return;

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<{ taskId: string }>) => {
        this.logger.log(
          `[worker] Processing job ${job.id} taskId=${job.data.taskId}`,
        );
        await taskWorker.processTask(job.data.taskId);
      },
      {
        connection,
        concurrency: 1, // One task at a time per worker instance
        limiter: {
          max: 1,
          duration: 1000,
        },
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`[worker] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`[worker] Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log('TaskQueue worker started');
  }

  /**
   * Add a task to the queue.
   */
  async enqueue(taskId: string): Promise<void> {
    if (!this.queue) {
      this.logger.warn('TaskQueue not available, skipping enqueue');
      return;
    }

    await this.queue.add(
      'pipeline-task',
      { taskId },
      {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1, // No auto-retry at job level — retries happen inside worker
      },
    );

    this.logger.log(`[enqueue] taskId=${taskId}`);
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
  }
}

function parseRedisConnection(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}
