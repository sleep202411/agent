import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingOrderStatus, BillingOrderType, Prisma } from '@prisma/client';
import {
  ReferralsService,
  computeTotals,
  formatBpsPercent,
} from './referrals.service';

// ─── fixtures ────────────────────────────────────────────────────────────

const REFERRER = 'user-referrer';
const REFEREE = 'user-referee';

function programRow(over: Record<string, unknown> = {}) {
  return {
    id: 'prog-1',
    key: 'default',
    enabled: true,
    currency: 'USD',
    qualifyEvent: 'first_purchase',
    holdDays: 7,
    rewardPerReferralMinor: 0n,
    maxRewardedReferees: 0,
    commissionBps: 0,
    refereeMaxAccountAgeHours: 0,
    inviteeBenefitTitle: null,
    inviteeBenefitDetail: null,
    inviteeBenefitMinor: 0n,
    inviteeBenefitExpiresInDays: null,
    milestones: [] as unknown[],
    inviteeBenefitItems: [] as unknown[],
    ...over,
  };
}

function attributionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'attr-1',
    programKey: 'default',
    referrerUserId: REFERRER,
    refereeUserId: REFEREE,
    inviteCode: 'CODE9',
    status: 'qualified',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  };
}

function rewardRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rw-1',
    programKey: 'default',
    userId: REFERRER,
    kind: 'commission',
    payoutType: 'cash',
    status: 'accrued',
    amountMinor: 300n,
    days: 0,
    currency: 'USD',
    title: 'Purchase commission',
    subtitle: null,
    attributionId: null,
    milestoneId: null,
    orderId: 'order-1',
    availableAt: new Date(Date.now() - 60_000),
    paidOutAt: null,
    createdAt: new Date(),
    ...over,
  };
}

