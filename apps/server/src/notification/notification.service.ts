/**
 * NotificationService — write a notification + enqueue durable delivery.
 *
 * Two-phase write inside one transaction:
 *   1. Insert/find Notification row, keyed by (userId, idempotencyKey).
 *      If a row with this key already exists (retry, double-click, etc),
 *      we return it without inserting a duplicate — same outbox row is
 *      NOT enqueued either, since the original is in flight or done.
 *   2. Insert NotificationOutbox row queued for the dispatcher to
 *      publish to Redis pub/sub. Outbox provides at-least-once delivery
 *      with retries + DLQ; the DB row is the source of truth.
 *
 * Idempotency keys are deterministic strings the caller derives from
 * the triggering business event, e.g.:
 *   "crew.application.approved:<applicationId>"
 *   "crew.member.added:<crewId>:<userId>"
 *
 * Same event fired twice → at most one notification row + one outbox
 * row + at most one user-facing toast.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NotificationDTO, NotificationMeta } from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';

type TxClient = Prisma.TransactionClient | PrismaClient;

interface SendArgs {
  userId: string;
  type: string;
  title: string;
  body: string;
  meta?: NotificationMeta;
  /** Deterministic dedup key. Required — see file header. */
  idempotencyKey: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(
    args: SendArgs,
    db: TxClient = this.prisma,
  ): Promise<NotificationDTO> {
    // 1. Idempotent upsert by (userId, idempotencyKey).
    //    `update: {}` is a no-op so the existing row's createdAt /
    //    readAt are preserved on retry.
    const row = await db.notification.upsert({
      where: {
        uniq_user_idempotency: {
          userId: args.userId,
          idempotencyKey: args.idempotencyKey,
        },
      },
      create: {
        userId: args.userId,
        type: args.type,
        title: args.title,
        body: args.body,
        meta: (args.meta ?? {}) as Prisma.InputJsonValue,
        idempotencyKey: args.idempotencyKey,
      },
      update: {},
    });
    const dto = toDTO(row);

    // 2. Enqueue outbox row only when the notification is brand-new.
    //    On a retry the upsert returns the original row (readAt may be
    //    set already, etc.). We don't create a second outbox row —
    //    avoids double-push for the same dedup boundary.
    const isFreshInsert = sameInstant(row.createdAt, new Date(), 5_000);
    if (isFreshInsert) {
      await db.notificationOutbox.create({
        data: {
          notificationId: row.id,
          userId: args.userId,
          payload: dto as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return dto;
  }

  async list(userId: string, opts: { limit: number; cursor?: string }) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > opts.limit;
    const items = (hasMore ? rows.slice(0, opts.limit) : rows).map(toDTO);
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<NotificationDTO | null> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) return null;
    const row = await this.prisma.notification.findUnique({ where: { id } });
    return row ? toDTO(row) : null;
  }

  async markAllRead(userId: string): Promise<number> {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return r.count;
  }
}

function toDTO(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  meta: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    meta: (row.meta as NotificationMeta) ?? {},
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Two Dates within `windowMs` of each other? Cheap heuristic for
 *  "was this row just inserted in this request" without an explicit
 *  boolean from the upsert. Within a tx the freshly-inserted row's
 *  createdAt is `now()`; on a retry that returns the original, it
 *  will be at least seconds older. */
function sameInstant(a: Date, b: Date, windowMs: number): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= windowMs;
}
