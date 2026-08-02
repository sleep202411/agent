import {
  CrewEarningSourceType,
  CrewPayoutMethod,
  CrewPayoutStatus,
} from '@prisma/client';
import {
  CreateCrewPayoutSchema,
  ListCrewPayoutsQuerySchema,
  PayCrewPayoutSchema,
} from './payouts.dto';
import { CrewPayoutsService } from './payouts.service';

const CREW_ID = 'crew-1';
const MEMBER_ID = 'member-1';
const MEMBER_USER_ID = 'member-user-1';
const ACTOR_ID = 'finance-user-1';
const PAYOUT_ID = '01910d50-4c88-7c78-92d4-16892c06e010';

function payout(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-02T12:00:00.000Z');
  return {
    id: PAYOUT_ID,
    crewId: CREW_ID,
    crewMemberId: MEMBER_ID,
    userId: MEMBER_USER_ID,
    pointsAmount: 800n,
    withholdingAmountMinor: 200n,
    netAmountMinor: 600n,
    status: CrewPayoutStatus.pending,
    paymentMethod: null,
    paymentReference: null,
    paymentProofUrl: null,
    note: null,
    voidReason: null,
    idempotencyKey: 'payout-key',
    createdByUserId: ACTOR_ID,
    paidByUserId: null,
    voidedByUserId: null,
    paidAt: null,
    voidedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    crewMember: { id: MEMBER_ID, userId: MEMBER_USER_ID },
    allocations: [
      {
        id: 'allocation-1',
        pointsAmount: 800n,
        createdAt: now,
        earning: {
          id: 'earning-1',
          title: 'Task reward',
          sourceType: CrewEarningSourceType.task_reward,
          pointsAmount: 1000n,
          postedAt: now,
          task: { id: 'task-1', number: 8, title: 'Storyboard' },
        },
      },
    ],
    ...overrides,
  };
}

function build() {
  const pending = payout();
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewPayout: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(pending),
      create: jest.fn().mockResolvedValue(pending),
      update: jest.fn(),
    },
    crewEarningEntry: { findMany: jest.fn() },
    crewPayoutAllocation: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crewPayoutEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    crewMember: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: MEMBER_ID, userId: MEMBER_USER_ID }),
    },
    crewPayout: {
      findUnique: jest.fn().mockResolvedValue(pending),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    crewPayoutEvent: { findMany: jest.fn().mockResolvedValue([]) },
    crewEarningEntry: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { pointsAmount: 0n } }),
    },
    crewPayoutAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { pointsAmount: 0n } }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const authorization = {
    require: jest.fn().mockResolvedValue({}),
    requireMembership: jest.fn().mockResolvedValue({}),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const service = new CrewPayoutsService(
    prisma as never,
    authorization as never,
    notifications as never,
  );
  return { service, prisma, tx, authorization, notifications };
}

describe('Crew payout schemas', () => {
  it('accepts fixed-ratio point payouts and rejects invalid point inputs', () => {
    expect(ListCrewPayoutsQuerySchema.parse({})).toEqual({
      scope: 'mine',
      limit: 50,
    });
    expect(
      CreateCrewPayoutSchema.safeParse({
        crewMemberId: MEMBER_ID,
        pointsAmount: '800',
        withholdingAmountMinor: '200',
        idempotencyKey: 'client-key-1',
      }).success,
    ).toBe(true);
    expect(
      CreateCrewPayoutSchema.safeParse({
        crewMemberId: MEMBER_ID,
        pointsAmount: '0',
        idempotencyKey: 'short',
      }).success,
    ).toBe(false);
    expect(
      PayCrewPayoutSchema.safeParse({
        expectedVersion: 2,
        paymentMethod: 'bank_transfer',
        paymentReference: '',
      }).success,
    ).toBe(false);
  });
});

