import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CrewTasksService } from './tasks.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type { PrismaService } from '../../infra/db/db.module';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const suite = databaseUrl ? describe : describe.skip;
suite('Cross-Crew task center against local PostgreSQL', () => {
  let db: PrismaClient;
  let service: CrewTasksService;
  const viewer = randomUUID();
  const crewIds: string[] = [];
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !(
        (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
        (url.port === '55439' && url.pathname === '/task01') ||
        (url.port === '55441' && url.pathname === '/audit_migrations_20261005')
      )
    )
      throw new Error('Explicitly allowed loopback test database required');
    const connectionString = databaseUrl;
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        max: 4,
        options: '-c timezone=UTC',
      }),
    });
    await db.$connect();
    const prisma = db as PrismaService;
    service = new CrewTasksService(
      prisma,
      new CrewAuthorizationService(prisma),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });
  afterAll(async () => {
    if (!db) return;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SET LOCAL session_replication_role = replica',
      );
      await tx.crewEarningEntry.deleteMany({
        where: { crewId: { in: crewIds } },
      });
    });
    await db.crewTaskAssignee.deleteMany({
      where: { crewId: { in: crewIds } },
    });
    await db.crew.deleteMany({ where: { id: { in: crewIds } } });
    await db.$disconnect();
  });

  it('honors live membership and permission overrides while paginating assigned tasks', async () => {
    const expected: string[] = [];
    let allowedMember = '';
    for (const access of ['allowed', 'denied', 'suspended'] as const) {
      const crewId = randomUUID();
      crewIds.push(crewId);
      await db.crew.create({
        data: {
          id: crewId,
          name: access,
          description: '',
          logo: 'https://assets.invalid/logo.png',
          createdByUserId: viewer,
        },
      });
      const memberId = randomUUID();
      await db.crewMember.create({
        data: {
          id: memberId,
          crewId,
          userId: viewer,
          joinedVia: 'invitation',
          status: access === 'suspended' ? 'suspended' : 'active',
          suspendedAt: access === 'suspended' ? new Date() : null,
        },
      });
      if (access === 'denied')
        await db.crewMemberPermissionOverride.create({
          data: {
            memberId,
            permissionKey: 'tasks.view',
            effect: 'deny',
            changedByUserId: viewer,
          },
        });
      if (access === 'allowed') allowedMember = memberId;
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          systemKey: 'open',
          position: 0,
          createdByUserId: viewer,
        },
      });
      for (let number = 1; number <= 3; number++) {
        const task = await db.crewTask.create({
          data: {
            crewId,
            number,
            title: 'Review fixture',
            workflowStateId: state.id,
            createdByUserId: viewer,
            deletedAt: number === 3 ? new Date() : null,
          },
        });
        await db.crewTaskAssignee.create({
          data: {
            crewId,
            taskId: task.id,
            crewMemberId: memberId,
            userId: viewer,
            currency: 'USD',
          },
        });
        if (access === 'allowed' && number !== 3) expected.push(task.id);
      }
    }
    const query = {
      scope: 'mine' as const,
      status: 'active' as const,
      query: 'review',
      limit: 1,
    };
    const first = await service.listCenter(viewer, query);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.listCenter(viewer, {
      ...query,
      cursor: first.nextCursor!,
    });
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.items, ...second.items].map((task) => task.id).sort(),
    ).toEqual(expected.sort());
    expect((await service.listCenter(randomUUID(), query)).items).toEqual([]);
    expect(
      (
        await service.listCenter(viewer, {
          ...query,
          query: 'allowed',
          limit: 30,
        })
      ).items
        .map((row) => row.id)
        .sort(),
    ).toEqual(expected.sort());
    expect(
      (
        await service.listCenter(viewer, { ...query, query: expected[0] })
      ).items.map((row) => row.id),
    ).toEqual([expected[0]]);
    const task = await db.crewTask.findUniqueOrThrow({
      where: { id: expected[0] },
    });
    const earning = await db.crewEarningEntry.create({
      data: {
        crewId: task.crewId,
        taskId: task.id,
        crewMemberId: allowedMember,
        userId: viewer,
        currency: 'USD',
        sourceType: 'task_reward',
        status: 'posted',
        postedAt: new Date(),
        approvedByUserId: viewer,
        title: 'Income reference search fixture',
        amountMinor: 100n,
        idempotencyKey: randomUUID(),
        createdByUserId: viewer,
      },
    });
    expect(
      (
        await service.listCenter(viewer, { ...query, query: earning.id })
      ).items.map((row) => row.id),
    ).toEqual([task.id]);
    const otherId = randomUUID();
    const other = await db.crewMember.create({
      data: {
        id: randomUUID(),
        crewId: task.crewId,
        userId: otherId,
        joinedVia: 'invitation',
        status: 'active',
      },
    });
    const privateEarning = await db.crewEarningEntry.create({
      data: {
        crewId: task.crewId,
        taskId: task.id,
        crewMemberId: other.id,
        userId: otherId,
        currency: 'USD',
        sourceType: 'task_reward',
        status: 'posted',
        postedAt: new Date(),
        approvedByUserId: viewer,
        title: 'Other income',
        amountMinor: 100n,
        idempotencyKey: randomUUID(),
        createdByUserId: viewer,
      },
    });
    expect(
      (await service.listCenter(viewer, { ...query, query: privateEarning.id }))
        .items,
    ).toEqual([]);
    await db.crewMember.update({
      where: { id: allowedMember },
      data: { status: 'removed', removedAt: new Date() },
    });
    expect((await service.listCenter(viewer, query)).items).toEqual([]);
  });
});
