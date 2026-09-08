import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CrewTasksService } from './tasks.service';
import { defaultCrewTaskView } from './task-defaults';
import {
  ListCrewTasksQuerySchema,
  ListCrewTaskOptionsQuerySchema,
} from './project-dto';

const url = process.env.TASK01_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Task deletion on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let service: CrewTasksService;
  let crewId: string;
  let stateId: string;
  const broadcast = jest.fn().mockResolvedValue(undefined);
  const authorization = {
    require: jest.fn().mockResolvedValue({ permissions: ['tasks.manage'] }),
  };
  let sequence = 0;
  beforeAll(() => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55439' ||
      parsed.pathname !== '/task01'
    ) {
      throw new Error(
        'Only the isolated localhost:55439/task01 test database is allowed.',
      );
    }
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      transactionOptions: { timeout: 15000 },
    });
    service = new CrewTasksService(
      db as never,
      authorization as never,
      {} as never,
      {} as never,
      { broadcastCrewTaskChange: broadcast } as never,
      {} as never,
    );
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    broadcast.mockClear();
    authorization.require
      .mockReset()
      .mockResolvedValue({ permissions: ['tasks.manage'] });
    crewId = `task01-${randomUUID()}`;
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Deletion fixture',
        description: '',
        logo: 'https://assets.invalid/logo.png',
        createdByUserId: 'owner',
      },
    });
    const state = await db.crewTaskWorkflowState.create({
      data: {
        crewId,
        name: 'Open',
        color: '#888888',
        semantic: 'open',
        systemKey: 'open',
        position: 0,
        createdByUserId: 'owner',
      },
    });
    stateId = state.id;
  });
  const createTask = (parentId: string | null = null) =>
    db.crewTask.create({
      data: {
        crewId,
        title: 'Fixture task',
        number: ++sequence,
        workflowStateId: stateId,
        createdByUserId: 'owner',
        parentId,
      },
    });

  it('reparents children, removes active blockers, preserves rows and hides deleted tasks after reread', async () => {
    const parent = await createTask();
    const task = await createTask(parent.id);
    const child = await createTask(task.id);
    const dependent = await createTask();
    await db.crewTaskDependency.create({
      data: {
        crewId,
        blockingTaskId: task.id,
        blockedTaskId: dependent.id,
        createdByUserId: 'owner',
      },
    });
    const submission = await db.crewTaskSubmission.create({
      data: {
        taskId: task.id,
        versionNumber: 1,
        submittedByUserId: 'owner',
        note: 'Keep evidence',
      },
    });
    const view = await db.crewTaskView.create({
      data: defaultCrewTaskView(crewId, 'owner'),
    });
    await service.delete(task.id, 'owner', task.version);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: child.id } }))
        .parentId,
    ).toBe(parent.id);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }))
        .deletedByUserId,
    ).toBe('owner');
    expect(
      await db.crewTaskSubmission.findUnique({ where: { id: submission.id } }),
    ).toEqual(submission);
    expect(
      await db.crewTaskDependency.count({ where: { blockingTaskId: task.id } }),
    ).toBe(1);
    expect((await service.get(dependent.id, 'owner')).blockedBy).toEqual([]);
    await expect(service.get(task.id, 'owner')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.delete(task.id, 'owner', task.version),
    ).rejects.toBeInstanceOf(NotFoundException);
    const list = await service.list(
      crewId,
      'owner',
      ListCrewTasksQuerySchema.parse({ viewId: view.id }),
    );
    expect(list.items.map((entry) => entry.id)).not.toContain(task.id);
    expect((await service.summary(crewId, 'owner')).total).toBe(3);
    expect(
      (
        await service.listOptions(
          crewId,
          'owner',
          ListCrewTaskOptionsQuerySchema.parse({}),
        )
      ).items.map((entry) => entry.id),
    ).not.toContain(task.id);
    expect(
      await db.crewTaskTimelineItem.count({
        where: { taskId: task.id, kind: 'task.deleted' },
      }),
    ).toBe(1);
  });
  it('rejects stale versions and permission denial without mutation or broadcast', async () => {
    const task = await createTask();
    await expect(
      service.delete(task.id, 'owner', task.version + 1),
    ).rejects.toBeInstanceOf(ConflictException);
    authorization.require.mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.delete(task.id, 'outsider', task.version),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }))
        .deletedAt,
    ).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('rejects task edits and reviews after deletion', async () => {
    const task = await createTask();
    await service.delete(task.id, 'owner', task.version);
    await expect(
      service.update(task.id, 'owner', {
        expectedVersion: task.version,
        title: 'Late edit',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.review(task.id, 'owner', { decision: 'approve', note: '' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await db.crewEarningEntry.count({ where: { taskId: task.id } }),
    ).toBe(0);
  });

  it('rejects corrupt parent cycles without deleting or reparenting', async () => {
    const task = await createTask();
    const child = await createTask(task.id);
    await db.crewTask.update({
      where: { id: task.id },
      data: { parentId: child.id },
    });
    await expect(
      service.delete(task.id, 'owner', task.version),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }))
        .deletedAt,
    ).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('rolls back reparenting when audit writing fails', async () => {
    const task = await createTask();
    const child = await createTask(task.id);
    // The actor column is varchar(64); force the real database to reject the audit insert.
    await expect(
      service.delete(task.id, 'x'.repeat(65), task.version),
    ).rejects.toThrow();
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: child.id } }))
        .parentId,
    ).toBe(task.id);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: task.id } }))
        .deletedAt,
    ).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('serializes competing deletions and emits one deletion audit', async () => {
    const task = await createTask();
    const results = await Promise.allSettled([
      service.delete(task.id, 'owner', task.version),
      service.delete(task.id, 'owner', task.version),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await db.crewTaskTimelineItem.count({
        where: { taskId: task.id, kind: 'task.deleted' },
      }),
    ).toBe(1);
  });

  it('preserves posted earnings and paid payout allocations byte-for-byte', async () => {
    const task = await createTask();
    const member = await db.crewMember.create({
      data: {
        id: randomUUID(),
        crewId,
        userId: 'owner',
        joinedVia: 'creation',
      },
    });
    const earning = await db.crewEarningEntry.create({
      data: {
        crewId,
        crewMemberId: member.id,
        userId: 'owner',
        taskId: task.id,
        sourceType: 'task_reward',
        title: 'Earned reward',
        pointsAmount: 100n,
        status: 'posted',
        postedAt: new Date(),
        approvedByUserId: 'owner',
        createdByUserId: 'owner',
        idempotencyKey: randomUUID(),
      },
    });
    const { payout, allocation } = await db.$transaction(async (tx) => {
      const payout = await tx.crewPayout.create({
        data: {
          crewId,
          crewMemberId: member.id,
          userId: 'owner',
          pointsAmount: 100n,
          netAmountMinor: 90n,
          withholdingAmountMinor: 10n,
          createdByUserId: 'owner',
          idempotencyKey: randomUUID(),
        },
      });
      const allocation = await tx.crewPayoutAllocation.create({
        data: {
          crewId,
          payoutId: payout.id,
          earningId: earning.id,
          pointsAmount: 100n,
        },
      });
      return { payout, allocation };
    });
    const paid = await db.crewPayout.update({
      where: { id: payout.id },
      data: {
        status: 'paid',
        version: { increment: 1 },
        paidAt: new Date(),
        paidByUserId: 'owner',
        paymentMethod: 'bank_transfer',
        paymentReference: 'synthetic',
      },
    });
    await service.delete(task.id, 'owner', task.version);
    expect(
      await db.crewEarningEntry.findUnique({ where: { id: earning.id } }),
    ).toEqual(earning);
    expect(
      await db.crewPayout.findUnique({ where: { id: payout.id } }),
    ).toEqual(paid);
    expect(
      await db.crewPayoutAllocation.findUnique({
        where: { id: allocation.id },
      }),
    ).toEqual(allocation);
  });

  it('waits for a concurrent hierarchy writer and reparents its newly committed child', async () => {
    const task = await createTask();
    let deletion: Promise<void> | undefined;
    let childId = '';
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      deletion = service.delete(task.id, 'owner', task.version);
      // Observe an actual database lock wait, rather than assuming a scheduling delay.
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await tx.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory') AS waiting`;
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      const child = await tx.crewTask.create({
        data: {
          crewId,
          title: 'Concurrent child',
          number: ++sequence,
          workflowStateId: stateId,
          createdByUserId: 'owner',
          parentId: task.id,
        },
      });
      childId = child.id;
    });
    await deletion;
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: childId } }))
        .parentId,
    ).toBeNull();
  });
});