describe('CrewPayoutsService', () => {
  it('allocates posted points FIFO and derives USD cents from points', async () => {
    const t = build();
    t.tx.crewEarningEntry.findMany.mockResolvedValue([
      {
        id: 'earning-1',
        pointsAmount: 1000n,
        payoutAllocations: [{ pointsAmount: 300n }],
      },
      { id: 'earning-2', pointsAmount: 500n, payoutAllocations: [] },
    ]);
    t.tx.crewPayout.findUniqueOrThrow.mockResolvedValue(payout());

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        crewMemberId: MEMBER_ID,
        pointsAmount: '800',
        withholdingAmountMinor: '200',
        idempotencyKey: 'client-key-1',
      }),
    ).resolves.toMatchObject({
      pointsAmount: '800',
      netAmountMinor: '600',
      status: CrewPayoutStatus.pending,
    });

    expect(t.authorization.require).toHaveBeenCalledWith(
      CREW_ID,
      ACTOR_ID,
      'finance.payouts.create',
    );
    expect(t.tx.crewPayoutAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          crewId: CREW_ID,
          payoutId: PAYOUT_ID,
          earningId: 'earning-1',
          pointsAmount: 700n,
        },
        {
          crewId: CREW_ID,
          payoutId: PAYOUT_ID,
          earningId: 'earning-2',
          pointsAmount: 100n,
        },
      ],
    });
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'crew.payout.scheduled',
        userId: MEMBER_USER_ID,
      }),
      t.tx,
    );
  });

  it('rejects a payout that exceeds unallocated points', async () => {
    const t = build();
    t.tx.crewEarningEntry.findMany.mockResolvedValue([
      {
        id: 'earning-1',
        pointsAmount: 500n,
        payoutAllocations: [{ pointsAmount: 450n }],
      },
    ]);

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        crewMemberId: MEMBER_ID,
        pointsAmount: '100',
        withholdingAmountMinor: '0',
        idempotencyKey: 'client-key-2',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_PAYOUT_POINTS_UNAVAILABLE',
        availablePoints: '50',
        requestedPoints: '100',
      },
    });
    expect(t.tx.crewPayout.create).not.toHaveBeenCalled();
  });

  it('records offline payment evidence in one pending → paid transition', async () => {
    const t = build();
    const paid = payout({
      status: CrewPayoutStatus.paid,
      version: 2,
      paymentMethod: CrewPayoutMethod.bank_transfer,
      paymentReference: 'BANK-20260802-1',
      paidByUserId: ACTOR_ID,
      paidAt: new Date(),
    });
    t.tx.crewPayout.update.mockResolvedValue(paid);
    await expect(
      t.service.pay(PAYOUT_ID, ACTOR_ID, {
        expectedVersion: 1,
        paymentMethod: CrewPayoutMethod.bank_transfer,
        paymentReference: 'BANK-20260802-1',
      }),
    ).resolves.toMatchObject({
      status: CrewPayoutStatus.paid,
      paymentReference: 'BANK-20260802-1',
    });
    expect(t.notifications.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'crew.payout.paid' }),
      t.tx,
    );
  });

  it('rejects stale and invalid state transitions', async () => {
    const t = build();
    const paid = payout({
      status: CrewPayoutStatus.paid,
      version: 2,
    });
    t.prisma.crewPayout.findUnique.mockResolvedValue(paid);
    t.tx.crewPayout.findUniqueOrThrow.mockResolvedValue(paid);

    await expect(
      t.service.pay(PAYOUT_ID, ACTOR_ID, {
        expectedVersion: 1,
        paymentMethod: CrewPayoutMethod.bank_transfer,
        paymentReference: 'BANK-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_PAYOUT_VERSION_CONFLICT' },
    });

    await expect(
      t.service.pay(PAYOUT_ID, ACTOR_ID, {
        expectedVersion: 2,
        paymentMethod: CrewPayoutMethod.bank_transfer,
        paymentReference: 'BANK-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_PAYOUT_INVALID_TRANSITION' },
    });
  });

  it('reports confirmed, reserved, paid and available points independently of cash', async () => {
    const t = build();
    t.prisma.crewEarningEntry.aggregate.mockResolvedValue({
      _sum: { pointsAmount: 2000n },
    });
    t.prisma.crewPayoutAllocation.aggregate
      .mockResolvedValueOnce({ _sum: { pointsAmount: 300n } })
      .mockResolvedValueOnce({ _sum: { pointsAmount: 700n } });

    await expect(
      t.service.list(CREW_ID, MEMBER_USER_ID, { scope: 'mine', limit: 50 }),
    ).resolves.toMatchObject({
      summary: {
        confirmedPoints: '2000',
        reservedPoints: '300',
        paidPoints: '700',
        availablePoints: '1000',
      },
    });
  });
});