function cashItem(over: Record<string, unknown> = {}) {
  return {
    id: 'it-1',
    rewardId: 'rw-1',
    payoutType: 'cash',
    amountMinor: 300n,
    days: 0,
    currency: 'USD',
    rank: 0,
    grantedAt: null,
    ...over,
  };
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/** Typed accessor for a mock's first call's first argument. */
function firstCallArg<T>(fn: { mock: { calls: unknown[][] } }): T {
  return fn.mock.calls[0][0] as T;
}

// ─── service factory (house pattern: hand-rolled literals, `as never`) ───

function makeService() {
  const tx = {
    referralAttribution: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
    referralReward: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    referralRewardItem: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    referralProgram: { findUnique: jest.fn() },
    referralAttribution: {
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    referralReward: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    referralRewardItem: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    referralCommissionRate: { findUnique: jest.fn().mockResolvedValue(null) },
    billingOrder: {
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    walletAccount: { upsert: jest.fn().mockResolvedValue({ id: 'acct-1' }) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const legacy = {
    queryOne: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  };
  const entitlements = { grantComplimentary: jest.fn().mockResolvedValue({}) };
  const walletLedger = { postEntry: jest.fn().mockResolvedValue({}) };
  const workspaces = {
    ensurePersonalWorkspace: jest.fn().mockResolvedValue({ id: 'ws-1' }),
  };
  const javaUsers = {
    findRecommendationCode: jest.fn().mockResolvedValue(null),
  };
  const service = new ReferralsService(
    prisma as never,
    legacy as never,
    entitlements as never,
    walletLedger as never,
    workspaces as never,
    javaUsers as never,
  );
  return { service, prisma, tx, legacy, entitlements, walletLedger };
}

type CommissionOrder = {
  id: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
};

function accrueCommission(service: ReferralsService, order: CommissionOrder) {
  return (
    service as unknown as {
      accrueCommissionForOrder(o: CommissionOrder): Promise<void>;
    }
  ).accrueCommissionForOrder(order);
}

// ─── 消费返佣 accrual ─────────────────────────────────────────────────────

describe('accrueCommissionForOrder', () => {
  it('floors the bps math and snapshots rate + source amount onto the reward', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(programRow());
    prisma.referralCommissionRate.findUnique.mockResolvedValue({
      commissionBps: 3000,
    });

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 999n,
      currency: 'USD',
    });

    expect(prisma.referralReward.create).toHaveBeenCalledTimes(1);
    const data = firstCallArg<{ data: Record<string, unknown> }>(
      prisma.referralReward.create,
    ).data;
    expect(data.kind).toBe('commission');
    expect(data.userId).toBe(REFERRER);
    expect(data.amountMinor).toBe(299n); // floor(999 × 30%)
    expect(data.orderId).toBe('order-1');
    expect(data.commissionBps).toBe(3000);
    expect(data.sourceAmountMinor).toBe(999n);
    expect(data.subtitle).toContain('30%');
    expect(data.subtitle).toContain('$9.99');
    const items = (data.items as { create: Record<string, unknown>[] }).create;
    expect(items).toHaveLength(1);
    expect(items[0].payoutType).toBe('cash');
    expect(items[0].amountMinor).toBe(299n);
  });

  it('a per-user override of 0 disables commission even when the program default is positive', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ commissionBps: 3000 }),
    );
    prisma.referralCommissionRate.findUnique.mockResolvedValue({
      commissionBps: 0,
    });

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 999n,
      currency: 'USD',
    });

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
  });

  it('falls back to the program default rate when no override row exists', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ commissionBps: 1000 }),
    );
    prisma.referralCommissionRate.findUnique.mockResolvedValue(null);

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 1999n,
      currency: 'USD',
    });

    const data = firstCallArg<{ data: Record<string, unknown> }>(
      prisma.referralReward.create,
    ).data;
    expect(data.amountMinor).toBe(199n);
    expect(data.commissionBps).toBe(1000);
  });

  it.each([
    ['non-USD order', { currency: 'CNY', amountMinor: 999n }],
    ['zero-amount order', { currency: 'USD', amountMinor: 0n }],
    [
      'sub-cent commission (rounds to zero)',
      { currency: 'USD', amountMinor: 1n },
    ],
  ])('accrues nothing for a %s', async (_label, orderOver) => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ commissionBps: 3000 }),
    );

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      ...orderOver,
    } as CommissionOrder);

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
  });

  it('requires a QUALIFIED attribution', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(
      attributionRow({ status: 'pending' }),
    );

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 999n,
      currency: 'USD',
    });

    expect(prisma.referralProgram.findUnique).not.toHaveBeenCalled();
    expect(prisma.referralReward.create).not.toHaveBeenCalled();
  });

  it('requires an enabled program', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ enabled: false, commissionBps: 3000 }),
    );

    await accrueCommission(service, {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 999n,
      currency: 'USD',
    });

    expect(prisma.referralReward.create).not.toHaveBeenCalled();
  });

  it('swallows the per-order unique violation (duplicate webhook) but rethrows anything else', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ commissionBps: 3000 }),
    );
    prisma.referralReward.create.mockRejectedValueOnce(uniqueViolation());

    const order: CommissionOrder = {
      id: 'order-1',
      userId: REFEREE,
      amountMinor: 999n,
      currency: 'USD',
    };
    await expect(accrueCommission(service, order)).resolves.toBeUndefined();

    prisma.referralReward.create.mockRejectedValueOnce(new Error('boom'));
    await expect(accrueCommission(service, order)).rejects.toThrow('boom');
  });
});

// ─── billing hook routing ────────────────────────────────────────────────

