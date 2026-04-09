import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const KEY_PREFIX = 'script-agent:';
const TTL_SECONDS = 24 * 3600; // 24 hours

/**
 * Lightweight Redis-backed state store for the script agent.
 *
 * Each "session" stores the intermediate results of the script breakdown flow:
 * analyze results, episode mapping, created IDs, etc.
 *
 * Unlike the old pipeline engine, this is just a key-value store.
 * The AI orchestrates the flow via independent tool calls.
 */
@Injectable()
export class ScriptAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(ScriptAgentService.name);
  private readonly redis: Redis | null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) =>
          times > 10 ? null : Math.min(times * 500, 5000),
        lazyConnect: true,
      });
      this.redis.on('connect', () => this.logger.log('Redis connected'));
      this.redis.on('error', (err) =>
        this.logger.error(`Redis error: ${err.message}`),
      );
      this.redis
        .connect()
        .catch((err) =>
          this.logger.error(`Redis connect failed: ${err.message}`),
        );
    } else {
      this.logger.warn('REDIS_URL not set — using in-memory fallback');
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) this.redis.disconnect();
  }

  // ── In-memory fallback ──
  private readonly memStore = new Map<string, string>();

  private async set(key: string, value: string): Promise<void> {
    if (this.redis) {
      await this.redis.set(KEY_PREFIX + key, value, 'EX', TTL_SECONDS);
    } else {
      this.memStore.set(key, value);
    }
  }

  private async get(key: string): Promise<string | null> {
    if (this.redis) {
      return this.redis.get(KEY_PREFIX + key);
    }
    return this.memStore.get(key) ?? null;
  }

  // ── Public API ──

  /**
   * Save a session's state (JSON-serializable).
   * Each tool call reads previous state and writes updated state.
   */
  async saveState(
    sessionId: string,
    state: Record<string, unknown>,
  ): Promise<void> {
    await this.set(sessionId, JSON.stringify(state));
  }

  async getState(sessionId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.get(sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /**
   * Save large text separately (not in state JSON) to keep state compact.
   */
  async saveText(sessionId: string, text: string): Promise<void> {
    await this.set(`${sessionId}:text`, text);
    this.logger.log(`Saved text for ${sessionId}: ${text.length} chars`);
  }

  async getText(sessionId: string): Promise<string | null> {
    return this.get(`${sessionId}:text`);
  }
}
