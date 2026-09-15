import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ReferralsService } from './referrals.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `referral-qualification-${randomUUID()}`;
jest.setTimeout(30000);
integration('Referral qualification admission (owned PostgreSQL)', () => {
  const originalInviteBase = process.env.REFERRAL_INVITE_BASE_URL;
  let db: PrismaClient;
  let service: ReferralsService;
  let programKey: string;
  let referrer: string;
  let referees: string[];
  let itemId: string;
  beforeAll(async () => {
    process.env.REFERRAL_INVITE_BASE_URL = 'https://fixture.invalid';
    const url = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    service = new ReferralsService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });
  beforeEach(async () => {
    programKey = randomUUID();
    referrer = randomUUID();
    referees = [randomUUID(), randomUUID()];
    await db.referralProgram.create({
      data: {
        key: programKey,
        enabled: true,
        rewardPerReferralMinor: 100n,
        maxRewardedReferees: 1,
      },
    });
    const item = await db.billingCatalogItem.create({
      data: {
        code: programKey,
        name: 'Fixture',
        productType: 'membership_plan',
      },
    });
    itemId = item.id;
    const price = await db.billingPrice.create({
      data: { itemId, currency: 'USD', amountMinor: 200n, interval: 'month' },
    });
    for (const userId of referees) {
      await db.referralAttribution.create({
        data: {
          programKey,
          referrerUserId: referrer,
          refereeUserId: userId,
          inviteCode: 'FIXTURE',
        },
      });
      await db.billingOrder.create({
        data: {
          userId,
          subjectType: 'user',
          subjectId: userId,
          orderNo: userId,
          idempotencyKey: userId,
          orderType: 'subscription_checkout',
          status: 'paid',
          itemId,
          priceId: price.id,
          provider: 'airwallex',
          currency: 'USD',
          amountMinor: 200n,
          subtotalAmountMinor: 200n,
        },
      });
    }
  });
  afterEach(async () => {
    if (!programKey || !referees) return;
    await db.referralReward.deleteMany({ where: { programKey } });
    await db.referralAttribution.deleteMany({ where: { programKey } });
    await db.billingOrder.deleteMany({ where: { userId: { in: referees } } });
    if (itemId)
      await db.billingCatalogItem.deleteMany({ where: { id: itemId } });
    await db.referralCommissionRate.deleteMany({ where: { programKey } });
    await db.referralProgram.delete({ where: { key: programKey } });
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (originalInviteBase === undefined)
      delete process.env.REFERRAL_INVITE_BASE_URL;
    else process.env.REFERRAL_INVITE_BASE_URL = originalInviteBase;
  });
  const rewards = () =>
    db.referralReward.findMany({
      where: { programKey },
      include: { items: true },
    });
  it('respects a shared referrer cap across simultaneous invitees and retries', async () => {
    await Promise.all(referees.map((id) => service.qualifyRefereePurchase(id)));
    await Promise.all(referees.map((id) => service.qualifyRefereePurchase(id)));
    expect(await rewards()).toHaveLength(1);
    expect(
      await db.referralAttribution.count({
        where: { programKey, status: 'qualified' },
      }),
    ).toBe(2);
  });
  const duringWait = async (
    change: (tx: Prisma.TransactionClient) => Promise<unknown>,
    action: () => Promise<void> = () =>
      service.qualifyRefereePurchase(referees[0]),
    lock: (tx: Prisma.TransactionClient) => Promise<unknown> = (tx) =>
      tx.$queryRaw`SELECT id FROM referral_programs WHERE key=${programKey} FOR UPDATE`,
  ) => {
    let ready!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = db.$transaction(async (tx) => {
      await lock(tx);
      ready();
      await gate;
      await change(tx);
    });
    await entered;
    const pending = action();
    void pending.catch(() => undefined);
    try {
      let waiting = false;
      for (let i = 0; i < 500; i++) {
        const [row] = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
        if (Number(row.count)) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await holder;
    await pending;
  };
  it.each(['disabled', 'refunded', 'reward'] as const)(
    'uses current %s state after admission waits',
    async (kind) => {
      await duringWait(async (tx) => {
        if (kind === 'refunded')
          return tx.billingOrder.updateMany({
            where: { userId: referees[0] },
            data: { status: 'refunded' },
          });
        return tx.referralProgram.update({
          where: { key: programKey },
          data:
            kind === 'disabled'
              ? { enabled: false }
              : { rewardPerReferralMinor: 321n, holdDays: 3 },
        });
      });
      const rows = await rewards();
      if (kind === 'reward') {
        expect(rows).toHaveLength(1);
        expect(rows[0].amountMinor).toBe(321n);
        expect(rows[0].items[0].amountMinor).toBe(321n);
        const attribution = await db.referralAttribution.findUniqueOrThrow({
          where: { refereeUserId: referees[0] },
        });
        expect(
          rows[0].availableAt!.getTime() - attribution.qualifiedAt!.getTime(),
        ).toBe(3 * 86400000);
      } else {
        expect(rows).toHaveLength(0);
        expect(
          (
            await db.referralAttribution.findUniqueOrThrow({
              where: { refereeUserId: referees[0] },
            })
          ).status,
        ).toBe('pending');
      }
    },
  );
  const welcome = () =>
    (
      service as unknown as {
        accrueInviteePerkForReferee(id: string): Promise<void>;
      }
    ).accrueInviteePerkForReferee(referees[0]);
  it.each(['disabled', 'items'] as const)(
    'captures current welcome %s after a program wait',
    async (kind) => {
      const program = await db.referralProgram.findUniqueOrThrow({
        where: { key: programKey },
      });
      await db.referralInviteeBenefitItem.create({
        data: { programId: program.id, payoutType: 'cash', amountMinor: 100n },
      });
      await duringWait(async (tx) => {
        if (kind === 'disabled')
          return tx.referralProgram.update({
            where: { key: programKey },
            data: { enabled: false },
          });
        return tx.referralInviteeBenefitItem.updateMany({
          where: { programId: program.id },
          data: { amountMinor: 321n },
        });
      }, welcome);
      if (kind === 'disabled') {
        expect(await rewards()).toHaveLength(0);
        return;
      }
      await Promise.all([welcome(), welcome()]);
      const rows = await rewards();
      expect(rows).toHaveLength(1);
      expect(rows[0].amountMinor).toBe(321n);
      expect(rows[0].items).toHaveLength(1);
      expect(rows[0].items[0].amountMinor).toBe(321n);
    },
  );
  it('preserves a single milestone bundle on concurrent registration accrual and later configuration edits', async () => {
    const original = await db.referralProgram.findUnique({
      where: { key: 'default' },
    });
    const program = await db.referralProgram.upsert({
      where: { key: 'default' },
      create: { key: 'default', enabled: true },
      update: { enabled: true },
    });
    let milestoneId: string | undefined;
    try {
      const existing = await db.referralMilestoneConfig.findFirst({
        where: { programId: program.id },
        orderBy: { inviteeThreshold: 'desc' },
      });
      const threshold = (existing?.inviteeThreshold ?? 0) + 1;
      const milestone = await db.referralMilestoneConfig.create({
        data: {
          programId: program.id,
          inviteeThreshold: threshold,
          title: 'Owned fixture',
          detail: 'Owned fixture details',
          payoutType: 'cash',
          rewardMinor: 123n,
          items: { create: { payoutType: 'cash', amountMinor: 123n } },
        },
      });
      milestoneId = milestone.id;
      const accrue = () =>
        (
          service as unknown as {
            accrueMilestonesForReferrer(
              id: string,
              count: number,
            ): Promise<void>;
          }
        ).accrueMilestonesForReferrer(referrer, threshold);
      await Promise.all([accrue(), accrue()]);
      await db.referralMilestoneConfig.update({
        where: { id: milestone.id },
        data: {
          rewardMinor: 456n,
          items: { updateMany: { where: {}, data: { amountMinor: 456n } } },
        },
      });
      await accrue();
      const rows = await db.referralReward.findMany({
        where: { userId: referrer, milestoneId: milestone.id },
        include: { items: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].amountMinor).toBe(123n);
      expect(rows[0].items).toHaveLength(1);
      expect(rows[0].items[0].amountMinor).toBe(123n);
    } finally {
      await db.referralReward.deleteMany({
        where: { userId: referrer, programKey: 'default' },
      });
      if (milestoneId)
        await db.referralMilestoneConfig.delete({ where: { id: milestoneId } });
      if (original)
        await db.referralProgram.update({
          where: { key: 'default' },
          data: { enabled: original.enabled },
        });
      else await db.referralProgram.delete({ where: { key: 'default' } });
    }
  });
  it.each([
    'refunded',
    'amount',
    'disabled',
    'attribution',
    'override',
  ] as const)('rechecks commission %s after admission waits', async (kind) => {
    await db.referralAttribution.update({
      where: { refereeUserId: referees[0] },
      data: { status: 'qualified' },
    });
    await db.referralProgram.update({
      where: { key: programKey },
      data: { commissionBps: 1000 },
    });
    const order = await db.billingOrder.findFirstOrThrow({
      where: { userId: referees[0] },
    });
    await duringWait(
      async (tx) => {
        if (kind === 'refunded')
          return tx.billingOrder.update({
            where: { id: order.id },
            data: { status: 'refunded' },
          });
        if (kind === 'amount')
          return tx.billingOrder.update({
            where: { id: order.id },
            data: { amountMinor: 1000n, subtotalAmountMinor: 1000n },
          });
        if (kind === 'disabled')
          return tx.referralProgram.update({
            where: { key: programKey },
            data: { enabled: false },
          });
        if (kind === 'attribution')
          return tx.referralAttribution.update({
            where: { refereeUserId: referees[0] },
            data: { status: 'reversed' },
          });
        return tx.referralCommissionRate.create({
          data: { programKey, userId: referrer, commissionBps: 5000 },
        });
      },
      () => service.accrueForOrder(order.id),
    );
    if (kind === 'amount' || kind === 'override') {
      await service.accrueForOrder(order.id);
      const rows = await rewards();
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('commission');
      expect(rows[0].amountMinor).toBe(100n);
      expect(rows[0].items[0].amountMinor).toBe(100n);
      expect(rows[0].sourceAmountMinor).toBe(kind === 'amount' ? 1000n : 200n);
      expect(rows[0].commissionBps).toBe(kind === 'amount' ? 1000 : 5000);
    } else expect(await rewards()).toHaveLength(0);
  });
  const prepareRefund = async () => {
    const attribution = await db.referralAttribution.update({
      where: { refereeUserId: referees[0] },
      data: { status: 'qualified' },
    });
    const order = await db.billingOrder.findFirstOrThrow({
      where: { userId: referees[0] },
    });
    await db.billingOrder.update({
      where: { id: order.id },
      data: { status: 'refunded' },
    });
    const flat = await db.referralReward.create({
      data: {
        programKey,
        userId: referrer,
        kind: 'referral',
        status: 'accrued',
        payoutType: 'cash',
        amountMinor: 100n,
        title: 'Fixture',
        attributionId: attribution.id,
      },
    });
    const commission = await db.referralReward.create({
      data: {
        programKey,
        userId: referrer,
        kind: 'commission',
        status: 'accrued',
        payoutType: 'cash',
        amountMinor: 20n,
        title: 'Fixture',
        orderId: order.id,
      },
    });
    return { attribution, order, flat, commission };
  };
  it('retains qualification when a new backing purchase arrives during the attribution wait', async () => {
    const { attribution, order, flat, commission } = await prepareRefund();
    await duringWait(
      (tx) =>
        tx.billingOrder.updateMany({
          where: { userId: referees[1] },
          data: { userId: referees[0], subjectId: referees[0] },
        }),
      () => service.reverseForOrder(order.id),
      (tx) =>
        tx.$queryRaw`SELECT id FROM referral_attributions WHERE id=${attribution.id}::uuid FOR UPDATE`,
    );
    expect(
      (
        await db.referralAttribution.findUniqueOrThrow({
          where: { id: attribution.id },
        })
      ).status,
    ).toBe('qualified');
    expect(
      (await db.referralReward.findUniqueOrThrow({ where: { id: flat.id } }))
        .status,
    ).toBe('accrued');
    expect(
      (
        await db.referralReward.findUniqueOrThrow({
          where: { id: commission.id },
        })
      ).status,
    ).toBe('reversed');
  });
  it('does not reverse rewards after the source order is restored during its lock wait', async () => {
    const { order } = await prepareRefund();
    await duringWait(
      (tx) =>
        tx.billingOrder.update({
          where: { id: order.id },
          data: { status: 'paid' },
        }),
      () => service.reverseForOrder(order.id),
      (tx) =>
        tx.$queryRaw`SELECT id FROM billing_orders WHERE id=${order.id}::uuid FOR UPDATE`,
    );
    expect((await rewards()).every((r) => r.status === 'accrued')).toBe(true);
  });
  it('rolls commission and attribution back together if reward reversal fails', async () => {
    const { order, attribution } = await prepareRefund();
    const broken = db.$extends({
      query: {
        referralReward: {
          updateMany({ args, query }) {
            if (args.where?.attributionId)
              return Promise.reject(new Error('reversal unavailable'));
            return query(args);
          },
        },
      },
    });
    const failing = new ReferralsService(
      broken as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(failing.reverseForOrder(order.id)).rejects.toThrow(
      'reversal unavailable',
    );
    expect((await rewards()).every((r) => r.status === 'accrued')).toBe(true);
    expect(
      (
        await db.referralAttribution.findUniqueOrThrow({
          where: { id: attribution.id },
        })
      ).status,
    ).toBe('qualified');
  });
  it('keeps paid-out commissions while reversing still-accrued rewards once', async () => {
    const { order, flat, commission } = await prepareRefund();
    await db.referralReward.update({
      where: { id: commission.id },
      data: { status: 'paid_out' },
    });
    await service.reverseForOrder(order.id);
    await service.reverseForOrder(order.id);
    expect(
      (
        await db.referralReward.findUniqueOrThrow({
          where: { id: commission.id },
        })
      ).status,
    ).toBe('paid_out');
    expect(
      (await db.referralReward.findUniqueOrThrow({ where: { id: flat.id } }))
        .status,
    ).toBe('reversed');
  });
});