describe('accrueForOrder', () => {
  function spyPaths(service: ReferralsService) {
    const qualify = jest
      .spyOn(
        service as unknown as {
          qualifyRefereePurchase: (u: string) => Promise<void>;
        },
        'qualifyRefereePurchase',
      )
      .mockResolvedValue(undefined);
    const commission = jest
      .spyOn(
        service as unknown as {
          accrueCommissionForOrder: (o: unknown) => Promise<void>;
        },
        'accrueCommissionForOrder',
      )
      .mockResolvedValue(undefined);
    return { qualify, commission };
  }

  it('runs qualify then per-order commission for a paid order', async () => {
    const { service, prisma } = makeService();
    const { qualify, commission } = spyPaths(service);
    prisma.billingOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: REFEREE,
      status: BillingOrderStatus.paid,
      orderType: BillingOrderType.community_point_topup,
      amountMinor: 999n,
      currency: 'USD',
    });

    await service.accrueForOrder('order-1');

    expect(qualify).toHaveBeenCalledWith(REFEREE);
    expect(commission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', amountMinor: 999n }),
    );
  });

  it('ignores refunded orders and manual adjustments', async () => {
    const { service, prisma } = makeService();
    const { qualify, commission } = spyPaths(service);

    prisma.billingOrder.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      userId: REFEREE,
      status: BillingOrderStatus.refunded,
      orderType: BillingOrderType.community_point_topup,
      amountMinor: 999n,
      currency: 'USD',
    });
    await service.accrueForOrder('order-1');

    prisma.billingOrder.findUnique.mockResolvedValueOnce({
      id: 'order-2',
      userId: REFEREE,
      status: BillingOrderStatus.paid,
      orderType: BillingOrderType.manual_adjustment,
      amountMinor: 999n,
      currency: 'USD',
    });
    await service.accrueForOrder('order-2');

    expect(qualify).not.toHaveBeenCalled();
    expect(commission).not.toHaveBeenCalled();
  });
});

// ─── claim (CAS-first + heal) ────────────────────────────────────────────

