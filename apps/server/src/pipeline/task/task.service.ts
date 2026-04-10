import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import type {
  PipelineTask,
  TaskProgressEvent,
  CreateTaskInput,
  TaskGuardConfig,
} from './task.types';

const KEY_PREFIX = 'pipeline-task:';
const CHANNEL_PREFIX = 'pipeline-task-progress:';
const TTL_SECONDS = 24 * 3600;

@Injectable()
export class TaskService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskService.name);
  private readonly redis: Redis | null;
  private readonly pubRedis: Redis | null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) =>
          times > 10 ? null : Math.min(times * 500, 5000),
        lazyConnect: true,
      });
      // Separate connection for pub/sub (ioredis requirement)
      this.pubRedis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) =>
          times > 10 ? null : Math.min(times * 500, 5000),
        lazyConnect: true,
      });
      this.redis.on('connect', () =>
        this.logger.log('TaskService Redis connected'),
      );
      this.redis.on('error', (err) =>
        this.logger.error(`TaskService Redis error: ${err.message}`),
      );
      void this.redis.connect().catch(() => {});
      void this.pubRedis.connect().catch(() => {});
    } else {
      this.logger.warn(
        'REDIS_URL not configured — TaskService will use in-memory fallback',
      );
      this.redis = null;
      this.pubRedis = null;
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
    await this.pubRedis?.quit().catch(() => {});
  }

  // ─── Create ──────────────────────────────────────────

  private guardConfig: TaskGuardConfig = {};

  /**
   * Configure task guards (billing, permissions, limits).
   * Call once at startup to enable. If not called, all tasks are allowed.
   */
  setGuardConfig(config: TaskGuardConfig): void {
    this.guardConfig = config;
    this.logger.log(
      `[setGuardConfig] maxConcurrentPerUser=${config.maxConcurrentPerUser ?? 'unlimited'}, maxQueueDepth=${config.maxQueueDepth ?? 'unlimited'}`,
    );
  }

  // ─── Create ──────────────────────────────────────────

  async create(input: CreateTaskInput): Promise<PipelineTask> {
    // Guard: pre-create hook (permissions, credits check)
    if (this.guardConfig.preCreate) {
      const check = await this.guardConfig.preCreate(input);
      if (!check.allowed) {
        throw new Error(check.reason ?? 'Task creation not allowed');
      }
    }

    // Enforce concurrency and queue depth limits
    if (input.userId && this.redis) {
      const { maxConcurrentPerUser, maxQueueDepth } = this.guardConfig;

      if (maxConcurrentPerUser) {
        const activeCount = await this.countUserTasks(input.userId, [
          'queued',
          'processing',
        ]);
        if (activeCount >= maxConcurrentPerUser) {
          throw new Error(
            `Too many active tasks (${activeCount}/${maxConcurrentPerUser}). Please wait for current tasks to complete.`,
          );
        }
      }

      if (maxQueueDepth) {
        const queuedCount = await this.countUserTasks(input.userId, ['queued']);
        if (queuedCount >= maxQueueDepth) {
          throw new Error(
            `Queue is full (${queuedCount}/${maxQueueDepth}). Please wait for tasks to start processing.`,
          );
        }
      }
    }

    const task: PipelineTask = {
      id: randomUUID(),
      type: input.type,
      projectId: input.projectId,
      userId: input.userId,
      sessionId: input.sessionId,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      chunksTotal: 0,
      chunksCompleted: 0,
      message: 'Task queued',
      createdAt: Date.now(),
      input: input.input,
    };

    await this.saveTask(task);
    this.logger.log(
      `[create] task=${task.id} type=${task.type} project=${task.projectId} user=${task.userId ?? 'unknown'}`,
    );
    return task;
  }

  /**
   * Count active tasks for a user by status.
   */
  private async countUserTasks(
    userId: string,
    statuses: string[],
  ): Promise<number> {
    if (!this.redis) return 0;
    // Scan all task keys and count matching userId + status
    // For production scale, consider a dedicated user→taskIds index in Redis
    let count = 0;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'pipeline-task:*',
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        if (key.includes(':text') || key.includes(':chunk')) continue;
        pipeline.get(key);
      }
      const results = await pipeline.exec();
      for (const [err, val] of results ?? []) {
        if (err || !val) continue;
        try {
          const task = JSON.parse(val as string) as PipelineTask;
          if (task.userId === userId && statuses.includes(task.status)) {
            count++;
          }
        } catch {
          // skip malformed
        }
      }
    } while (cursor !== '0');
    return count;
  }

  /**
   * Called by worker when task completes. Triggers postComplete hook (billing).
   */
  async markCompleted(task: PipelineTask): Promise<void> {
    if (this.guardConfig.postComplete && task.status === 'done') {
      try {
        const billing = await this.guardConfig.postComplete(task);
        task.creditsCharged = billing.creditsCharged;
        await this.saveTask(task);
        this.logger.log(
          `[markCompleted] task=${task.id} charged=${billing.creditsCharged} credits`,
        );
      } catch (error) {
        this.logger.error(
          `[markCompleted] billing failed for task=${task.id}: ${error}`,
        );
      }
    }
  }

  // ─── Read ────────────────────────────────────────────

  async getTask(taskId: string): Promise<PipelineTask | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(`${KEY_PREFIX}${taskId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PipelineTask;
    } catch {
      return null;
    }
  }

  // ─── Update Progress ─────────────────────────────────

  async updateProgress(
    taskId: string,
    update: Partial<
      Pick<
        PipelineTask,
        | 'status'
        | 'phase'
        | 'progress'
        | 'chunksTotal'
        | 'chunksCompleted'
        | 'message'
        | 'startedAt'
        | 'completedAt'
        | 'result'
        | 'error'
      >
    >,
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) return;

    Object.assign(task, update);
    await this.saveTask(task);

    // Publish progress event
    const event: TaskProgressEvent = {
      taskId,
      status: task.status,
      phase: task.phase,
      progress: task.progress,
      chunksTotal: task.chunksTotal,
      chunksCompleted: task.chunksCompleted,
      message: task.message,
      result: task.status === 'done' ? task.result : undefined,
      error: task.error,
    };
    await this.publishProgress(taskId, event);
  }

  // ─── Cancel ──────────────────────────────────────────

  async cancel(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) return false;
    if (task.status === 'done' || task.status === 'failed') return false;

    await this.updateProgress(taskId, {
      status: 'cancelled',
      message: 'Task cancelled by user',
      completedAt: Date.now(),
    });
    return true;
  }

  // ─── Chunk Cache (for resume) ────────────────────────

  async saveChunkResult(
    taskId: string,
    chunkIndex: number,
    result: unknown,
  ): Promise<void> {
    if (!this.redis) return;
    const key = `${KEY_PREFIX}${taskId}:chunk:${chunkIndex}`;
    await this.redis.set(key, JSON.stringify(result), 'EX', TTL_SECONDS);
  }

  async getChunkResult(
    taskId: string,
    chunkIndex: number,
  ): Promise<unknown | null> {
    if (!this.redis) return null;
    const raw = await this.redis.get(
      `${KEY_PREFIX}${taskId}:chunk:${chunkIndex}`,
    );
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ─── Text Storage (for large files) ──────────────────

  async saveText(taskId: string, text: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(
      `${KEY_PREFIX}${taskId}:text`,
      text,
      'EX',
      TTL_SECONDS,
    );
  }

  async getText(taskId: string): Promise<string | null> {
    if (!this.redis) return null;
    return this.redis.get(`${KEY_PREFIX}${taskId}:text`);
  }

  // ─── SSE Stream ──────────────────────────────────────

  /**
   * Subscribe to progress events for a task.
   * Returns an async generator that yields TaskProgressEvent.
   * Automatically unsubscribes when the generator is returned/thrown.
   */
  async *streamProgress(
    taskId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<TaskProgressEvent> {
    if (!this.redis) return;

    const subRedis = this.redis.duplicate();
    await subRedis.connect();
    const channel = `${CHANNEL_PREFIX}${taskId}`;

    // Buffer for events received between yields
    const buffer: TaskProgressEvent[] = [];
    let resolve: (() => void) | null = null;

    const handler = (_ch: string, message: string) => {
      try {
        buffer.push(JSON.parse(message));
        resolve?.();
      } catch {
        // ignore parse errors
      }
    };

    await subRedis.subscribe(channel);
    subRedis.on('message', handler);

    // Yield initial state
    const current = await this.getTask(taskId);
    if (current) {
      yield {
        taskId,
        status: current.status,
        phase: current.phase,
        progress: current.progress,
        chunksTotal: current.chunksTotal,
        chunksCompleted: current.chunksCompleted,
        message: current.message,
        result: current.status === 'done' ? current.result : undefined,
        error: current.error,
      };
    }

    try {
      while (!signal?.aborted) {
        if (buffer.length > 0) {
          const event = buffer.shift()!;
          yield event;
          // Stop streaming if terminal state
          if (
            event.status === 'done' ||
            event.status === 'failed' ||
            event.status === 'cancelled'
          ) {
            break;
          }
        } else {
          // Wait for next event
          await new Promise<void>((r) => {
            resolve = r;
            // Heartbeat timeout — yield nothing, just keep alive
            setTimeout(r, 15_000);
          });
          resolve = null;
        }
      }
    } finally {
      await subRedis.unsubscribe(channel);
      subRedis.removeListener('message', handler);
      await subRedis.quit().catch(() => {});
    }
  }

  // ─── Helpers ─────────────────────────────────────────

  private async saveTask(task: PipelineTask): Promise<void> {
    if (!this.redis) return;
    await this.redis.set(
      `${KEY_PREFIX}${task.id}`,
      JSON.stringify(task),
      'EX',
      TTL_SECONDS,
    );
  }

  private async publishProgress(
    taskId: string,
    event: TaskProgressEvent,
  ): Promise<void> {
    if (!this.pubRedis) return;
    try {
      await this.pubRedis.publish(
        `${CHANNEL_PREFIX}${taskId}`,
        JSON.stringify(event),
      );
    } catch {
      // ignore publish errors
    }
  }
}
