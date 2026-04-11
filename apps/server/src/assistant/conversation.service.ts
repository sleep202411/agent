import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// ─── VIP tier configuration ────────────────────────────

export interface ConversationLimits {
  maxMessages: number;
  ttlSeconds: number;
  persist: boolean;
}

const TIER_LIMITS: Record<string, ConversationLimits> = {
  free: { maxMessages: 50, ttlSeconds: 3600, persist: true }, // 1 hour
  VIP1: { maxMessages: 100, ttlSeconds: 86400 * 15, persist: true }, // 15 days
  VIP2: { maxMessages: 200, ttlSeconds: 86400 * 15, persist: true }, // 15 days
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

/** What's actually stored in Redis */
interface StoredConversation {
  id: string;
  messages: StoredMessage[];
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
   * Load conversation from Redis.
   */
  private async getConversation(
    userId: string,
    projectId: string,
  ): Promise<StoredConversation | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.key(userId, projectId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Backwards compat: old format was a plain array
      if (Array.isArray(parsed)) {
        return { id: crypto.randomUUID().slice(0, 8), messages: parsed };
      }
      return parsed as StoredConversation;
    } catch (error) {
      this.logger.error(`[getConversation] Failed: ${error}`);
      return null;
    }
  }

  /**
   * Load conversation history for a user+project.
   */
  async getMessages(
    userId: string,
    projectId: string,
  ): Promise<{ conversationId: string; messages: StoredMessage[] }> {
    const conv = await this.getConversation(userId, projectId);
    if (!conv) return { conversationId: '', messages: [] };
    this.logger.log(
      `[getMessages] userId=${userId} project=${projectId}: ${conv.messages.length} messages, id=${conv.id}`,
    );
    return { conversationId: conv.id, messages: conv.messages };
  }

  /**
   * Get current message count (without loading full messages).
   */
  async getMessageCount(userId: string, projectId: string): Promise<number> {
    const { messages } = await this.getMessages(userId, projectId);
    return messages.length;
  }

  // ─── Write ─────────────────────────────────────────────

  /**
   * Save the full conversation.
   * TTL refreshes on every save — represents "time since last activity".
   * Active users never lose their history.
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

    // Preserve existing conversation id, or generate new one
    const existing = await this.getConversation(userId, projectId);
    const conv: StoredConversation = {
      id: existing?.id ?? crypto.randomUUID().slice(0, 8),
      messages,
    };

    try {
      const json = JSON.stringify(conv);
      if (limits.ttlSeconds > 0) {
        await this.redis.set(k, json, 'EX', limits.ttlSeconds);
      } else {
        await this.redis.set(k, JSON.stringify(messages));
      }

      this.logger.log(
        `[saveMessages] userId=${userId} project=${projectId}: saved ${messages.length} messages (tier=${tier ?? 'free'}, ttl=${limits.ttlSeconds}s)`,
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
    const { messages: existing } = await this.getMessages(userId, projectId);
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