describe('claimReward', () => {
  it('rejects a foreign or missing reward', async () => {
    const { service, prisma } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ userId: 'someone-else' }),
    );
    await expect(service.claimReward(REFERRER, 'rw-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects while still inside the hold window', async () => {
    const { service, prisma } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ availableAt: new Date(Date.now() + 60_000) }),
    );
    await expect(service.claimReward(REFERRER, 'rw-1')).rejects.toThrow(
      'hold window',
    );
  });

  it('flips accrued→paid_out FIRST, then grants the bundle to the withdrawable wallet', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(rewardRow());
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([cashItem()]);

    const result = await service.claimReward(REFERRER, 'rw-1');

    expect(result).toEqual({ status: 'paid_out' });
    expect(prisma.referralReward.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rw-1', status: 'accrued' },
      }),
    );
    // CAS committed before the wallet credit went out.
    expect(
      prisma.referralReward.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(walletLedger.postEntry.mock.invocationCallOrder[0]);
    const entry = firstCallArg<Record<string, unknown>>(walletLedger.postEntry);
    expect(entry.availableDelta).toBe(300n);
    expect(entry.idempotencyKey).toBe(
      'referral_reward:rw-1:it-1:community:withdrawable',
    );
    expect(prisma.referralRewardItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'it-1', grantedAt: null } }),
    );
  });

  it('returns paid_out without granting when a concurrent claim won the CAS', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique
      .mockResolvedValueOnce(rewardRow())
      .mockResolvedValueOnce({ status: 'paid_out' });
    prisma.referralReward.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claimReward(REFERRER, 'rw-1')).resolves.toEqual({
      status: 'paid_out',
    });
    expect(walletLedger.postEntry).not.toHaveBeenCalled();
  });

  it('refuses (and never grants) when a refund reversal won the CAS', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique
      .mockResolvedValueOnce(rewardRow())
      .mockResolvedValueOnce({ status: 'reversed' });
    prisma.referralReward.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claimReward(REFERRER, 'rw-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(walletLedger.postEntry).not.toHaveBeenCalled();
  });

  it('heals a crashed claim: re-claim of a paid_out reward grants only the ungranted items', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ status: 'paid_out' }),
    );
    prisma.referralRewardItem.findMany.mockResolvedValue([
      cashItem({ id: 'it-1', grantedAt: new Date() }),
      cashItem({ id: 'it-2', amountMinor: 100n }),
    ]);

    await expect(service.claimReward(REFERRER, 'rw-1')).resolves.toEqual({
      status: 'paid_out',
    });
    expect(walletLedger.postEntry).toHaveBeenCalledTimes(1);
    const entry = firstCallArg<Record<string, unknown>>(walletLedger.postEntry);
    expect(entry.availableDelta).toBe(100n);
  });

  it('gifted compute points expire per the promo-credit policy (30d)', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ payoutType: 'points_compute', currency: null }),
    );
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([
      cashItem({
        payoutType: 'points_compute',
        amountMinor: 88n,
        currency: null,
      }),
    ]);

    await service.claimReward(REFERRER, 'rw-1');

    const entry = firstCallArg<{
      creditGrant: { expiresAt: Date | null };
    }>(walletLedger.postEntry);
    const expiresAt = entry.creditGrant.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const days = (expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('gifted COMMUNITY points get a 30d expiry grant into the consumable pool', async () => {
    const { service, prisma, walletLedger } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ payoutType: 'points_community', currency: null }),
    );
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([
      cashItem({
        payoutType: 'points_community',
        amountMinor: 888n,
        currency: null,
      }),
    ]);

    await service.claimReward(REFERRER, 'rw-1');

    const entry = firstCallArg<{
      idempotencyKey: string;
      creditGrant?: { grantType: string; expiresAt: Date | null };
    }>(walletLedger.postEntry);
    // Consumable pool (not withdrawable) + a real 30d expiry.
    expect(entry.idempotencyKey).toContain(':community:consumable');
    expect(entry.creditGrant).toBeDefined();
    const days =
      (entry.creditGrant!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('cash payout to the WITHDRAWABLE pool carries NO expiry grant (earned money never expires)', async () => {
    const { service, prisma, walletLedger } = makeService();
    // cash → withdrawable community_point (the referral cash payout path).
    prisma.referralReward.findUnique.mockResolvedValue(
      rewardRow({ payoutType: 'cash', currency: 'USD' }),
    );
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([
      cashItem({ payoutType: 'cash', amountMinor: 300n, currency: 'USD' }),
    ]);

    await service.claimReward(REFERRER, 'rw-1');

    const entry = firstCallArg<{
      idempotencyKey: string;
      creditGrant?: unknown;
    }>(walletLedger.postEntry);
    expect(entry.idempotencyKey).toContain(':community:withdrawable');
    expect(entry.creditGrant).toBeUndefined();
  });

  it('fails loud when a reward has no items snapshot (broken invariant)', async () => {
    const { service, prisma } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(rewardRow());
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([]);

    await expect(service.claimReward(REFERRER, 'rw-1')).rejects.toThrow(
      'has no bundle items',
    );
  });

  it('fails loud on an unknown payout type instead of marking it granted', async () => {
    const { service, prisma } = makeService();
    prisma.referralReward.findUnique.mockResolvedValue(rewardRow());
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.referralRewardItem.findMany.mockResolvedValue([
      cashItem({ payoutType: 'mystery_points' }),
    ]);

    await expect(service.claimReward(REFERRER, 'rw-1')).rejects.toThrow(
      'Unsupported referral payout type',
    );
    expect(prisma.referralRewardItem.updateMany).not.toHaveBeenCalled();
  });
});

// ─── refund reversal ─────────────────────────────────────────────────────

