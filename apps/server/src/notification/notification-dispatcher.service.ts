/**
 * NotificationDispatcherService — durably publishes NotificationOutbox rows
 * to the authenticated per-user Ably channel.
 *
 * State machine per outbox row:
 *   created → (try Ably publish) → dispatchedAt SET
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
import type { NotificationDTO } from '@repo/shared';
import {
  CONVERSATION_REALTIME,
  type ConversationRealtimePublisher,
} from '../conversations/conversation-realtime.service';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';

const DISPATCH_INTERVAL_MS = 2_000;
const DISPATCH_BATCH = 50;
/** Lock TTL — if a pod claimed a row but didn't finish in this window,
 *  another pod can reclaim it. Should exceed the longest expected
 *  Ably publish round-trip plus generous slack. */
const LOCK_TTL_MS = 30_000;
/** Per-row max retries before DLQ. */
const MAX_ATTEMPTS = 12;
/** Backoff for nextAttemptAt — capped at 5 min. */
const BACKOFFS_MS = [500, 2_000, 5_000, 15_000, 60_000, 180_000, 300_000];
/** Drop dispatched rows older than this from the table (audit window). */
const GC_DISPATCHED_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
/** Each pod tags its locks so we can debug who held what. */
const POD_ID = `${hostname()}-${process.pid}`;

type ClaimedNotificationOutbox = {
  id: string;
  notificationId: string;
  userId: string;
  payload: Prisma.JsonValue;
  attempt: number;
  lockedAt: Date | null;
};

@Injectable()
export class NotificationDispatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONVERSATION_REALTIME)
    private readonly realtime: ConversationRealtimePublisher,
  ) {}

  onApplicationBootstrap() {
    if (!backgroundTasksEnabled() || this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.drainOnce(), DISPATCH_INTERVAL_MS);
    void this.drainOnce();
    this.logger.log(
      `Notification outbox dispatcher running every ${DISPATCH_INTERVAL_MS}ms (pod=${POD_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  /**
   * One drain cycle:
   *   1. Claim one eligible row when ready to publish, up to BATCH per cycle.
   *   2. Publish each one to Ably with a deterministic message id.
   *   3. Mark dispatched OR schedule retry / DLQ.
   *   4. GC old dispatched rows once per cycle.
   */
  async drainOnce(): Promise<void> {
    if (!backgroundTasksEnabled() || this.stopped) return;
    if (this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    try {
      for (let sent = 0; sent < DISPATCH_BATCH; sent += 1) {
        if (this.stopped) break;
        const [row] = await this.claim(1);
        if (!row || this.stopped) break;
        await this.dispatchOne(row);
      }
      if (!this.stopped) await this.gc();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`drain error: ${msg}`);
    }
  }

  private async claim(batch: number): Promise<ClaimedNotificationOutbox[]> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      if (this.stopped) return [];
      const eligible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM notification_outbox
        WHERE dispatched_at IS NULL
          AND dead_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
          AND (locked_at IS NULL OR locked_at < ${lockExpiry})
        ORDER BY created_at ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      `);
      if (this.stopped || eligible.length === 0) return [];
      const claimedAt = new Date();

      const ids = eligible.map((row) => row.id);
      await tx.notificationOutbox.updateMany({
        where: { id: { in: ids } },
        data: { lockedAt: claimedAt, lockedBy: POD_ID },
      });
      if (this.stopped) return [];
      return tx.notificationOutbox.findMany({
        where: {
          id: { in: ids },
          lockedBy: POD_ID,
          lockedAt: claimedAt,
          dispatchedAt: null,
          deadAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async dispatchOne(row: ClaimedNotificationOutbox) {
    try {
      const dto = row.payload as unknown as NotificationDTO;
      await this.realtime.publishUserFrame(
        row.userId,
        { event: 'notification.created', data: dto },
        `notification:${row.notificationId}`,
      );
      await this.prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          lockedBy: POD_ID,
          lockedAt: row.lockedAt,
          dispatchedAt: null,
          deadAt: null,
        },
        data: {
          dispatchedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextAttempt = row.attempt + 1;
      const isDead = nextAttempt >= MAX_ATTEMPTS;
      const backoff =
        BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];
      await this.prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          lockedBy: POD_ID,
          lockedAt: row.lockedAt,
          dispatchedAt: null,
          deadAt: null,
        },
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
    if (this.stopped) return;
    const cutoff = new Date(Date.now() - GC_DISPATCHED_OLDER_THAN_MS);
    const r = await this.prisma.notificationOutbox.deleteMany({
      where: { dispatchedAt: { lt: cutoff } },
    });
    if (r.count > 0)
      this.logger.log(`gc removed ${r.count} dispatched outbox rows`);
  }
}
