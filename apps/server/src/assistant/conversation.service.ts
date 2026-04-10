import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// ─── VIP tier configuration ────────────────────────────

export interface ConversationLimits {
  maxMessages: number;
  ttlSeconds: number;
  persist: boolean;
}

const TIER_LIMITS: Record<string, ConversationLimits> = {
  free: { maxMessages: 50, ttlSeconds: 0, persist: false },
  VIP1: { maxMessages: 100, ttlSeconds: 86400, persist: true }, // 1 day
  VIP2: { maxMessages: 200, ttlSeconds: 86400 * 7, persist: true }, // 7 days
  VIP3: { maxMessages: 500, ttlSeconds: 86400 * 15, persist: true }, // 15 days
};

export function getLimitsForTier(tier?: string): ConversationLimits {
  if (!tier) return TIER_LIMITS.free;
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

// ─── Message types ─────────────────────────────────────

/**
 * Stored message format — mirrors the AI SDK UIMessage shape
 * so the frontend can load it directly into the store.
 * System messages are NOT stored — they are rebuilt from live data each request.
 */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: unknown[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

// ─── Service ───────────────────────────────────────────

@Injectable()
export class ConversationService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationService.name);
  private redis: Redis | null = null;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
      this.logger.log('ConversationService connected to Redis');
    } else {
      this.logger.warn('REDIS_URL not set — conversation persistence disabled');
    }
  }

  private key(userId: string, projectId: string): string {
    return `conversation:${userId}:${projectId}`;
  }

  // ─── Read ──────────────────────────────────────────────

  /**
   * Load conversation history for a user+project.
   */
  async getMessages(
    userId: string,
    projectId: string,
  ): Promise<StoredMessage[]> {
    if (!this.redis) return [];
    try {
      const raw = await this.redis.get(this.key(userId, projectId));
      if (!raw) return [];
      const messages = JSON.parse(raw) as StoredMessage[];
      this.logger.log(
        `[getMessages] userId=${userId} project=${projectId}: ${messages.length} messages`,
      );
      return messages;
    } catch (error) {
      this.logger.error(`[getMessages] Failed: ${error}`);
      return [];
    }
  }

  /**
   * Get current message count (without loading full messages).
   */
  async getMessageCount(userId: string, projectId: string): Promise<number> {
    // Could optimize with a separate counter key if needed
    const msgs = await this.getMessages(userId, projectId);
    return msgs.length;
  }

  // ─── Write ─────────────────────────────────────────────

  /**
   * Save the full message array.
   * TTL is only set when creating a new conversation (no existing key).
   * On subsequent saves, TTL is preserved — it never resets.
   * This means if a user downgrades, their existing TTL is honored.
   */
  async saveMessages(
    userId: string,
    projectId: string,
    messages: StoredMessage[],
    tier?: string,
  ): Promise<void> {
    const limits = getLimitsForTier(tier);
    if (!limits.persist || !this.redis) return;

    const k = this.key(userId, projectId);

    try {
      // Check if this is a new conversation (no existing key)
      const isNew = !(await this.redis.exists(k));

      await this.redis.set(k, JSON.stringify(messages));

      // Only set TTL on first creation — never reset on subsequent saves
      if (isNew && limits.ttlSeconds > 0) {
        await this.redis.expire(k, limits.ttlSeconds);
      }

      this.logger.log(
        `[saveMessages] userId=${userId} project=${projectId}: saved ${messages.length} messages (tier=${tier ?? 'free'}${isNew ? `, ttl=${limits.ttlSeconds}s` : ''})`,
      );
    } catch (error) {
      this.logger.error(`[saveMessages] Failed: ${error}`);
    }
  }

  /**
   * Append new messages to the conversation and save.
   * Returns the updated full message array.
   */
  async appendAndSave(
    userId: string,
    projectId: string,
    newMessages: StoredMessage[],
    tier?: string,
  ): Promise<StoredMessage[]> {
    const existing = await this.getMessages(userId, projectId);
    const combined = [...existing, ...newMessages];

    // Enforce max — trim oldest if over limit
    const limits = getLimitsForTier(tier);
    const trimmed =
      combined.length > limits.maxMessages
        ? combined.slice(-limits.maxMessages)
        : combined;

    await this.saveMessages(userId, projectId, trimmed, tier);
    return trimmed;
  }

  /**
   * Check if a new message can be sent (under the limit for current tier).
   */
  canSendMessage(
    currentCount: number,
    tier?: string,
  ): {
    allowed: boolean;
    current: number;
    max: number;
  } {
    const limits = getLimitsForTier(tier);
    return {
      allowed: currentCount < limits.maxMessages,
      current: currentCount,
      max: limits.maxMessages,
    };
  }

  // ─── Clear ─────────────────────────────────────────────

  /**
   * Clear conversation history (new conversation).
   */
  async clearMessages(userId: string, projectId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(userId, projectId));
      this.logger.log(`[clearMessages] userId=${userId} project=${projectId}`);
    } catch (error) {
      this.logger.error(`[clearMessages] Failed: ${error}`);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => {});
  }
}
