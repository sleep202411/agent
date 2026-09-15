import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { WalletLedgerService } from '../workspaces';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';
import { ReferralsService } from './referrals.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { entitlementUserChannel } from '../infra/realtime/realtime-groups';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `campaign-claim-${randomUUID()}`;
jest.setTimeout(30000);
integration('Referral wallet recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: ReferralsService;
  let user: AuthUser;
  let rewardId: string;
  let itemId: string;
  let defaultWorkspaceId: string;
  const ensureDefaultWorkspace = jest.fn();
  const originalBase = process.env.REFERRAL_INVITE_BASE_URL;
  let workspaceId: string;
  let replacementId: string;
  beforeAll(async () => {
    process.env.REFERRAL_INVITE_BASE_URL = 'https://fixture.invalid';
    const url = new URL(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
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
  });

  const build = (client: unknown = db) =>
    new ReferralsService(
      client as PrismaService,
      {} as never,
      {} as never,
      new WalletLedgerService(client as PrismaService),
      { ensureDefaultWorkspace } as never,
      {} as never,
    );
  beforeEach(async () => {
    user = { userId: randomUUID() } as AuthUser;
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Referral fixture',
          ownerUserId: user.userId,
          createdById: user.userId,
        },
      })
    ).id;
    replacementId = (
      await db.workspace.create({
        data: {
          name: 'Replacement fixture',
          ownerUserId: user.userId,
          createdById: user.userId,
        },
      })
    ).id;
    defaultWorkspaceId = workspaceId;
    ensureDefaultWorkspace
      .mockReset()
      .mockImplementation(() => Promise.resolve({ id: defaultWorkspaceId }));
    rewardId = (
      await db.referralReward.create({
        data: {
          userId: user.userId,
          kind: 'referral',
          payoutType: 'points_compute',
          status: 'paid_out',
          paidOutAt: new Date(),
          amountMinor: 100n,
          title: 'Fixture',
          items: {
            create: { payoutType: 'points_compute', amountMinor: 100n },
          },
        },
      })
    ).id;
    itemId = (
      await db.referralRewardItem.findFirstOrThrow({ where: { rewardId } })
    ).id;
    service = build();
  });
  afterEach(async () => {
    await db.referralReward.delete({ where: { id: rewardId } });
    await db.aiEventOutbox.deleteMany({ where: { userId: user.userId } });
    await db.realtimeSequenceCursor.deleteMany({
      where: {
        channel: {
          in: [
            walletWorkspaceChannel(workspaceId),
            walletWorkspaceChannel(replacementId),
            entitlementUserChannel(user.userId),
          ],
        },
      },
    });
    await db.entitlementGrant.deleteMany({ where: { subjectId: user.userId } });
    await db.walletTransaction.deleteMany({
      where: { actorUserId: user.userId },
    });
    await db.walletAccount.deleteMany({
      where: { ownerId: { in: [workspaceId, replacementId, user.userId] } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceId, replacementId] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (originalBase === undefined) delete process.env.REFERRAL_INVITE_BASE_URL;
    else process.env.REFERRAL_INVITE_BASE_URL = originalBase;
  });
  const snapshot = async () => ({
    accounts: await db.walletAccount.findMany({
      where: { ownerId: { in: [workspaceId, replacementId, user.userId] } },
      orderBy: { id: 'asc' },
    }),
    transactions: await db.walletTransaction.findMany({
      where: { actorUserId: user.userId },
      include: { entries: true, creditGrants: true },
      orderBy: { id: 'asc' },
    }),
  });
  const unmark = () =>
    db.referralRewardItem.update({
      where: { id: itemId },
      data: { grantedAt: null },
    });
  it('recovers historical unmarked credit in its original destination after the default changes', async () => {
    await service.claimReward(user.userId, rewardId);
    await unmark();
    const before = await snapshot();
    defaultWorkspaceId = replacementId;
    await service.claimReward(user.userId, rewardId);
    expect(await snapshot()).toEqual(before);
    expect(ensureDefaultWorkspace).toHaveBeenCalledTimes(1);
    expect(
      (await db.referralRewardItem.findUniqueOrThrow({ where: { id: itemId } }))
        .grantedAt,
    ).not.toBeNull();
  });
  it('rolls back a new credit when its item marker fails', async () => {
    const failing = db.$extends({
      query: {
        referralRewardItem: {
          updateMany() {
            return Promise.reject(new Error('marker unavailable'));
          },
        },
      },
    });
    const before = await snapshot();
    await expect(
      build(failing).claimReward(user.userId, rewardId),
    ).rejects.toThrow('marker unavailable');
    expect(await snapshot()).toEqual(before);
    await service.claimReward(user.userId, rewardId);
    expect((await snapshot()).transactions).toHaveLength(1);
  });
  it('serializes simultaneous interrupted-claim recovery before choosing a workspace', async () => {
    await Promise.all([
      service.claimReward(user.userId, rewardId),
      service.claimReward(user.userId, rewardId),
    ]);
    const state = await snapshot();
    expect(state.transactions).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].availableBalance).toBe(100n);
    expect(ensureDefaultWorkspace).toHaveBeenCalledTimes(1);
  });
  it('retains completed credit and expiry when its original wallet is frozen', async () => {
    await service.claimReward(user.userId, rewardId);
    await unmark();
    await db.walletAccount.updateMany({
      where: { ownerId: workspaceId },
      data: { status: 'frozen' },
    });
    defaultWorkspaceId = replacementId;
    const before = await snapshot();
    await service.claimReward(user.userId, rewardId);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects changed reward amounts without marking an incompatible credit as granted', async () => {
    await service.claimReward(user.userId, rewardId);
    await db.referralRewardItem.update({
      where: { id: itemId },
      data: { grantedAt: null, amountMinor: 101n },
    });
    const before = await snapshot();
    await expect(
      service.claimReward(user.userId, rewardId),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
    expect(
      (await db.referralRewardItem.findUniqueOrThrow({ where: { id: itemId } }))
        .grantedAt,
    ).toBeNull();
  });
  it.each(['points_compute', 'points_community', 'cash'] as const)(
    'rolls back account creation on a failed %s journal',
    async (payoutType) => {
      await db.referralRewardItem.update({
        where: { id: itemId },
        data: { payoutType, currency: payoutType === 'cash' ? 'USD' : null },
      });
      const failing = db.$extends({
        query: {
          walletTransaction: {
            create() {
              return Promise.reject(new Error('journal unavailable'));
            },
          },
        },
      });
      const before = await snapshot();
      await expect(
        build(failing).claimReward(user.userId, rewardId),
      ).rejects.toThrow('journal unavailable');
      expect(await snapshot()).toEqual(before);
      await service.claimReward(user.userId, rewardId);
      expect((await snapshot()).transactions).toHaveLength(1);
    },
  );
  it('retries a unique marker race through recorded credit instead of assuming the bundle completed', async () => {
    let failures = 0;
    const client = db.$extends({
      query: {
        referralRewardItem: {
          updateMany({ args, query }) {
            if (failures++ === 0)
              return Promise.reject(
                new Prisma.PrismaClientKnownRequestError(
                  'fixture unique failure',
                  { code: 'P2002', clientVersion: 'fixture' },
                ),
              );
            return query(args);
          },
        },
      },
    });
    await build(client).claimReward(user.userId, rewardId);
    expect((await snapshot()).transactions).toHaveLength(1);
    expect(failures).toBe(2);
    expect(
      (await db.referralRewardItem.findUniqueOrThrow({ where: { id: itemId } }))
        .grantedAt,
    ).not.toBeNull();
  });
  it('propagates persistent unique failures without claiming the item was granted', async () => {
    const client = db.$extends({
      query: {
        walletTransaction: {
          create() {
            return Promise.reject(
              new Prisma.PrismaClientKnownRequestError(
                'fixture unique failure',
                { code: 'P2002', clientVersion: 'fixture' },
              ),
            );
          },
        },
      },
    });
    await expect(
      build(client).claimReward(user.userId, rewardId),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect((await snapshot()).transactions).toHaveLength(0);
    expect((await snapshot()).accounts).toHaveLength(0);
    expect(
      (await db.referralRewardItem.findUniqueOrThrow({ where: { id: itemId } }))
        .grantedAt,
    ).toBeNull();
  });
  const waitForLock = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count) > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected a blocked concurrent write');
  };
  const makeAccruedBundle = async () => {
    await db.referralReward.update({
      where: { id: rewardId },
      data: { status: 'accrued', paidOutAt: null },
    });
    await db.referralRewardItem.create({
      data: {
        rewardId,
        payoutType: 'cash',
        currency: 'USD',
        amountMinor: 70n,
        rank: 1,
      },
    });
  };
  const bundleSnapshot = async () => ({
    ...(await snapshot()),
    reward: await db.referralReward.findUnique({ where: { id: rewardId } }),
    items: await db.referralRewardItem.findMany({
      where: { rewardId },
      orderBy: { rank: 'asc' },
    }),
    events: await db.aiEventOutbox.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
    }),
  });
  it.each(['second marker', 'completion'])(
    'rolls back the entire multi-wallet bundle on failed %s',
    async (failure) => {
      await makeAccruedBundle();
      const before = await bundleSnapshot();
      let markers = 0;
      const failing = db.$extends({
        query: {
          referralRewardItem: {
            updateMany({ args, query }) {
              if (failure === 'second marker' && ++markers === 2)
                return Promise.reject(new Error('bundle failure'));
              return query(args);
            },
          },
          referralReward: {
            updateMany({ args, query }) {
              if (failure === 'completion')
                return Promise.reject(new Error('bundle failure'));
              return query(args);
            },
          },
        },
      });
      await expect(
        build(failing).claimReward(user.userId, rewardId),
      ).rejects.toThrow('bundle failure');
      expect(await bundleSnapshot()).toEqual(before);
      await service.claimReward(user.userId, rewardId);
      const after = await bundleSnapshot();
      expect(after.transactions).toHaveLength(2);
      expect(after.items.every((i) => i.grantedAt)).toBe(true);
      expect(after.reward?.status).toBe('paid_out');
    },
  );
  it('serializes a replacement claim behind a failed bundle without resetting its completion', async () => {
    await makeAccruedBundle();
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    let once = true;
    const delayed = db.$extends({
      query: {
        referralRewardItem: {
          async updateMany({ args, query }) {
            if (once) {
              once = false;
              entered();
              await gate;
              throw new Error('old claim failed');
            }
            return query(args);
          },
        },
      },
    });
    const first = build(delayed)
      .claimReward(user.userId, rewardId)
      .catch((e) => e as Error);
    await ready;
    const second = service.claimReward(user.userId, rewardId);
    try {
      await waitForLock();
    } finally {
      release();
    }
    expect(await first).toBeInstanceOf(Error);
    await expect(second).resolves.toEqual({ status: 'paid_out' });
    const after = await bundleSnapshot();
    expect(after.transactions).toHaveLength(2);
    expect(after.reward?.status).toBe('paid_out');
    expect(after.items.every((i) => i.grantedAt)).toBe(true);
  });
  it.each([true, false])(
    'coordinates refund reversal with an in-flight claim (claim succeeds: %s)',
    async (succeeds) => {
      await makeAccruedBundle();
      let entered!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((r) => (entered = r));
      const gate = new Promise<void>((r) => (release = r));
      let once = true;
      const delayed = db.$extends({
        query: {
          referralRewardItem: {
            async updateMany({ args, query }) {
              if (once) {
                once = false;
                entered();
                await gate;
                if (!succeeds) throw new Error('claim failed');
              }
              return query(args);
            },
          },
        },
      });
      const claim = build(delayed)
        .claimReward(user.userId, rewardId)
        .catch((e) => e as Error);
      await ready;
      // Same conditional write used by the refund hook; PostgreSQL must recheck
      // its predicate after the claim releases the reward row.
      const reversal = db.referralReward
        .updateMany({
          where: { id: rewardId, status: 'accrued' },
          data: { status: 'reversed' },
        })
        .then((result) => result);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await claim;
      const reversed = await reversal;
      expect(reversed.count).toBe(succeeds ? 0 : 1);
      const after = await bundleSnapshot();
      expect(after.transactions).toHaveLength(succeeds ? 2 : 0);
      expect(after.reward?.status).toBe(succeeds ? 'paid_out' : 'reversed');
    },
  );
  it('uses fresh hold time after waiting for the reward lock', async () => {
    await makeAccruedBundle();
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM referral_rewards WHERE id=${rewardId}::uuid FOR UPDATE`;
      await tx.referralReward.update({
        where: { id: rewardId },
        data: { availableAt: new Date(Date.now() + 60000) },
      });
      entered();
      await gate;
    });
    await ready;
    const claim = service.claimReward(user.userId, rewardId);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await expect(claim).rejects.toThrow('hold window');
    expect((await snapshot()).transactions).toHaveLength(0);
  });
  it('rolls back membership and wallet grants together when a later marker fails', async () => {
    const planKey = `fixture_${randomUUID().replaceAll('-', '')}`;
    await db.billingMembershipPlan.create({
      data: {
        planKey,
        productType: 'membership_plan',
        subjectType: 'user',
        status: 'active',
        name: 'Fixture',
        rank: 10,
        benefits: {},
      },
    });
    try {
      await makeAccruedBundle();
      await db.referralRewardItem.create({
        data: { rewardId, payoutType: 'membership_compute', days: 7, rank: 2 },
      });
      const third = await db.referralRewardItem.findFirstOrThrow({
        where: { rewardId, rank: 2 },
      });
      const failing = db.$extends({
        query: {
          referralRewardItem: {
            updateMany({ args, query }) {
              if (args.where?.id === third.id)
                return Promise.reject(new Error('membership marker failure'));
              return query(args);
            },
          },
        },
      });
      const buildMixed = (client: unknown) =>
        new ReferralsService(
          client as PrismaService,
          {} as never,
          {
            // Isolate the catalog key while exercising the real entitlement writer
            // and the caller's transaction; no shared membership plan is changed.
            grantComplimentary: (
              input: Parameters<EntitlementService['grantComplimentary']>[0],
              tx?: Prisma.TransactionClient,
            ) =>
              new EntitlementService(
                client as PrismaService,
              ).grantComplimentary({ ...input, planKey }, tx),
          } as never,
          new WalletLedgerService(client as PrismaService),
          { ensureDefaultWorkspace } as never,
          {} as never,
        );
      const before = await bundleSnapshot();
      await expect(
        buildMixed(failing).claimReward(user.userId, rewardId),
      ).rejects.toThrow('membership marker failure');
      expect(await bundleSnapshot()).toEqual(before);
      expect(
        await db.entitlementGrant.count({ where: { subjectId: user.userId } }),
      ).toBe(0);
      await buildMixed(db).claimReward(user.userId, rewardId);
      expect(
        await db.entitlementGrant.count({ where: { subjectId: user.userId } }),
      ).toBe(1);
      expect((await snapshot()).transactions).toHaveLength(2);
    } finally {
      await db.entitlementGrant.deleteMany({
        where: { subjectId: user.userId },
      });
      await db.billingMembershipPlan.delete({ where: { planKey } });
    }
  });
});
