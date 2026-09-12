import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { NotificationService } from './notification.service';

const suite =
  process.env.NOTIFICATION_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;

suite('Unread Crew markers against local PostgreSQL', () => {
  let db: PrismaClient;
  let service: NotificationService;
  const owner = `unread-test-${randomUUID()}`;
  const stranger = `unread-test-${randomUUID()}`;
  beforeAll(async () => {
    const connectionString = process.env.NOTIFICATION_TEST_DATABASE_URL;
    if (
      !connectionString ||
      !['127.0.0.1', 'localhost'].includes(new URL(connectionString).hostname)
    ) {
      throw new Error(
        'NOTIFICATION_TEST_DATABASE_URL must explicitly point to local PostgreSQL',
      );
    }
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 4,
        options: '-c timezone=UTC',
      }),
    });
    await db.$connect();
    service = new NotificationService(db as PrismaService);
  });
  afterEach(async () => {
    await db?.notification.deleteMany({
      where: { userId: { in: [owner, stranger] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  function row(
    meta: Prisma.InputJsonObject,
    userId = owner,
    type = 'crew.task.updated',
    readAt: Date | null = null,
  ) {
    return {
      id: randomUUID(),
      userId,
      type,
      title: 'Local fixture',
      body: '',
      meta,
      readAt,
      idempotencyKey: randomUUID(),
    };
  }

  it('aggregates beyond feed pages and follows user-scoped read actions', async () => {
    const rows = Array.from({ length: 125 }, () =>
      row({ taskId: 'task-a', crewId: 'crew-a' }),
    );
    await db.notification.createMany({
      data: [
        ...rows,
        row({ crewId: 'crew-a' }, owner, 'crew.member.added'),
        row({ taskId: 'task-b', crewId: 'crew-b' }),
        row({ taskId: 'task-a', crewId: 'crew-a' }, stranger),
        row({ taskId: 'task-a', crewId: 'crew-a' }, owner, 'system.notice'),
        row(
          { taskId: 'task-a', crewId: 'crew-a' },
          owner,
          'crew.task.updated',
          new Date(),
        ),
      ],
    });
    expect(await service.unreadCrewTasks(owner)).toEqual(
      expect.arrayContaining([
        { taskId: 'task-a', count: 125 },
        { taskId: 'task-b', count: 1 },
      ]),
    );
    expect(await service.unreadCrews(owner)).toEqual(
      expect.arrayContaining([
        { crewId: 'crew-a', count: 126 },
        { crewId: 'crew-b', count: 1 },
      ]),
    );
    expect(await service.markRead(stranger, rows[0].id)).toBeNull();
    await service.markRead(owner, rows[0].id);
    expect(await service.unreadCrewTasks(owner)).toContainEqual({
      taskId: 'task-a',
      count: 124,
    });
    await service.markAllRead(owner);
    expect(await service.unreadCrewTasks(owner)).toEqual([]);
    expect(await service.unreadCrews(owner)).toEqual([]);
    expect(await service.unreadCrews(stranger)).toEqual([
      { crewId: 'crew-a', count: 1 },
    ]);
  });

  it('ignores missing, empty and non-string identifiers', async () => {
    await db.notification.createMany({
      data: [
        {},
        { taskId: '', crewId: '' },
        { taskId: 12, crewId: 12 },
        { taskId: null, crewId: null },
        { taskId: ['a'], crewId: { id: 'a' } },
      ].map((meta) => row(meta)),
    });
    expect(await service.unreadCrewTasks(owner)).toEqual([]);
    expect(await service.unreadCrews(owner)).toEqual([]);
  });
});
