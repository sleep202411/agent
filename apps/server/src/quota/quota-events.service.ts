/**
 * QuotaEventsService — Redis publisher for per-user quota changes.
 *
 * Every successful consume / refund calls publish() with the updated
 * dimension snapshot. QuotaEventsGateway has a psubscribe waiting
 * on `quota:events:*`; each open WS for that user receives the frame
 * within a couple of ms.
 *
 * Publish is best-effort fire-and-forget: a Redis hiccup means the
 * UI badge stays stale until the next manual /aurora/quota fetch or
 * the next successful event, but the quota itself is correct (the
 * Lua INCR already happened). Mirrors how NotificationService treats
 * pub/sub: "the DB row is authoritative; the WS is the latency
 * optimization."
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  quotaChannel,
  type QuotaEventFrame,
  type QuotaSnapshotWire,
} from '@repo/shared';
import { REDIS } from '../infra/redis/redis.module';

@Injectable()
export class QuotaEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(QuotaEventsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publishUpdate(
    userId: string,
    snapshot: QuotaSnapshotWire,
  ): Promise<void> {
    const frame: QuotaEventFrame = { event: 'quota_updated', data: snapshot };
    try {
      await this.redis.publish(quotaChannel(userId), JSON.stringify(frame));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `publishUpdate(${userId}/${snapshot.dimension}) failed: ${msg}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Shared client owned by RedisModule — nothing to clean up here.
  }
}
