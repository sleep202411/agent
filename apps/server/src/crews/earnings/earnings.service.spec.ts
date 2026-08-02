import { CrewEarningSourceType, CrewEarningStatus } from '@prisma/client';
import {
  CreateCrewEarningSchema,
  ListCrewEarningsQuerySchema,
} from './earnings.dto';
import { CrewEarningsService } from './earnings.service';

const CREW_ID = 'crew-1';
const MEMBER_ID = 'member-1';
const MEMBER_USER_ID = 'user-1';
const ACTOR_ID = 'owner-1';
const EARNING_ID = '01910d50-4c88-7c78-92d4-16892c06e001';
const TASK_ID = '01910d50-4c88-7c78-92d4-16892c06e002';

function earning(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date('2026-08-02T10:00:00.000Z');
  return {
    id: EARNING_ID,
    crewId: CREW_ID,
    crewMemberId: MEMBER_ID,
    userId: MEMBER_USER_ID,
    sourceType: CrewEarningSourceType.contract_compensation,
    taskId: null,
    agreementId: null,
    title: 'August contract compensation',
    description: null,
    pointsAmount: 125000n,
    status: CrewEarningStatus.pending,
    idempotencyKey: 'manual-key',
    createdByUserId: ACTOR_ID,
    approvedByUserId: null,
    rejectedByUserId: null,
    reversedByUserId: null,
    postedAt: null,
    rejectedAt: null,
    reversedAt: null,
    rejectionReason: null,
    reversalReason: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    task: null,
    agreement: null,
    crewMember: { id: MEMBER_ID, userId: MEMBER_USER_ID },
    ...overrides,
  };
}

function firstCallArgument(mock: { mock: { calls: unknown[][] } }): unknown {
  return mock.mock.calls[0]?.[0];
}

function build() {
  const pending = earning();
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewEarningEntry: {
      findUnique: jest.fn().mockResolvedValue(pending),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pending),
      create: jest.fn(),
      update: jest.fn(),
    },
    crewEarningEvent: { create: jest.fn().mockResolvedValue({}) },
    crewPayoutAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({}),
    },
    notificationOutbox: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    crewEarningEntry: {
      findUnique: jest.fn().mockResolvedValue(pending),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { pointsAmount: 0n },
      }),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue({
        id: MEMBER_ID,
        userId: MEMBER_USER_ID,
      }),
    },
    crewAgreement: { findFirst: jest.fn() },
    crewEarningEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const authorization = {
    require: jest.fn().mockResolvedValue({}),
    requireMembership: jest.fn().mockResolvedValue({}),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const service = new CrewEarningsService(
    prisma as never,
    authorization as never,
    notifications as never,
  );
  return {
    service,
    prisma,
    tx,
    authorization,
    notifications,
  };
}

describe('Crew earnings schemas', () => {
  it('bounds list pages and forbids manually-created task rewards', () => {
    expect(ListCrewEarningsQuerySchema.parse({})).toEqual({
      scope: 'mine',
      limit: 50,
    });
    expect(ListCrewEarningsQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      CreateCrewEarningSchema.safeParse({
        crewMemberId: MEMBER_ID,
        sourceType: 'task_reward',
        title: 'Forged task reward',
        pointsAmount: '100',
        idempotencyKey: 'client-key-1',
      }).success,
    ).toBe(false);
    expect(
      CreateCrewEarningSchema.safeParse({
        crewMemberId: MEMBER_ID,
        sourceType: 'contract_compensation',
        title: 'Unsafe numeric amount',
        pointsAmount: Number.MAX_SAFE_INTEGER + 1,
        idempotencyKey: 'client-key-2',
      }).success,
    ).toBe(false);
    expect(
      CreateCrewEarningSchema.safeParse({
        crewMemberId: MEMBER_ID,
        sourceType: 'contract_compensation',
        title: 'Out-of-range bigint amount',
        pointsAmount: '9223372036854775808',
        idempotencyKey: 'client-key-3',
      }).success,
    ).toBe(false);
  });
});

