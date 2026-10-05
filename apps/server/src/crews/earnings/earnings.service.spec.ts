import { CrewEarningSourceType, CrewEarningStatus } from '@prisma/client';
import {
  CreateCrewEarningSchema,
  ListCrewEarningsQuerySchema,
  ListMyCrewEarningsQuerySchema,
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
    currency: 'USD',
    id: EARNING_ID,
    crewId: CREW_ID,
    crewMemberId: MEMBER_ID,
    userId: MEMBER_USER_ID,
    sourceType: CrewEarningSourceType.contract_compensation,
    taskId: null,
    agreementId: null,
    title: 'August contract compensation',
    description: null,
    amountMinor: 125000n,
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
    $queryRaw: jest.fn().mockResolvedValue([]),
    crewEarningEntry: {
      findUnique: jest.fn().mockResolvedValue(pending),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amountMinor: 0n },
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
    expect(ListCrewEarningsQuerySchema.parse({ currency: 'USD' })).toEqual({
      currency: 'USD',
      scope: 'mine',
      limit: 50,
    });
    expect(ListCrewEarningsQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      CreateCrewEarningSchema.safeParse({
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        sourceType: 'task_reward',
        title: 'Forged task reward',
        amountMinor: '100',
        idempotencyKey: 'client-key-1',
      }).success,
    ).toBe(false);
    expect(
      CreateCrewEarningSchema.safeParse({
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        sourceType: 'contract_compensation',
        title: 'Unsafe numeric amount',
        amountMinor: Number.MAX_SAFE_INTEGER + 1,
        idempotencyKey: 'client-key-2',
      }).success,
    ).toBe(false);
    expect(
      CreateCrewEarningSchema.safeParse({
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        sourceType: 'contract_compensation',
        title: 'Out-of-range bigint amount',
        amountMinor: '9223372036854775808',
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

  it('creates a pending manual earning without recording a payout', async () => {
    const t = build();
    const created = earning({
      idempotencyKey: `crew-earning-manual:${CREW_ID}:${ACTOR_ID}:client-key-1`,
    });
    t.tx.crewEarningEntry.findUnique.mockResolvedValue(null);
    t.tx.crewEarningEntry.create.mockResolvedValue(created);

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        sourceType: CrewEarningSourceType.contract_compensation,
        title: 'August contract compensation',
        amountMinor: '125000',
        idempotencyKey: 'client-key-1',
      }),
    ).resolves.toMatchObject({
      status: CrewEarningStatus.pending,
      amountMinor: '125000',
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

  it('approves earnings atomically without recording a payout', async () => {
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

  it('rejects a pending earning without touching cash payouts', async () => {
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

  it('reverses unallocated posted earnings with an audit reason', async () => {
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

  it('does not reverse earnings reserved by an active or completed payout', async () => {
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

  it('does not allow Crew finance to reverse platform-confirmed contract revenue', async () => {
    const t = build();
    const posted = earning({
      status: CrewEarningStatus.posted,
      revenueDistributionId: 'distribution',
      sourceType: CrewEarningSourceType.revenue_share,
    });
    t.prisma.crewEarningEntry.findUnique.mockResolvedValue(posted);
    t.tx.crewEarningEntry.findUniqueOrThrow.mockResolvedValue(posted);
    await expect(
      t.service.reverse(EARNING_ID, ACTOR_ID, {
        expectedVersion: 1,
        reason: 'Change the contract',
      }),
    ).rejects.toThrow('platform finance');
    expect(t.tx.crewEarningEntry.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
  });

  it('waits for an in-flight payout before deciding whether an earning can be reversed', async () => {
    const t = build();
    const posted = earning({ status: CrewEarningStatus.posted, version: 2 });
    t.prisma.crewEarningEntry.findUnique.mockResolvedValue(posted);
    t.tx.crewEarningEntry.findUniqueOrThrow.mockResolvedValue(posted);
    let release!: () => void;
    const payoutInProgress = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.tx.$executeRaw.mockImplementation((_sql: unknown, key: string) =>
      key === `crew:payout-member:${CREW_ID}:${MEMBER_USER_ID}`
        ? payoutInProgress
        : Promise.resolve(1),
    );

    const reversal = t.service.reverse(EARNING_ID, ACTOR_ID, {
      expectedVersion: 2,
      reason: 'Duplicate entry',
    });
    const rejected = expect(reversal).rejects.toMatchObject({
      response: { code: 'CREW_EARNING_ALREADY_ALLOCATED' },
    });
    // Let authorization and transaction setup reach the held member lock.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(t.tx.crewPayoutAllocation.findFirst).not.toHaveBeenCalled();
    t.tx.crewPayoutAllocation.findFirst.mockResolvedValue({
      id: 'concurrent-allocation',
    });
    release();
    await rejected;
    expect(t.tx.crewEarningEntry.update).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
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
        currency: 'USD',
        amountMinor: 5000n,
        approvedByUserId: ACTOR_ID,
      }),
    ).resolves.toMatchObject({ status: CrewEarningStatus.posted });

    expect(firstCallArgument(t.tx.crewEarningEntry.create)).toMatchObject({
      data: {
        sourceType: CrewEarningSourceType.task_reward,
        status: CrewEarningStatus.posted,
        currency: 'USD',
        amountMinor: 5000n,
      },
    });
  });
});

describe('Personal cross-Crew earnings', () => {
  it.each([
    { recordedFrom: '2026-02-30' },
    { recordedThrough: 'tomorrow' },
    { recordedFrom: '2026-10-07', recordedThrough: '2026-10-05' },
  ])('rejects invalid recorded dates: %j', (range) => {
    expect(
      ListMyCrewEarningsQuerySchema.safeParse({ currency: 'USD', ...range })
        .success,
    ).toBe(false);
  });
  it('applies inclusive UTC days to rows, cursors, totals and trend without changing beneficiary scope', async () => {
    const f = build();
    f.prisma.crewEarningEntry.findFirst.mockResolvedValue({ id: EARNING_ID });
    await f.service.listMine(
      MEMBER_USER_ID,
      ListMyCrewEarningsQuerySchema.parse({
        currency: 'USD',
        cursor: EARNING_ID,
        recordedFrom: '2026-10-05',
        recordedThrough: '2026-10-07',
      }),
    );
    const createdAt = {
      gte: new Date('2026-10-05T00:00:00Z'),
      lt: new Date('2026-10-08T00:00:00Z'),
    };
    for (const mock of [
      f.prisma.crewEarningEntry.findFirst,
      f.prisma.crewEarningEntry.findMany,
      f.prisma.crewEarningEntry.groupBy,
      f.prisma.crewEarningEntry.aggregate,
    ]) {
      for (const [args] of mock.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][]) {
        expect(
          args.where.AND ? (args.where.AND as unknown[])[0] : args.where,
        ).toMatchObject({ userId: MEMBER_USER_ID, currency: 'USD', createdAt });
      }
    }
    const query = firstCallArgument(f.prisma.$queryRaw) as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('created_at >=');
    expect(query.text).toContain('created_at <');
    expect(query.values).toEqual(
      expect.arrayContaining([createdAt.gte, createdAt.lt, MEMBER_USER_ID]),
    );
  });
  it('accepts a Crew filter but rejects empty identifiers', () => {
    expect(
      ListMyCrewEarningsQuerySchema.parse({
        currency: 'USD',
        crewId: 'project',
      }).crewId,
    ).toBe('project');
    expect(
      ListMyCrewEarningsQuerySchema.safeParse({ currency: 'USD', crewId: ' ' })
        .success,
    ).toBe(false);
  });

  it('rejects caller-selected beneficiaries and crew-wide scope', () => {
    for (const extra of [{ userId: 'someone-else' }, { scope: 'crew' }]) {
      expect(
        ListMyCrewEarningsQuerySchema.safeParse({ currency: 'USD', ...extra })
          .success,
      ).toBe(false);
    }
  });
  it('scopes every read and aggregate to the current beneficiary and currency without restoring Crew membership', async () => {
    const f = build();
    f.authorization.requireMembership.mockRejectedValue(
      new Error('Former member'),
    );
    await f.service.listMine(
      MEMBER_USER_ID,
      ListMyCrewEarningsQuerySchema.parse({
        currency: 'USD',
        sourceType: 'task_reward',
      }),
    );
    for (const mock of [
      f.prisma.crewEarningEntry.findMany,
      f.prisma.crewEarningEntry.groupBy,
      f.prisma.crewEarningEntry.aggregate,
    ]) {
      for (const [args] of mock.mock.calls as unknown as [
        { where: Record<string, unknown> },
      ][]) {
        expect(
          args.where.AND ? (args.where.AND as unknown[])[0] : args.where,
        ).toMatchObject({
          userId: MEMBER_USER_ID,
          currency: 'USD',
          sourceType: 'task_reward',
        });
      }
    }
    expect(f.authorization.requireMembership).not.toHaveBeenCalled();
  });
  it('rejects an out-of-scope cursor before returning records', async () => {
    const f = build();
    f.prisma.crewEarningEntry.findFirst.mockResolvedValue(null);
    await expect(
      f.service.listMine(
        MEMBER_USER_ID,
        ListMyCrewEarningsQuerySchema.parse({
          currency: 'USD',
          cursor: EARNING_ID,
        }),
      ),
    ).rejects.toThrow('cursor');
    expect(f.prisma.crewEarningEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: MEMBER_USER_ID, currency: 'USD', id: EARNING_ID },
      }),
    );
    expect(f.prisma.crewEarningEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('Income trend authorization', () => {
  it('does not aggregate the Crew ledger when permission is denied', async () => {
    const f = build();
    f.authorization.require.mockRejectedValue(new Error('denied'));
    await expect(
      f.service.list(
        CREW_ID,
        MEMBER_USER_ID,
        ListCrewEarningsQuerySchema.parse({ currency: 'USD', scope: 'crew' }),
      ),
    ).rejects.toThrow('denied');
    expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('scopes personal trend aggregation to the authenticated beneficiary', async () => {
    const f = build();
    await f.service.listMine(
      MEMBER_USER_ID,
      ListMyCrewEarningsQuerySchema.parse({ currency: 'USD', crewId: CREW_ID }),
    );
    const query = firstCallArgument(f.prisma.$queryRaw) as {
      text: string;
      values: unknown[];
    };
    expect(query.text).toContain('user_id =');
    expect(query.values).toContain(MEMBER_USER_ID);
    expect(query.values).toContain(CREW_ID);
    expect(query.values).toContain('USD');
  });
});
