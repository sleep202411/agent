import { Logger } from '@nestjs/common';

const logger = new Logger('RateLimiter');

interface BucketConfig {
  maxConcurrent: number;
  maxPerMinute: number;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Token-bucket rate limiter with concurrency control.
 * Prevents hitting LLM API rate limits when processing many chunks.
 */
export class RateLimiter {
  private configs = new Map<string, BucketConfig>();
  private active = new Map<string, number>();
  private timestamps = new Map<string, number[]>();
  private queues = new Map<string, PendingRequest[]>();

  constructor(
    defaults: Record<string, BucketConfig> = {
      'qwen3-max': { maxConcurrent: 3, maxPerMinute: 50 },
      'qwen-flash': { maxConcurrent: 5, maxPerMinute: 200 },
      default: { maxConcurrent: 3, maxPerMinute: 50 },
    },
  ) {
    for (const [key, config] of Object.entries(defaults)) {
      this.configs.set(key, config);
    }
  }

  private getConfig(model: string): BucketConfig {
    return (
      this.configs.get(model) ??
      this.configs.get('default') ?? { maxConcurrent: 3, maxPerMinute: 50 }
    );
  }

  /**
   * Acquire a slot. Resolves when a slot is available.
   * Rejects after timeoutMs (default 60s).
   */
  async acquire(model = 'default', timeoutMs = 60_000): Promise<void> {
    const config = this.getConfig(model);
    const active = this.active.get(model) ?? 0;
    const now = Date.now();

    // Clean old timestamps
    const stamps = (this.timestamps.get(model) ?? []).filter(
      (t) => now - t < 60_000,
    );
    this.timestamps.set(model, stamps);

    // Check if we can proceed immediately
    if (active < config.maxConcurrent && stamps.length < config.maxPerMinute) {
      this.active.set(model, active + 1);
      stamps.push(now);
      return;
    }

    // Queue the request
    logger.log(
      `[${model}] Rate limited: ${active}/${config.maxConcurrent} concurrent, ${stamps.length}/${config.maxPerMinute} RPM. Queuing...`,
    );

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.queues.get(model) ?? [];
        const index = queue.findIndex((item) => item.resolve === resolve);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error(`Rate limiter timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const queue = this.queues.get(model) ?? [];
      queue.push({ resolve, reject, timer });
      this.queues.set(model, queue);

      // Schedule a retry
      const retryDelay =
        stamps.length >= config.maxPerMinute
          ? 60_000 - (now - stamps[0]) + 100
          : 500;
      setTimeout(() => this.tryProcessQueue(model), retryDelay);
    });
  }

  release(model = 'default'): void {
    const active = this.active.get(model) ?? 0;
    this.active.set(model, Math.max(0, active - 1));
    this.tryProcessQueue(model);
  }

  private tryProcessQueue(model: string): void {
    const config = this.getConfig(model);
    const queue = this.queues.get(model);
    if (!queue || queue.length === 0) return;

    const active = this.active.get(model) ?? 0;
    const now = Date.now();
    const stamps = (this.timestamps.get(model) ?? []).filter(
      (t) => now - t < 60_000,
    );
    this.timestamps.set(model, stamps);

    if (active < config.maxConcurrent && stamps.length < config.maxPerMinute) {
      const next = queue.shift();
      if (next) {
        clearTimeout(next.timer);
        this.active.set(model, active + 1);
        stamps.push(now);
        next.resolve();
      }
    }
  }
}
