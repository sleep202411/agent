/**
 * Conversation persistence for the studio copilot — server-owns-messages.
 *
 * Scope: per (user × conversation). The client uses one conversation per
 * project (conversationId = `canvas:<projectId>`), so a user's thread is
 * continuous across sessions and across the project's modes.
 *
 * Backing: Redis with NO TTL (durable). This class is the single seam — when
 * we add conversation browsing / semantic memory, swap this implementation for
 * Postgres (Prisma) without touching the controller or client. The method
 * surface (load / save / list) is the contract to preserve.
 */
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { UIMessage } from 'ai';
import { REDIS } from '../infra/redis/redis.module';

export interface CopilotConversation {
  conversationId: string;
  userId: string;
  projectId: string | null;
  mode: string | null;
  messages: UIMessage[];
  updatedAt: number;
}

@Injectable()
export class CopilotStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private convKey(userId: string, conversationId: string): string {
    return `copilot:${userId}:conv:${conversationId}`;
  }

  private indexKey(userId: string): string {
    return `copilot:${userId}:conversations`;
  }

  async load(
    userId: string,
    conversationId: string,
  ): Promise<CopilotConversation | null> {
    const raw = await this.redis.get(this.convKey(userId, conversationId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CopilotConversation;
    } catch {
      return null;
    }
  }

  async save(conv: CopilotConversation): Promise<void> {
    // Durable: no expiry — conversation records are kept until explicitly cleared.
    await this.redis.set(
      this.convKey(conv.userId, conv.conversationId),
      JSON.stringify(conv),
    );
    await this.redis.zadd(
      this.indexKey(conv.userId),
      conv.updatedAt,
      conv.conversationId,
    );
  }

  /** Most-recently-updated conversation ids for a user (for a future history UI). */
  async list(userId: string, limit = 50): Promise<string[]> {
    return this.redis.zrevrange(
      this.indexKey(userId),
      0,
      Math.max(0, limit - 1),
    );
  }
}
