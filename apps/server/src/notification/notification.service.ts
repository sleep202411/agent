/**
 * NotificationService — write a notification + enqueue durable delivery.
 *
 * Two-phase write inside one transaction:
 *   1. Insert/find Notification row, keyed by (userId, idempotencyKey).
 *      If a row with this key already exists (retry, double-click, etc),
 *      we return it without inserting a duplicate — same outbox row is
 *      NOT enqueued either, since the original is in flight or done.
 *   2. Insert NotificationOutbox row queued for the dispatcher to publish a
 *      `notification.created` frame to the user's Ably channel. The outbox
 *      provides at-least-once delivery
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
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NotificationDTO, NotificationMeta } from '@repo/shared';
import type { NotificationFilter } from '@repo/shared/notifications';
import { newShortId } from '../common/id';
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
  constructor(private readonly prisma: PrismaService) {}

  /** Batch writes retain the same atomic notification/outbox deduplication as send. */
  async sendMany(args: SendArgs[], db: TxClient = this.prisma): Promise<void> {
    if (!args.length) return;
    if (db === this.prisma) {
      return this.prisma.$transaction((tx) => this.sendMany(args, tx));
    }
    // Consistent unique-key order avoids deadlocks between overlapping batches
    // whose callers supplied opposite recipient orders. Keep duplicate order stable.
    const ordered = [...args].sort((a, b) => {
      if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
      return a.idempotencyKey < b.idempotencyKey
        ? -1
        : a.idempotencyKey > b.idempotencyKey
          ? 1
          : 0;
    });
    for (let offset = 0; offset < ordered.length; offset += 250) {
      const inserted = await db.notification.createManyAndReturn({
        data: ordered.slice(offset, offset + 250).map((item) => ({
          id: newShortId(),
          userId: item.userId,
          type: item.type,
          title: item.title,
          body: item.body,
          meta: (item.meta ?? {}) as Prisma.InputJsonValue,
          idempotencyKey: item.idempotencyKey,
        })),
        skipDuplicates: true,
      });
      // RETURNING includes only rows inserted by this transaction, including
      // under concurrent replay. Existing rows must never enqueue again.
      if (inserted.length) {
        await db.notificationOutbox.createMany({
          data: inserted.map((row) => ({
            id: newShortId(),
            notificationId: row.id,
            userId: row.userId,
            payload: toDTO(row) as unknown as Prisma.InputJsonValue,
          })),
        });
      }
    }
  }

  async send(
    args: SendArgs,
    db: TxClient = this.prisma,
  ): Promise<NotificationDTO> {
    if (db === this.prisma) {
      return this.prisma.$transaction((tx) => this.send(args, tx));
    }
    // 1. Insert once by (userId, idempotencyKey). `createMany` gives a
    //    deterministic `count` so we know whether this request owns the
    //    outbox enqueue. A duplicate retry fetches and returns the row
    //    without publishing a second realtime event.
    const created = await db.notification.createMany({
      data: {
        id: newShortId(),
        userId: args.userId,
        type: args.type,
        title: args.title,
        body: args.body,
        meta: (args.meta ?? {}) as Prisma.InputJsonValue,
        idempotencyKey: args.idempotencyKey,
      },
      skipDuplicates: true,
    });
    const row = await db.notification.findUniqueOrThrow({
      where: {
        uniq_user_idempotency: {
          userId: args.userId,
          idempotencyKey: args.idempotencyKey,
        },
      },
    });
    const dto = toDTO(row);

    // 2. Enqueue outbox row only when the notification is brand-new.
    if (created.count > 0) {
      await db.notificationOutbox.create({
        data: {
          id: newShortId(),
          notificationId: row.id,
          userId: args.userId,
          payload: dto as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return dto;
  }

  async list(
    userId: string,
    opts: { limit: number; cursor?: string; filter?: NotificationFilter },
  ) {
    const sharing = ['workspace.', 'project.', 'story-project.'].map(
      (prefix) => ({
        type: { startsWith: prefix },
      }),
    );
    const where: Prisma.NotificationWhereInput = { userId };
    if (opts.filter === 'unread') where.readAt = null;
    if (opts.filter === 'crew') where.type = { startsWith: 'crew.' };
    if (opts.filter === 'sharing') where.OR = sharing;
    if (opts.filter === 'system')
      where.NOT = [{ type: { startsWith: 'crew.' } }, ...sharing];
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  async unreadCrews(userId: string) {
    return this.prisma.$queryRaw<
      Array<{ crewId: string; count: number }>
    >(Prisma.sql`
      SELECT meta->>'crewId' AS "crewId", COUNT(*)::int AS count
      FROM notifications
      WHERE user_id = ${userId} AND read_at IS NULL
        AND type LIKE 'crew.%'
        AND jsonb_typeof(meta->'crewId') = 'string'
        AND meta->>'crewId' <> ''
      GROUP BY meta->>'crewId'
    `);
  }

  async unreadCrewTasks(userId: string) {
    // Aggregate in the database; never infer unread state from a feed page.
    return this.prisma.$queryRaw<
      Array<{ taskId: string; count: number }>
    >(Prisma.sql`
      SELECT meta->>'taskId' AS "taskId", COUNT(*)::int AS count
      FROM notifications
      WHERE user_id = ${userId} AND read_at IS NULL
        AND type LIKE 'crew.task.%'
        AND jsonb_typeof(meta->'taskId') = 'string'
        AND meta->>'taskId' <> ''
      GROUP BY meta->>'taskId'
    `);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<NotificationDTO | null> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    return row ? toDTO(row) : null;
  }

  async markCrewRead(userId: string, crewId: string): Promise<number> {
    const readAt = new Date();
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        type: { startsWith: 'crew.' },
        meta: { path: ['crewId'], equals: crewId },
        createdAt: { lte: readAt },
      },
      data: { readAt },
    });
    return result.count;
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
