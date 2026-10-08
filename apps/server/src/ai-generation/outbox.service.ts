import { backgroundTasksEnabled } from '../common/background-tasks';
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
 * Operator inspection/requeue is available under AI operations.
 * Remaining deployment option:
 *   - run dispatcher in a dedicated worker pod (currently same process
 *     as API + generation worker; fine until traffic forces a split)
 */
import { hostname } from 'os';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { AssetEvent } from '@repo/shared';
import { AiOutboxEventType, Prisma } from '@prisma/client';
import { newShortId } from '../common/id';
import { PrismaService } from '../infra/db/db.module';
import {
  REALTIME_PROVIDER,
  type RealtimeProvider,
} from '../infra/realtime/realtime-provider';
import { toAiJobEvent } from './job-event';
import type { AiJob } from './types';

const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCH_BATCH = 25;
/** Lock TTL — if a pod claimed a row but didn't finish in this window,
 *  another pod can reclaim it. Should exceed the longest expected
 *  Web PubSub publish round-trip plus generous slack. */
export const AI_OUTBOX_LOCK_TTL_MS = 60_000;
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
  private draining: Promise<void> | null = null;
  private readonly immediateDispatches = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REALTIME_PROVIDER)
    private readonly realtime: RealtimeProvider,
  ) {}

  /**
   * Insert an outbox row for this job's current state and try to
   * publish in the same tick. A given (job, state) may produce
   * multiple rows over time — clients dedupe by `job.updatedAt` on
   * the receive side.
   */
  async record(job: AiJob): Promise<void> {
    const event = toAiJobEvent(job);
    const row = await enqueueAssetEventOutbox(this.prisma, {
      jobId: job.id,
      userId: job.userId,
      eventType: AiOutboxEventType.job_update,
      payload: event,
    });
    // Optimistic publish — don't await, don't fail the caller if
    // Web PubSub is down. Dispatcher cleans up.
    void this.tryDispatch(row.id);
  }

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.drainOnce(), DISPATCH_INTERVAL_MS);
    this.logger.log(
      `Outbox dispatcher running every ${DISPATCH_INTERVAL_MS}ms (pod=${POD_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled([this.draining, ...this.immediateDispatches]);
  }

  private async drainOnce(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped || this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    try {
      const now = new Date();
      const candidates = await this.prisma.aiEventOutbox.findMany({
        where: {
          dispatchedAt: null,
          deadAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          AND: [
            {
              OR: [
                { lockedAt: null },
                {
                  lockedAt: {
                    lt: new Date(now.getTime() - AI_OUTBOX_LOCK_TTL_MS),
                  },
                },
              ],
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: DISPATCH_BATCH,
        select: { id: true },
      });
      for (const candidate of candidates) {
        if (this.stopped) break;
        await this.dispatchOne(candidate.id);
      }
      if (!this.stopped) await this.gc();
    } catch (err) {
      this.logger.warn(`outbox drain failed: ${errorText(err)}`);
    }
  }

  /** Immediate publication uses the same ready-row claim as the retry worker. */
  private async tryDispatch(rowId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    const dispatch = this.dispatchOne(rowId);
    this.immediateDispatches.add(dispatch);
    try {
      await dispatch;
    } catch {
      // A durable row remains recoverable after a database interruption.
    } finally {
      this.immediateDispatches.delete(dispatch);
    }
  }

  private async dispatchOne(rowId: string): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    if (this.stopped) return;
    // Claim only this item when ready to publish. SKIP LOCKED avoids aging a
    // newly minted lease while waiting for another writer; database time is
    // truncated to JS Date precision so subsequent ownership checks are exact.
    const claims = await this.prisma.$queryRaw<
      Array<{ id: string; lockedAt: Date }>
    >`
      WITH candidate AS (
        SELECT id FROM ai_event_outbox
        WHERE id = ${rowId} AND dispatched_at IS NULL AND dead_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp())
          AND (locked_at IS NULL OR locked_at < clock_timestamp() - (${AI_OUTBOX_LOCK_TTL_MS} * INTERVAL '1 millisecond'))
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ai_event_outbox AS event
      SET locked_at = date_trunc('milliseconds', clock_timestamp()), locked_by = ${POD_ID}
      FROM candidate WHERE event.id = candidate.id
      RETURNING event.id, event.locked_at AS "lockedAt"
    `;
    const claim = claims[0];
    if (!claim || this.stopped) return;
    const ownership = {
      id: claim.id,
      lockedBy: POD_ID,
      lockedAt: claim.lockedAt,
      dispatchedAt: null,
      deadAt: null,
    };
    const row = await this.prisma.aiEventOutbox.findFirst({ where: ownership });
    if (!row || this.stopped) return;
    try {
      await this.realtime.publishAssetEvent(row.userId, toPublishedEvent(row));
      // A publication already underway may acknowledge after shutdown, but a
      // displaced worker must never clear the replacement lease or outcome.
      await this.prisma.aiEventOutbox.updateMany({
        where: ownership,
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
      const recorded = await this.prisma.aiEventOutbox.updateMany({
        where: ownership,
        data: {
          attempt: nextAttempt,
          lastError: errorText(err),
          nextAttemptAt: reachedDLQ ? null : new Date(Date.now() + backoff),
          deadAt: reachedDLQ ? new Date() : null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (recorded.count > 0)
        this.logger.warn(
          `outbox dispatch failed id=${row.id} attempt=${nextAttempt}${reachedDLQ ? ' [DLQ]' : ''}: ${errorText(err)}`,
        );
    }
  }

  /**
   * GC dispatched rows past the audit window. Done inside drain so it
   * doesn't need its own scheduler.
   */
  private async gc(): Promise<void> {
    if (this.stopped) return;
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

export async function enqueueAssetEventOutbox(
  tx: PrismaService | Prisma.TransactionClient,
  input: {
    userId: string;
    eventType: AiOutboxEventType;
    payload: AssetEvent;
    jobId?: string | null;
  },
) {
  return tx.aiEventOutbox.create({
    data: {
      id: newShortId(),
      jobId: input.jobId ?? null,
      userId: input.userId,
      eventType: input.eventType,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      attempt: 0,
    },
  });
}

/**
 * Generalized realtime event enqueue (P3, docs/studio-realtime-architecture.md
 * §3). Allocates a per-channel monotonic `seq` (a single atomic PG upsert —
 * gap-free under concurrent writers) plus a unique `eventId`, then writes the
 * outbox row in the SAME transaction as the caller's mutation so the event and
 * the state change commit atomically (no dual-write race). The dispatcher
 * publishes it with the `{channel, seq, eventId}` envelope; clients use `seq`
 * to detect gaps + `/replay`, and `eventId` to dedup.
 */
export async function enqueueRealtimeEvent(
  tx: PrismaService | Prisma.TransactionClient,
  input: {
    channel: string;
    eventType: AiOutboxEventType;
    payload: Prisma.InputJsonValue;
    userId: string;
    jobId?: string | null;
  },
): Promise<{ outboxId: string; eventId: string; seq: bigint }> {
  // `next_seq` starts at 1; the first insert sets it to 2 and this event takes
  // seq 1. Subsequent events increment atomically. ${channel} is parameterized.
  const rows = await tx.$queryRaw<Array<{ next_seq: bigint }>>`
    INSERT INTO "realtime_sequence_cursor" ("channel", "next_seq")
    VALUES (${input.channel}, 2)
    ON CONFLICT ("channel")
    DO UPDATE SET "next_seq" = "realtime_sequence_cursor"."next_seq" + 1
    RETURNING "next_seq"
  `;
  const seq = rows[0].next_seq - 1n;
  const eventId = newShortId();
  const outboxId = newShortId();
  await tx.aiEventOutbox.create({
    data: {
      id: outboxId,
      channel: input.channel,
      seq,
      eventId,
      jobId: input.jobId ?? null,
      userId: input.userId,
      eventType: input.eventType,
      payload: input.payload,
      attempt: 0,
    },
  });
  return { outboxId, eventId, seq };
}

/**
 * Stamp the realtime envelope (channel/seq/eventId) onto the stored payload at
 * publish time. Legacy rows (no channel — e.g. the existing ai_job path) pass
 * through unchanged, so their delivery is byte-for-byte as before.
 */
function toPublishedEvent(row: {
  payload: Prisma.JsonValue;
  channel: string | null;
  seq: bigint | null;
  eventId: string | null;
}): AssetEvent {
  const payload = row.payload as unknown as AssetEvent;
  if (row.channel == null) return payload;
  return {
    ...payload,
    channel: row.channel,
    seq: row.seq != null ? Number(row.seq) : undefined,
    eventId: row.eventId ?? undefined,
  } as AssetEvent;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
