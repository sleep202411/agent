/**
 * Event outbox — durable Web PubSub fan-out.
 *
 * Why: a fire-and-forget `publishAssetEvent` call vanishes if the
 * Web PubSub service has a hiccup, leaving the browser permanently
 * out of sync. The outbox records every emit attempt in Postgres so
 * a background dispatcher can retry until publish actually lands.
 *
 * State machine per row:
 *   created → (try) → dispatched_at SET
 *   created → fail  → attempt++, lastError, nextAttemptAt = now + backoff
 *                  → (next drain) → ...
 *                  → after MAX_ATTEMPTS → deadAt SET (DLQ)
 *
 * Multi-pod safety: dispatcher claims rows with `lockedAt / lockedBy`.
 * Stale locks (older than LOCK_TTL) are reclaimable so a crashed pod
 * doesn't permanently strand events.
 *
 * Production hardening that's still TODO:
 *   - operator UI to inspect / requeue DLQ rows
 *   - run dispatcher in a dedicated worker pod (currently same process
 *     as API + generation worker; fine until traffic forces a split)
 */
import { hostname } from 'os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WebPubSubService } from '../infra/realtime/web-pubsub.service';
import { toAiJobEvent } from './job-event';
import type { AiJob } from './types';

const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCH_BATCH = 25;
/** Lock TTL — if a pod claimed a row but didn't finish in this window,
 *  another pod can reclaim it. Should exceed the longest expected
 *  Web PubSub publish round-trip plus generous slack. */
const LOCK_TTL_MS = 60_000;
/** Per-row max retries before sending to DLQ (deadAt). */
const MAX_ATTEMPTS = 12;
/** Backoff for nextAttemptAt — capped at 5 min. */
const BACKOFFS_MS = [1_000, 3_000, 8_000, 20_000, 60_000, 180_000, 300_000];
/** Drop dispatched rows older than this from the table (audit window). */
const GC_DISPATCHED_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
/** Each pod tags its locks so we can debug who held what. */
const POD_ID = `${hostname()}-${process.pid}`;

@Injectable()
export class AiGenerationOutboxService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AiGenerationOutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webPubSub: WebPubSubService,
  ) {}

  /**
   * Insert an outbox row for this job's current state and try to
   * publish in the same tick. A given (job, state) may produce
   * multiple rows over time — clients dedupe by `job.updatedAt` on
   * the receive side.
   */
  async record(job: AiJob): Promise<void> {
    const event = toAiJobEvent(job);
    const row = await this.prisma.aiEventOutbox.create({
      data: {
        jobId: job.id,
        userId: job.userId,
        eventType: 'job_update',
        payload: event as unknown as Prisma.InputJsonValue,
        attempt: 0,
      },
    });
    // Optimistic publish — don't await, don't fail the caller if
    // Web PubSub is down. Dispatcher cleans up.
    void this.tryDispatch(row.id, job.userId, event);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.drainOnce(), DISPATCH_INTERVAL_MS);
    this.logger.log(
      `Outbox dispatcher running every ${DISPATCH_INTERVAL_MS}ms (pod=${POD_ID})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async drainOnce(): Promise<void> {
    if (this.draining) return; // overlap guard within a single pod
    this.draining = true;
    try {
      const now = new Date();
      const lockCutoff = new Date(now.getTime() - LOCK_TTL_MS);

      // Claim a batch of pending rows under our lock. updateMany +
      // returning isn't a Prisma primitive, so we do it in two steps:
      // (1) update rows we'd like → set lockedAt/lockedBy
      // (2) fetch the rows we just locked
      // The race is benign: another pod may pick OTHER rows between
      // (1) and (2), but never the ones we marked.
      const claimRes = await this.prisma.aiEventOutbox.updateMany({
        where: {
          dispatchedAt: null,
          deadAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          AND: [
            {
              OR: [
                { lockedAt: null },
                { lockedAt: { lt: lockCutoff } }, // stale lock — reclaim
              ],
            },
          ],
        },
        data: { lockedAt: now, lockedBy: POD_ID },
      });

      if (claimRes.count === 0) {
        await this.gc();
        return;
      }

      const rows = await this.prisma.aiEventOutbox.findMany({
        where: { lockedBy: POD_ID, dispatchedAt: null, deadAt: null },
        orderBy: { createdAt: 'asc' },
        take: DISPATCH_BATCH,
      });

      for (const row of rows) {
        const payload = row.payload as unknown as Parameters<
          WebPubSubService['publishAssetEvent']
        >[1];
        try {
          await this.webPubSub.publishAssetEvent(row.userId, payload);
          await this.prisma.aiEventOutbox.update({
            where: { id: row.id },
            data: {
              dispatchedAt: new Date(),
              attempt: row.attempt + 1,
              lockedAt: null,
              lockedBy: null,
              lastError: null,
              nextAttemptAt: null,
            },
          });
        } catch (err) {
          const nextAttempt = row.attempt + 1;
          const reachedDLQ = nextAttempt >= MAX_ATTEMPTS;
          const backoff =
            BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];
          await this.prisma.aiEventOutbox.update({
            where: { id: row.id },
            data: {
              attempt: nextAttempt,
              lastError: errorText(err),
              nextAttemptAt: reachedDLQ ? null : new Date(Date.now() + backoff),
              deadAt: reachedDLQ ? new Date() : null,
              lockedAt: null,
              lockedBy: null,
            },
          });
          this.logger.warn(
            `outbox dispatch failed id=${row.id} attempt=${nextAttempt}${reachedDLQ ? ' [DLQ]' : ''}: ${errorText(err)}`,
          );
        }
      }

      await this.gc();
    } catch (err) {
      this.logger.warn(`outbox drain failed: ${errorText(err)}`);
    } finally {
      this.draining = false;
    }
  }

  /** Optimistic same-tick publish. Failure here lets dispatcher retry. */
  private async tryDispatch(
    rowId: string,
    userId: string,
    payload: ReturnType<typeof toAiJobEvent>,
  ): Promise<void> {
    try {
      await this.webPubSub.publishAssetEvent(userId, payload);
      await this.prisma.aiEventOutbox.update({
        where: { id: rowId },
        data: { dispatchedAt: new Date(), attempt: 1 },
      });
    } catch {
      // Dispatcher loop will pick it up via nextAttemptAt logic.
    }
  }

  /**
   * GC dispatched rows past the audit window. Done inside drain so it
   * doesn't need its own scheduler.
   */
  private async gc(): Promise<void> {
    try {
      await this.prisma.aiEventOutbox.deleteMany({
        where: {
          dispatchedAt: {
            lt: new Date(Date.now() - GC_DISPATCHED_OLDER_THAN_MS),
          },
        },
      });
    } catch (err) {
      this.logger.warn(`outbox gc failed: ${errorText(err)}`);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