describe('reverseForOrder', () => {
  it('no-ops unless the order is fully refunded', async () => {
    const { service, prisma } = makeService();
    prisma.billingOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: REFEREE,
      status: BillingOrderStatus.paid,
    });

    await service.reverseForOrder('order-1');

    expect(prisma.referralReward.updateMany).not.toHaveBeenCalled();
  });

  it("reverses THIS order's accrued commission even when other paid orders keep the qualification", async () => {
    const { service, prisma } = makeService();
    prisma.billingOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: REFEREE,
      status: BillingOrderStatus.refunded,
    });
    prisma.referralReward.updateMany.mockResolvedValue({ count: 1 });
    prisma.billingOrder.count.mockResolvedValue(2); // still a paying customer

    await service.reverseForOrder('order-1');

    expect(prisma.referralReward.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', kind: 'commission', status: 'accrued' },
      data: { status: 'reversed' },
    });
    // Qualification untouched — the attribution was never even loaded.
    expect(prisma.referralAttribution.findUnique).not.toHaveBeenCalled();
  });

  it('reverses the attribution + rewards when no paid order backs it anymore', async () => {
    const { service, prisma, tx } = makeService();
    prisma.billingOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: REFEREE,
      status: BillingOrderStatus.refunded,
    });
    prisma.billingOrder.count.mockResolvedValue(0);
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow());

    await service.reverseForOrder('order-1');

    expect(tx.referralAttribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attr-1', status: 'qualified' },
        data: { status: 'reversed' },
      }),
    );
    expect(tx.referralReward.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { attributionId: 'attr-1', status: 'accrued' },
      }),
    );
  });
});

// ─── qualify gates + milestone snapshot ──────────────────────────────────

describe('qualifyRefereePurchase', () => {
  it('no-ops without a pending attribution', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(attributionRow()); // already qualified

    await service.qualifyRefereePurchase(REFEREE);

    expect(prisma.referralProgram.findUnique).not.toHaveBeenCalled();
  });

  it('refuses rogue qualifyEvent values loudly instead of silently qualifying', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(
      attributionRow({ status: 'pending' }),
    );
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ qualifyEvent: 'signup' }),
    );

    await service.qualifyRefereePurchase(REFEREE);

    expect(prisma.billingOrder.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires at least one paid order', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(
      attributionRow({ status: 'pending' }),
    );
    prisma.referralProgram.findUnique.mockResolvedValue(programRow());
    prisma.billingOrder.count.mockResolvedValue(0);

    await service.qualifyRefereePurchase(REFEREE);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no longer accrues milestones (moved to the registration-based path)', async () => {
    const { service, prisma, tx } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(
      attributionRow({ status: 'pending' }),
    );
    prisma.referralProgram.findUnique.mockResolvedValue(programRow());
    prisma.billingOrder.count.mockResolvedValue(1);

    await service.qualifyRefereePurchase(REFEREE);

    // Qualifies the attribution (gates commission) but creates NO milestone.
    expect(tx.referralAttribution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'attr-1', status: 'pending' } }),
    );
    expect(tx.referralReward.createMany).not.toHaveBeenCalled();
  });

  it('accrues the invitee welcome-perk BUNDLE on the referee first purchase', async () => {
    const { service, prisma, tx } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(
      attributionRow({ status: 'pending' }),
    );
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({
        inviteeBenefitTitle: '新人礼',
        inviteeBenefitItems: [
          {
            payoutType: 'points_community',
            amountMinor: 200n,
            days: 0,
            rank: 0,
          },
          {
            payoutType: 'membership_compute',
            amountMinor: 0n,
            days: 7,
            rank: 1,
          },
        ],
      }),
    );
    prisma.billingOrder.count.mockResolvedValue(1);

    await service.qualifyRefereePurchase(REFEREE);

    const data = firstCallArg<{ data: Record<string, unknown> }>(
      tx.referralReward.create,
    ).data;
    expect(data.kind).toBe('invitee');
    expect(data.userId).toBe(REFEREE);
    expect(data.payoutType).toBe('points_community');
    const items = (data.items as { create: Record<string, unknown>[] }).create;
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      payoutType: 'membership_compute',
      days: 7,
    });
  });
});

