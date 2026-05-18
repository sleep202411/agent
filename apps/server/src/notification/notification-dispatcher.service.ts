/**
 * NotificationDispatcherService — drains NotificationOutbox to Redis
 * pub/sub. Mirrors AiGenerationOutboxService line-for-line.
 *
 * State machine per outbox row:
 *   created → (try publish) → dispatchedAt SET
 *   created → fail           → attempt++, lastError, nextAttemptAt = now + backoff
 *                            → (next tick) → ...
 *                            → after MAX_ATTEMPTS → deadAt SET (DLQ)
 *
 * Multi-pod safety: dispatcher claims rows with `lockedAt / lockedBy`.
 * Stale locks (older than LOCK_TTL) are reclaimable so a crashed pod
 * doesn't strand events.
 *
 * GC: dispatched rows older than GC_DISPATCHED_OLDER_THAN_MS are
 * deleted from the outbox table — the audit window is the
 * Notification table itself, not the outbox.
 */
import { hostname } from 'os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { notificationChannel, type NotificationDTO } from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { REDIS } from '../infra/redis/redis.module';

const DISPATCH_INTERVAL_MS = 2_000;
const DISPATCH_BATCH = 50;
/** Lock TTL — if a pod claimed a row but didn't finish in this window,
 *  another pod can reclaim it. Should exceed the longest expected
 *  Redis publish round-trip plus generous slack. */
const LOCK_TTL_MS = 30_000;
/** Per-row max retries before DLQ. */
const MAX_ATTEMPTS = 12;
/** Backoff for nextAttemptAt — capped at 5 min. */
const BACKOFFS_MS = [500, 2_000, 5_000, 15_000, 60_000, 180_000, 300_000];
/** Drop dispatched rows older than this from the table (audit window). */
const GC_DISPATCHED_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
/** Each pod tags its locks so we can debug who held what. */
const POD_ID = `${hostname()}-${process.pid}`;

@Injectable()
export class NotificationDispatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.drain(), DISPATCH_INTERVAL_MS);
    this.logger.log(
      `Notification outbox dispatcher running every ${DISPATCH_INTERVAL_MS}ms (pod=${POD_ID})`,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One drain cycle:
   *   1. Claim up to BATCH eligible rows (atomic via updateMany).
   *   2. Publish each one to Redis.
   *   3. Mark dispatched OR schedule retry / DLQ.
   *   4. GC old dispatched rows once per cycle.
   */
  private async drain(): Promise<void> {
    if (this.draining) return; // overlap guard
    this.draining = true;
    try {
      const claimed = await this.claim(DISPATCH_BATCH);
      for (const row of claimed) {
        await this.dispatchOne(row);
      }
      await this.gc();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`drain error: ${msg}`);
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number) {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TTL_MS);
    // Eligible row: not dispatched, not dead, due (nextAttemptAt NULL
    // or in the past), and either unlocked or lock expired.
    const eligible = await this.prisma.notificationOutbox.findMany({
      where: {
        dispatchedAt: null,
        deadAt: null,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        AND: [
          {
            OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiry } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: batch,
      select: { id: true },
    });
    if (eligible.length === 0) return [];

    const ids = eligible.map((e) => e.id);
    // Atomic claim — only rows still eligible at this exact moment get
    // locked. Other pods racing the same batch lose the claim.
    await this.prisma.notificationOutbox.updateMany({
      where: {
        id: { in: ids },
        dispatchedAt: null,
        deadAt: null,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiry } }],
      },
      data: { lockedAt: now, lockedBy: POD_ID },
    });
    return this.prisma.notificationOutbox.findMany({
      where: {
        id: { in: ids },
        lockedBy: POD_ID,
        dispatchedAt: null,
        deadAt: null,
      },
    });
  }

  private async dispatchOne(row: {
    id: string;
    userId: string;
    payload: Prisma.JsonValue;
    attempt: number;
  }) {
    try {
      const dto = row.payload as unknown as NotificationDTO;
      await this.redis.publish(
        notificationChannel(row.userId),
        JSON.stringify(dto),
      );
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: { dispatchedAt: new Date(), lockedAt: null, lockedBy: null },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextAttempt = row.attempt + 1;
      const isDead = nextAttempt >= MAX_ATTEMPTS;
      const backoff =
        BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];
      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          attempt: nextAttempt,
          lastError: msg.slice(0, 500),
          nextAttemptAt: isDead ? null : new Date(Date.now() + backoff),
          deadAt: isDead ? new Date() : null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      this.logger.warn(
        `dispatch failed outbox=${row.id} attempt=${nextAttempt}/${MAX_ATTEMPTS}` +
          (isDead ? ' → DLQ' : '') +
          `: ${msg}`,
      );
    }
  }

  private async gc(): Promise<void> {
    const cutoff = new Date(Date.now() - GC_DISPATCHED_OLDER_THAN_MS);
    const r = await this.prisma.notificationOutbox.deleteMany({
      where: { dispatchedAt: { lt: cutoff } },
    });
    if (r.count > 0)
      this.logger.log(`gc removed ${r.count} dispatched outbox rows`);
  }
}
