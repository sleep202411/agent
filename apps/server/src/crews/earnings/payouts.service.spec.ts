import {
  CrewEarningSourceType,
  CrewPayoutMethod,
  CrewPayoutStatus,
} from '@prisma/client';
import {
  CreateCrewPayoutSchema,
  ListCrewPayoutsQuerySchema,
  ListMyCrewPayoutsQuerySchema,
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
    currency: 'USD',
    id: PAYOUT_ID,
    crewId: CREW_ID,
    crewMemberId: MEMBER_ID,
    userId: MEMBER_USER_ID,
    amountMinor: 800n,
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
        amountMinor: 800n,
        createdAt: now,
        earning: {
          id: 'earning-1',
          title: 'Task reward',
          sourceType: CrewEarningSourceType.task_reward,
          amountMinor: 1000n,
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
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
    },
    crewPayoutAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountMinor: 0n } }),
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
  it('accepts minor-unit payouts and rejects invalid payment inputs', () => {
    expect(ListCrewPayoutsQuerySchema.parse({ currency: 'USD' })).toEqual({
      currency: 'USD',
      scope: 'mine',
      limit: 50,
    });
    expect(
      CreateCrewPayoutSchema.safeParse({
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        amountMinor: '800',
        withholdingAmountMinor: '200',
        idempotencyKey: 'client-key-1',
      }).success,
    ).toBe(true);
    expect(
      CreateCrewPayoutSchema.safeParse({
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        amountMinor: '0',
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
  it('allocates posted earnings FIFO in the requested currency', async () => {
    const t = build();
    t.tx.crewEarningEntry.findMany.mockResolvedValue([
      {
        id: 'earning-1',
        amountMinor: 1000n,
        payoutAllocations: [{ amountMinor: 300n }],
      },
      { id: 'earning-2', amountMinor: 500n, payoutAllocations: [] },
    ]);
    t.tx.crewPayout.findUniqueOrThrow.mockResolvedValue(payout());

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        amountMinor: '800',
        withholdingAmountMinor: '200',
        idempotencyKey: 'client-key-1',
      }),
    ).resolves.toMatchObject({
      amountMinor: '800',
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
          amountMinor: 700n,
        },
        {
          crewId: CREW_ID,
          payoutId: PAYOUT_ID,
          earningId: 'earning-2',
          amountMinor: 100n,
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

  it('rejects a payout that exceeds unallocated earnings', async () => {
    const t = build();
    t.tx.crewEarningEntry.findMany.mockResolvedValue([
      {
        id: 'earning-1',
        amountMinor: 500n,
        payoutAllocations: [{ amountMinor: 450n }],
      },
    ]);

    await expect(
      t.service.create(CREW_ID, ACTOR_ID, {
        currency: 'USD',
        crewMemberId: MEMBER_ID,
        amountMinor: '100',
        withholdingAmountMinor: '0',
        idempotencyKey: 'client-key-2',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_PAYOUT_AMOUNT_UNAVAILABLE',
        availableAmountMinor: '50',
        requestedAmountMinor: '100',
      },
    });
    expect(t.tx.crewPayout.create).not.toHaveBeenCalled();
  });

  it('waits for an in-flight reversal before reading available earnings', async () => {
    const t = build();
    let release!: () => void;
    const reversalInProgress = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.tx.$executeRaw.mockImplementation((_sql: unknown, key: string) =>
      key === `crew:payout-member:${CREW_ID}:${MEMBER_USER_ID}`
        ? reversalInProgress
        : Promise.resolve(1),
    );
    const creating = t.service.create(CREW_ID, ACTOR_ID, {
      currency: 'USD',
      crewMemberId: MEMBER_ID,
      amountMinor: '100',
      withholdingAmountMinor: '0',
      idempotencyKey: 'concurrent-payout',
    });
    const rejected = expect(creating).rejects.toMatchObject({
      response: {
        code: 'CREW_PAYOUT_AMOUNT_UNAVAILABLE',
        availableAmountMinor: '0',
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(t.tx.crewEarningEntry.findMany).not.toHaveBeenCalled();
    // The reversal commits, so the posted-earnings query no longer returns it.
    t.tx.crewEarningEntry.findMany.mockResolvedValue([]);
    release();
    await rejected;
    expect(t.tx.crewEarningEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          crewId: CREW_ID,
          userId: MEMBER_USER_ID,
          currency: 'USD',
          status: 'posted',
        },
      }),
    );
    expect(t.tx.crewPayout.create).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
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

  it('reports confirmed, reserved, paid and available amounts in one currency', async () => {
    const t = build();
    t.prisma.crewEarningEntry.aggregate.mockResolvedValue({
      _sum: { amountMinor: 2000n },
    });
    t.prisma.crewPayoutAllocation.aggregate
      .mockResolvedValueOnce({ _sum: { amountMinor: 300n } })
      .mockResolvedValueOnce({ _sum: { amountMinor: 700n } });

    await expect(
      t.service.list(CREW_ID, MEMBER_USER_ID, {
        currency: 'USD',
        scope: 'mine',
        limit: 50,
      }),
    ).resolves.toMatchObject({
      summary: {
        confirmedAmountMinor: '2000',
        reservedAmountMinor: '300',
        paidAmountMinor: '700',
        availableAmountMinor: '1000',
      },
    });
  });
});

describe('Personal payout history', () => {
  it('rejects caller-selected users and broader scopes', () => {
    for (const extra of [{ userId: 'other' }, { scope: 'crew' }])
      expect(
        ListMyCrewPayoutsQuerySchema.safeParse({ currency: 'USD', ...extra })
          .success,
      ).toBe(false);
  });
  it('scopes rows and full totals to the authenticated beneficiary without requiring current membership', async () => {
    const f = build();
    f.authorization.requireMembership.mockRejectedValue(
      new Error('Former member'),
    );
    f.prisma.crewPayout.groupBy.mockResolvedValue([
      {
        status: 'paid',
        _count: { _all: 4 },
        _sum: { amountMinor: 1000n, netAmountMinor: 900n },
      },
    ]);
    const result = await f.service.listMine(
      MEMBER_USER_ID,
      ListMyCrewPayoutsQuerySchema.parse({ currency: 'USD' }),
    );
    expect(result.summary.byStatus).toEqual([
      { status: 'paid', count: 4, amountMinor: '1000', netAmountMinor: '900' },
    ]);
    for (const mock of [
      f.prisma.crewPayout.findMany,
      f.prisma.crewPayout.groupBy,
    ])
      expect(mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: MEMBER_USER_ID, currency: 'USD' },
        }),
      );
    expect(f.authorization.requireMembership).not.toHaveBeenCalled();
  });
  it('rejects a cursor outside the current beneficiary scope before fetching rows', async () => {
    const f = build();
    f.prisma.crewPayout.findFirst.mockResolvedValue(null);
    await expect(
      f.service.listMine(
        MEMBER_USER_ID,
        ListMyCrewPayoutsQuerySchema.parse({
          currency: 'USD',
          cursor: PAYOUT_ID,
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'CREW_PAYOUT_CURSOR_INVALID' },
      status: 400,
    });
    expect(f.prisma.crewPayout.findMany).not.toHaveBeenCalled();
  });
});