describe('accrueMilestonesForReferrer (registration-based)', () => {
  const call = (
    service: ReferralsService,
    referrerUserId: string,
    reached: number,
  ) =>
    (
      service as unknown as {
        accrueMilestonesForReferrer(u: string, n: number): Promise<void>;
      }
    ).accrueMilestonesForReferrer(referrerUserId, reached);

  const milestone = {
    id: 'ms-1',
    inviteeThreshold: 1,
    payoutType: 'points_community',
    rewardMinor: 100n,
    payoutDays: 0,
    title: 'Invite 1 friend',
    detail: '100 community points + 3 days of Studio membership',
    rank: 1,
    items: [
      { payoutType: 'points_community', amountMinor: 100n, days: 0, rank: 0 },
      { payoutType: 'membership_compute', amountMinor: 0n, days: 3, rank: 1 },
    ],
  };

  it('grants a newly-crossed tier with its bundle snapshot', async () => {
    const { service, prisma, tx } = makeService();
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ milestones: [milestone] }),
    );
    tx.referralReward.findMany
      .mockResolvedValueOnce([]) // earned milestoneIds
      .mockResolvedValueOnce([
        { id: 'rw-ms-1', milestoneId: 'ms-1', _count: { items: 0 } },
      ]);

    await call(service, REFERRER, 5);

    expect(tx.referralReward.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    const itemRows = firstCallArg<{ data: Record<string, unknown>[] }>(
      tx.referralRewardItem.createMany,
    ).data;
    expect(itemRows).toHaveLength(2);
    expect(itemRows[0]).toMatchObject({
      rewardId: 'rw-ms-1',
      payoutType: 'points_community',
      amountMinor: 100n,
    });
  });

  it('does nothing at zero reached count', async () => {
    const { service, prisma } = makeService();
    await call(service, REFERRER, 0);
    expect(prisma.referralProgram.findUnique).not.toHaveBeenCalled();
  });

  it('skips a tier already earned (idempotent)', async () => {
    const { service, prisma, tx } = makeService();
    prisma.referralProgram.findUnique.mockResolvedValue(
      programRow({ milestones: [milestone] }),
    );
    tx.referralReward.findMany.mockResolvedValueOnce([{ milestoneId: 'ms-1' }]);

    await call(service, REFERRER, 5);

    expect(tx.referralReward.createMany).not.toHaveBeenCalled();
  });
});

describe('countReferralRegistrations', () => {
  const call = (service: ReferralsService, code: string) =>
    (
      service as unknown as {
        countReferralRegistrations(c: string): Promise<number>;
      }
    ).countReferralRegistrations(code);

  it('counts ALL registrations for the code (no phone filter)', async () => {
    const { service, legacy } = makeService();
    legacy.queryOne.mockResolvedValue({ n: 7 });
    await expect(call(service, 'CODE9')).resolves.toBe(7);
    const sql = legacy.queryOne.mock.calls[0][0] as string;
    expect(sql).toContain('recommendation_code_source = ?');
    expect(sql).not.toContain('phone');
  });

  it('returns 0 on a bridge outage', async () => {
    const { service, legacy } = makeService();
    legacy.queryOne.mockRejectedValue(new Error('bridge down'));
    await expect(call(service, 'CODE9')).resolves.toBe(0);
  });
});

// ─── attribution timing + anti-fraud gate ────────────────────────────────

