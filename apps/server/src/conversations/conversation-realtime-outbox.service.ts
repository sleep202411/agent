/**
 * Durable delivery worker for authoritative conversation messages.
 *
 * Message creation transactionally inserts one outbox row. The request path
 * attempts the same idempotent Ably fan-out immediately for low latency; any
 * row it cannot acknowledge remains here. This worker provides:
 *
 * - crash/network recovery with bounded exponential backoff;
 * - multi-pod claiming via PostgreSQL `FOR UPDATE SKIP LOCKED`;
 * - lock leases so a crashed worker cannot strand an event;
 * - a terminal DLQ tombstone after repeated failure;
 * - GC of successfully-dispatched transport records.
 *
 * Postgres messages remain authoritative and REST cursor recovery remains the
 * final client repair path. Ably idempotency keys make partial fan-out replay
 * safe when a worker dies between channel publishes.
 */
import { hostname } from 'node:os';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, type Message } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { ConversationsService } from './conversations.service';

const DISPATCH_INTERVAL_MS = 1_000;
const DISPATCH_BATCH = 50;
const LOCK_TTL_MS = 30_000;
const MAX_ATTEMPTS = 12;
const BACKOFFS_MS = [500, 2_000, 5_000, 15_000, 60_000, 180_000, 300_000];
const GC_DISPATCHED_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
const WORKER_ID = `${hostname()}-${process.pid}`;

type ClaimedRealtimeOutbox = {
  id: string;
  messageId: string;
  attempt: number;
  lockedAt: Date | null;
  message: Message;
};

@Injectable()
export class ConversationRealtimeOutboxService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ConversationRealtimeOutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!backgroundTasksEnabled() || this.stopped || this.timer) return;
    this.timer = setInterval(() => void this.drainOnce(), DISPATCH_INTERVAL_MS);
    void this.drainOnce();
    this.logger.log(
      `Conversation Ably outbox dispatcher running every ${DISPATCH_INTERVAL_MS}ms (worker=${WORKER_ID})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.draining;
  }

  /** Public for deterministic health checks and focused tests. */
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
    } catch (error) {
      this.logger.error(
        `conversation realtime outbox drain failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private async claim(batch: number): Promise<ClaimedRealtimeOutbox[]> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TTL_MS);

    return this.prisma.$transaction(async (tx) => {
      if (this.stopped) return [];
      const eligible = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM conversation_realtime_outbox
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
      await tx.conversationRealtimeOutbox.updateMany({
        where: { id: { in: ids } },
        data: { lockedAt: claimedAt, lockedBy: WORKER_ID },
      });
      if (this.stopped) return [];
      return tx.conversationRealtimeOutbox.findMany({
        where: {
          id: { in: ids },
          lockedBy: WORKER_ID,
          lockedAt: claimedAt,
          dispatchedAt: null,
          deadAt: null,
        },
        include: { message: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async dispatchOne(row: ClaimedRealtimeOutbox): Promise<void> {
    try {
      await this.conversations.deliverMessageRealtime(row.message);
      const acknowledged =
        await this.prisma.conversationRealtimeOutbox.updateMany({
          where: {
            id: row.id,
            lockedBy: WORKER_ID,
            lockedAt: row.lockedAt,
            dispatchedAt: null,
            deadAt: null,
          },
          data: {
            dispatchedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            nextAttemptAt: null,
          },
        });
      if (acknowledged.count === 0) {
        this.logger.warn(
          `conversation realtime outbox lease lost before acknowledgement outbox=${row.id}`,
        );
      }
    } catch (error) {
      const nextAttempt = row.attempt + 1;
      const dead = nextAttempt >= MAX_ATTEMPTS;
      const backoff =
        BACKOFFS_MS[Math.min(row.attempt, BACKOFFS_MS.length - 1)];
      const message = this.errorMessage(error);
      const updated = await this.prisma.conversationRealtimeOutbox.updateMany({
        where: {
          id: row.id,
          lockedBy: WORKER_ID,
          lockedAt: row.lockedAt,
          dispatchedAt: null,
          deadAt: null,
        },
        data: {
          attempt: nextAttempt,
          lastError: message.slice(0, 2_000),
          nextAttemptAt: dead ? null : new Date(Date.now() + backoff),
          deadAt: dead ? new Date() : null,
          lockedAt: null,
          lockedBy: null,
        },
      });
      if (updated.count === 0) {
        this.logger.warn(
          `conversation realtime outbox lease lost after failure outbox=${row.id}`,
        );
        return;
      }
      this.logger.warn(
        `conversation realtime dispatch failed outbox=${row.id} message=${row.messageId} attempt=${nextAttempt}/${MAX_ATTEMPTS}${
          dead ? ' → DLQ' : ''
        }: ${message}`,
      );
    }
  }

  private async gc(): Promise<void> {
    if (this.stopped) return;
    const cutoff = new Date(Date.now() - GC_DISPATCHED_OLDER_THAN_MS);
    const result = await this.prisma.conversationRealtimeOutbox.deleteMany({
      where: { dispatchedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(
        `conversation realtime outbox GC removed ${result.count} dispatched rows`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
