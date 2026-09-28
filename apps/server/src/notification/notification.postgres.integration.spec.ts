import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { assertOutboxTestDatabase } from '../conversations/outbox-test-database';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import type { PrismaService } from '../infra/db/db.module';

const connectionString =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.NOTIFICATION_POSTGRES_INTEGRATION === '1'
    ? process.env.NOTIFICATION_TEST_DATABASE_URL
    : undefined);
const suite = connectionString ? describe : describe.skip;

suite('notifications against local Postgres', () => {
  let db: PrismaClient;
  let service: NotificationService;
  let controller: NotificationController;
  const owner = `notification-test-${randomUUID()}`;
  const stranger = `notification-test-${randomUUID()}`;
  const actor = { userId: owner, userName: 'Test', nickName: 'Test' };

  beforeAll(() => {
    assertOutboxTestDatabase(connectionString!);
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 4,
        options: '-c timezone=UTC',
      }),
    });
    service = new NotificationService(db as PrismaService);
    controller = new NotificationController(service);
  });
  afterEach(async () => {
    await db?.notification.deleteMany({
      where: { userId: { in: [owner, stranger] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  async function seed() {
    // The only sharing item is older than the first 30 crew notifications.
    await db.notification.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        id: `${owner}-${String(i).padStart(2, '0')}`,
        userId: owner,
        type:
          i === 0
            ? 'story-project.member.added'
            : i === 1
              ? 'system.account.notice'
              : 'crew.task.assigned',
        title: `Notification ${i}`,
        body: 'Local regression fixture',
        idempotencyKey: String(i),
        createdAt: new Date('2026-09-01T00:00:00Z'),
      })),
    });
  }

  it('filters the entire inbox before pagination and orders timestamp ties without duplicates', async () => {
    await seed();
    const sharing = await controller.list(actor, '30', undefined, 'sharing');
    expect(sharing.items.map((n) => n.type)).toEqual([
      'story-project.member.added',
    ]);
    expect(sharing.nextCursor).toBeNull();
    expect(
      (await controller.list(actor, '30', undefined, 'system')).items,
    ).toHaveLength(1);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list(owner, {
        limit: 7,
        filter: 'crew',
        cursor,
      });
      ids.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(63);
    expect(new Set(ids).size).toBe(63);
    expect(ids).toEqual([...ids].sort().reverse());
  });

  it('mark-read is idempotent, scoped to the owner and preserves unread pagination', async () => {
    await seed();
    const first = await service.list(owner, { limit: 7, filter: 'unread' });
    const id = first.nextCursor!;
    expect(await service.markRead(stranger, id)).toBeNull();
    const read = await controller.markRead(actor, id);
    const again = await controller.markRead(actor, id);
    expect(again.readAt).toBe(read.readAt);
    expect(await service.unreadCount(owner)).toBe(64);
    const next = await service.list(owner, {
      limit: 7,
      filter: 'unread',
      cursor: id,
    });
    expect(next.items).toHaveLength(7);
    expect(next.items.some((n) => n.id === id)).toBe(false);
    expect(await service.markAllRead(stranger)).toBe(0);
    expect(await service.markAllRead(owner)).toBe(64);
    expect(await service.markAllRead(owner)).toBe(0);
    expect(
      (await service.list(owner, { limit: 30, filter: 'unread' })).items,
    ).toHaveLength(0);
  });

  it('concurrent duplicate sends create one notification and one durable delivery', async () => {
    const input = {
      userId: owner,
      type: 'system.account.notice',
      title: 'Test',
      body: 'Test',
      idempotencyKey: 'same-event',
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.send(input)),
    );
    expect(new Set(results.map((n) => n.id)).size).toBe(1);
    expect(await db.notification.count({ where: { userId: owner } })).toBe(1);
    expect(
      await db.notificationOutbox.count({ where: { userId: owner } }),
    ).toBe(1);
  });

  it('a failed outbox insert rolls back the notification', async () => {
    const failingDb = extendPrismaQueries(db, {
      query: {
        notificationOutbox: {
          create: () => {
            throw new Error('Outbox unavailable');
          },
        },
      },
    });
    const failingService = new NotificationService(
      failingDb as unknown as PrismaService,
    );
    await expect(
      failingService.send({
        userId: owner,
        type: 'system.account.notice',
        title: 'Test',
        body: 'Test',
        idempotencyKey: 'rollback',
      }),
    ).rejects.toThrow('Outbox unavailable');
    expect(await db.notification.count({ where: { userId: owner } })).toBe(0);
  });

  it('rejects unknown filters without querying an unfiltered inbox', async () => {
    await expect(
      controller.list(actor, '30', undefined, 'typo'),
    ).rejects.toThrow('Invalid notification filter');
  });
});