describe('ensureAttribution', () => {
  const call = (service: ReferralsService) =>
    (
      service as unknown as {
        ensureAttribution(refereeUserId: string): Promise<void>;
      }
    ).ensureAttribution(REFEREE);

  it('backdates the attribution to the referee registration time (when the code was entered)', async () => {
    const { service, prisma, legacy } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(null);
    const registeredAt = new Date('2026-06-20T08:00:00Z');
    legacy.queryOne
      .mockResolvedValueOnce({
        recommendation_code_source: 'CODE9',
        create_time: registeredAt,
      })
      .mockResolvedValueOnce({ id: 42 });
    prisma.referralProgram.findUnique.mockResolvedValue({
      refereeMaxAccountAgeHours: 0,
    });

    await call(service);

    expect(prisma.referralAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referrerUserId: '42',
        refereeUserId: REFEREE,
        inviteCode: 'CODE9',
        status: 'pending',
        createdAt: registeredAt,
      }) as unknown,
    });
  });

  it('the account-age gate blocks stale accounts (legacy-data noise)', async () => {
    const { service, prisma, legacy } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(null);
    legacy.queryOne
      .mockResolvedValueOnce({
        recommendation_code_source: 'CODE9',
        create_time: new Date(Date.now() - 10 * 24 * 3600_000),
      })
      .mockResolvedValueOnce({ id: 42 });
    prisma.referralProgram.findUnique.mockResolvedValue({
      refereeMaxAccountAgeHours: 24,
    });

    await call(service);

    expect(prisma.referralAttribution.create).not.toHaveBeenCalled();
  });

  it('skips self-referrals and unknown codes', async () => {
    const { service, prisma, legacy } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(null);
    legacy.queryOne
      .mockResolvedValueOnce({
        recommendation_code_source: 'CODE9',
        create_time: new Date(),
      })
      .mockResolvedValueOnce({ id: REFEREE }); // resolves to the referee itself

    await call(service);

    expect(prisma.referralAttribution.create).not.toHaveBeenCalled();
  });

  it('skips users who were never referred', async () => {
    const { service, prisma, legacy } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(null);
    legacy.queryOne.mockResolvedValueOnce({
      recommendation_code_source: null,
      create_time: new Date(),
    });

    await call(service);

    expect(legacy.queryOne).toHaveBeenCalledTimes(1);
    expect(prisma.referralAttribution.create).not.toHaveBeenCalled();
  });
});

// ─── lazy commission backfill ────────────────────────────────────────────

describe('backfillRefereeCommissions', () => {
  const call = (service: ReferralsService) =>
    (
      service as unknown as {
        backfillRefereeCommissions(refereeUserId: string): Promise<void>;
      }
    ).backfillRefereeCommissions(REFEREE);

  it('only sweeps qualified referees', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue(null);

    await call(service);

    expect(prisma.billingOrder.findMany).not.toHaveBeenCalled();
  });

  it('accrues only orders missing a commission reward', async () => {
    const { service, prisma } = makeService();
    prisma.referralAttribution.findUnique.mockResolvedValue({
      status: 'qualified',
    });
    prisma.billingOrder.findMany.mockResolvedValue([
      { id: 'o-1', userId: REFEREE, amountMinor: 100n, currency: 'USD' },
      { id: 'o-2', userId: REFEREE, amountMinor: 200n, currency: 'USD' },
    ]);
    prisma.referralReward.findMany.mockResolvedValue([{ orderId: 'o-1' }]);
    const commission = jest
      .spyOn(
        service as unknown as {
          accrueCommissionForOrder: (o: unknown) => Promise<void>;
        },
        'accrueCommissionForOrder',
      )
      .mockResolvedValue(undefined);

    await call(service);

    expect(commission).toHaveBeenCalledTimes(1);
    expect(commission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'o-2' }),
    );
  });
});

// ─── pure helpers ────────────────────────────────────────────────────────

describe('computeTotals', () => {
  it('buckets full-table cash aggregates by status', () => {
    const totals = computeTotals(
      [
        { status: 'accrued', _sum: { amountMinor: 100n } },
        { status: 'paid_out', _sum: { amountMinor: 50n } },
        { status: 'pending', _sum: { amountMinor: 7n } },
        { status: 'reversed', _sum: { amountMinor: 3n } },
        { status: 'voided', _sum: { amountMinor: null } },
      ],
      12,
    );
    expect(totals).toEqual({
      pendingMinor: '7',
      confirmedMinor: '150',
      reversedMinor: '3',
      inviteeCount: 12,
    });
  });
});

describe('formatBpsPercent', () => {
  it.each([
    [3000, '30%'],
    [250, '2.5%'],
    [1, '0.01%'],
    [10000, '100%'],
  ])('%d bps → %s', (bps, expected) => {
    expect(formatBpsPercent(bps)).toBe(expected);
  });
});