describe('CrewEarningsService', () => {
  it('exposes an ordered audit trail to the earning recipient', async () => {
    const t = build();
    t.prisma.crewEarningEvent.findMany.mockResolvedValue([
      {
        id: 'event-1',
        actorUserId: ACTOR_ID,
        action: 'earning.created',
        before: null,
        after: { status: 'pending' },
        createdAt: new Date('2026-08-02T10:00:00.000Z'),
      },
    ]);

    await expect(
      t.service.detail(EARNING_ID, MEMBER_USER_ID),
    ).resolves.toMatchObject({
      id: EARNING_ID,
      events: [
        {
          action: 'earning.created',
          actorUserId: ACTOR_ID,
          createdAt: '2026-08-02T10:00:00.000Z',
        },
      ],
    });
    expect(t.authorization.requireMembership).toHaveBeenCalledWith(
      CREW_ID,
      MEMBER_USER_ID,
    );
    expect(t.prisma.crewEarningEvent.findMany).toHaveBeenCalledWith({
      where: { earningId: EARNING_ID },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('requires ledger permission before exposing another member audit trail', async () => {
    const t = build();

    await t.service.detail(EARNING_ID, ACTOR_ID);

    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      ACTOR_ID,
      'finance.ledger.view',
    );
  });

  it('creates a pending manual point entry without touching the cash ledger', async () => {
    const t = build();
    const created = earning({
      idempotencyKey: `crew-earning-manual:${CREW_ID}:${ACTOR_ID}:client-key-1`,
    });
    t.tx.crewEarningEntry.findUnique.mockResolvedValue(null);
    t.tx.crewEarningEntry.create.mockResolvedValue(created);

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        crewMemberId: MEMBER_ID,
        sourceType: CrewEarningSourceType.contract_compensation,
        title: 'August contract compensation',
        pointsAmount: '125000',
        idempotencyKey: 'client-key-1',
      }),
    ).resolves.toMatchObject({
      status: CrewEarningStatus.pending,
      pointsAmount: '125000',
    });

    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      ACTOR_ID,
      'finance.earnings.create',
    );
    expect(firstCallArgument(t.tx.crewEarningEvent.create)).toMatchObject({
      data: { action: 'earning.created' },
    });
  });

  it('approves points atomically without coupling the point ledger to cash payouts', async () => {
    const t = build();
    const posted = earning({
      status: CrewEarningStatus.posted,
      approvedByUserId: ACTOR_ID,
      postedAt: new Date('2026-08-02T10:05:00.000Z'),
      version: 2,
    });
    t.tx.crewEarningEntry.update.mockResolvedValue(posted);

    await expect(
      t.service.approve(EARNING_ID, ACTOR_ID, { expectedVersion: 1 }),
    ).resolves.toMatchObject({ status: CrewEarningStatus.posted, version: 2 });

    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MEMBER_USER_ID,
        type: 'crew.earning.posted',
      }),
      t.tx,
    );
  });

  it('rejects a pending point entry without touching cash payouts', async () => {
    const t = build();
    const rejected = earning({
      status: CrewEarningStatus.rejected,
      rejectedByUserId: ACTOR_ID,
      rejectedAt: new Date('2026-08-02T10:05:00.000Z'),
      rejectionReason: 'Contract amount is incorrect',
      version: 2,
    });
    t.tx.crewEarningEntry.update.mockResolvedValue(rejected);

    await expect(
      t.service.reject(EARNING_ID, ACTOR_ID, {
        expectedVersion: 1,
        reason: 'Contract amount is incorrect',
      }),
    ).resolves.toMatchObject({
      status: CrewEarningStatus.rejected,
      rejectionReason: 'Contract amount is incorrect',
      version: 2,
    });

    expect(firstCallArgument(t.tx.crewEarningEvent.create)).toMatchObject({
      data: { action: 'earning.rejected' },
    });
  });

  it('rejects stale finance decisions before changing the point ledger', async () => {
    const t = build();
    const changed = earning({ version: 2 });
    t.prisma.crewEarningEntry.findUnique.mockResolvedValue(changed);
    t.tx.crewEarningEntry.findUniqueOrThrow.mockResolvedValue(changed);

    await expect(
      t.service.approve(EARNING_ID, ACTOR_ID, { expectedVersion: 1 }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_EARNING_VERSION_CONFLICT',
        expectedVersion: 1,
        currentVersion: 2,
      },
    });
  });

  it('reverses unallocated posted points with an audit reason', async () => {
    const t = build();
    const posted = earning({
      status: CrewEarningStatus.posted,
      approvedByUserId: ACTOR_ID,
      postedAt: new Date('2026-08-02T10:05:00.000Z'),
      version: 2,
    });
    const reversed = earning({
      ...posted,
      status: CrewEarningStatus.reversed,
      reversedByUserId: ACTOR_ID,
      reversedAt: new Date('2026-08-02T10:10:00.000Z'),
      reversalReason: 'Duplicate contract line',
      version: 3,
    });
    t.prisma.crewEarningEntry.findUnique.mockResolvedValue(posted);
    t.tx.crewEarningEntry.findUniqueOrThrow.mockResolvedValue(posted);
    t.tx.crewEarningEntry.update.mockResolvedValue(reversed);

    await expect(
      t.service.reverse(EARNING_ID, ACTOR_ID, {
        expectedVersion: 2,
        reason: 'Duplicate contract line',
      }),
    ).resolves.toMatchObject({
      status: CrewEarningStatus.reversed,
      reversalReason: 'Duplicate contract line',
    });
  });

  it('does not reverse points reserved by an active or completed payout', async () => {
    const t = build();
    const posted = earning({ status: CrewEarningStatus.posted, version: 2 });
    t.prisma.crewEarningEntry.findUnique.mockResolvedValue(posted);
    t.tx.crewEarningEntry.findUniqueOrThrow.mockResolvedValue(posted);
    t.tx.crewPayoutAllocation.findFirst.mockResolvedValue({
      id: 'allocation-1',
    });

    await expect(
      t.service.reverse(EARNING_ID, ACTOR_ID, {
        expectedVersion: 2,
        reason: 'Incorrect entry',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_EARNING_ALREADY_ALLOCATED' },
    });
    expect(t.tx.crewEarningEntry.update).not.toHaveBeenCalled();
  });

  it('posts task rewards directly without a pending finance decision', async () => {
    const t = build();
    const posted = earning({
      sourceType: CrewEarningSourceType.task_reward,
      taskId: TASK_ID,
      status: CrewEarningStatus.posted,
      approvedByUserId: ACTOR_ID,
      postedAt: new Date('2026-08-02T10:05:00.000Z'),
      task: { id: TASK_ID, number: 8, title: 'Approve storyboard' },
    });
    t.tx.crewEarningEntry.findUnique.mockResolvedValue(null);
    t.tx.crewEarningEntry.create.mockResolvedValue(posted);

    await expect(
      t.service.postTaskRewardTx(t.tx as never, {
        crewId: CREW_ID,
        taskId: TASK_ID,
        taskNumber: 8,
        taskTitle: 'Approve storyboard',
        crewMemberId: MEMBER_ID,
        userId: MEMBER_USER_ID,
        pointsAmount: 5000n,
        approvedByUserId: ACTOR_ID,
      }),
    ).resolves.toMatchObject({ status: CrewEarningStatus.posted });

    expect(firstCallArgument(t.tx.crewEarningEntry.create)).toMatchObject({
      data: {
        sourceType: CrewEarningSourceType.task_reward,
        status: CrewEarningStatus.posted,
        pointsAmount: 5000n,
      },
    });
  });
});
