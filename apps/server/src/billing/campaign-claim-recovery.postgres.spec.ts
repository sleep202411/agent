import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { WalletLedgerService } from '../workspaces';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';
import { CampaignService } from './campaign.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `campaign-claim-${randomUUID()}`;
jest.setTimeout(30000);
integration('Campaign claim recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: CampaignService;
  let user: AuthUser;
  let campaignId: string;
  let workspaceId: string;
  let replacementId: string;
  beforeAll(async () => {
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
    service = new CampaignService(
      db as unknown as PrismaService,
      new WalletLedgerService(db as unknown as PrismaService),
    );
  });
  beforeEach(async () => {
    user = { userId: randomUUID() } as AuthUser;
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Original',
          ownerUserId: user.userId,
          createdById: user.userId,
          defaultForUserId: user.userId,
        },
      })
    ).id;
    replacementId = (
      await db.workspace.create({
        data: {
          name: 'Replacement',
          ownerUserId: user.userId,
          createdById: user.userId,
        },
      })
    ).id;
    campaignId = (
      await db.creditCampaign.create({
        data: {
          name: 'Fixture campaign',
          createdById: user.userId,
          status: 'active',
          computeCreditAmount: 100,
          maxClaims: 10,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({ where: { userId: user.userId } });
    await db.realtimeSequenceCursor.deleteMany({
      where: {
        channel: {
          in: [
            walletWorkspaceChannel(workspaceId),
            walletWorkspaceChannel(replacementId),
          ],
        },
      },
    });
    await db.walletTransaction.deleteMany({
      where: { actorUserId: user.userId },
    });
    await db.walletAccount.deleteMany({
      where: { ownerId: { in: [workspaceId, replacementId] } },
    });
    await db.creditCampaign.delete({ where: { id: campaignId } });
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceId, replacementId] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('recovers the accepted amount and workspace after defaults change', async () => {
    await db.creditCampaignClaim.create({
      data: { campaignId, userId: user.userId, workspaceId, amount: 123 },
    });
    await db.workspace.update({
      where: { id: workspaceId },
      data: { defaultForUserId: null },
    });
    await db.workspace.update({
      where: { id: replacementId },
      data: { defaultForUserId: user.userId },
    });
    await db.creditCampaign.update({
      where: { id: campaignId },
      data: { computeCreditAmount: 456, claimCount: 1 },
    });
    const result = await service.claimCampaign(user, campaignId);
    expect(result.granted).toMatchObject({ amount: '123', workspaceId });
    expect(
      await db.walletAccount.findMany({ where: { ownerId: replacementId } }),
    ).toHaveLength(0);
  });
  it('retains the first promotional expiry when an accepted claim is retried', async () => {
    await service.claimCampaign(user, campaignId);
    const before = await db.walletCreditGrant.findFirstOrThrow({
      where: { account: { ownerId: workspaceId } },
    });
    await new Promise((r) => setTimeout(r, 10));
    const replay = await service.claimCampaign(user, campaignId);
    expect(replay.alreadyClaimed).toBe(true);
    expect(
      await db.walletCreditGrant.findMany({
        where: { account: { ownerId: workspaceId } },
      }),
    ).toEqual([before]);
  });
  it('deduplicates simultaneous claim recovery without spending the budget twice', async () => {
    await Promise.all([
      service.claimCampaign(user, campaignId),
      service.claimCampaign(user, campaignId),
    ]);
    expect(
      (await db.creditCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
        .claimCount,
    ).toBe(1);
    expect(
      await db.walletTransaction.count({ where: { actorUserId: user.userId } }),
    ).toBe(1);
  });
  const waitForLock = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected campaign claim lock wait');
  };
  it.each(['paused', 'expired'])(
    'recovers and replays accepted claims after the campaign is %s',
    async (kind) => {
      await db.creditCampaignClaim.create({
        data: { campaignId, userId: user.userId, workspaceId, amount: 123 },
      });
      await db.creditCampaign.update({
        where: { id: campaignId },
        data: {
          claimCount: 1,
          computeCreditAmount: 456,
          ...(kind === 'paused'
            ? { status: 'paused' }
            : { endsAt: new Date(Date.now() - 1000) }),
        },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          service.claimCampaign(user, campaignId),
        ).resolves.toMatchObject({
          alreadyClaimed: true,
          granted: { amount: '123', workspaceId },
        });
      }
      expect(
        await db.walletTransaction.count({
          where: { actorUserId: user.userId },
        }),
      ).toBe(1);
      expect(
        (
          await db.creditCampaign.findUniqueOrThrow({
            where: { id: campaignId },
          })
        ).claimCount,
      ).toBe(1);
    },
  );
  it('recovers a concurrent accepted claim after its lock holder pauses the campaign', async () => {
    let ready!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((r) => {
      ready = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM credit_campaigns WHERE id=${campaignId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.creditCampaignClaim.create({
        data: {
          campaignId,
          userId: user.userId,
          workspaceId: replacementId,
          amount: 321,
        },
      });
      await tx.creditCampaign.update({
        where: { id: campaignId },
        data: { status: 'paused', claimCount: 1 },
      });
    });
    await entered;
    const pending = service.claimCampaign(user, campaignId);
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await expect(pending).resolves.toMatchObject({
      alreadyClaimed: true,
      granted: { amount: '321', workspaceId: replacementId },
    });
    expect(
      await db.walletTransaction.count({ where: { actorUserId: user.userId } }),
    ).toBe(1);
    expect(
      (await db.creditCampaign.findUniqueOrThrow({ where: { id: campaignId } }))
        .claimCount,
    ).toBe(1);
  });
  it.each(['paused', 'expired', 'amount'])(
    'uses current %s eligibility or terms after the campaign lock wait',
    async (kind) => {
      if (kind === 'expired')
        await db.creditCampaign.update({
          where: { id: campaignId },
          data: { endsAt: new Date(Date.now() + 1500) },
        });
      let ready!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM credit_campaigns WHERE id=${campaignId}::uuid FOR UPDATE`;
        ready();
        await gate;
        if (kind === 'paused')
          await tx.creditCampaign.update({
            where: { id: campaignId },
            data: { status: 'paused' },
          });
        if (kind === 'expired') await tx.$queryRaw`SELECT pg_sleep(1.6)::text`;
        if (kind === 'amount')
          await tx.creditCampaign.update({
            where: { id: campaignId },
            data: { computeCreditAmount: 321 },
          });
      });
      await entered;
      const pending = service.claimCampaign(user, campaignId);
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      if (kind === 'amount') {
        await expect(pending).resolves.toMatchObject({
          granted: { amount: '321' },
        });
        expect(
          (
            await db.creditCampaignClaim.findFirstOrThrow({
              where: { campaignId },
            })
          ).amount,
        ).toBe(321);
      } else {
        await expect(pending).rejects.toMatchObject({ status: 410 });
        expect(
          await db.creditCampaignClaim.count({ where: { campaignId } }),
        ).toBe(0);
        expect(
          (
            await db.creditCampaign.findUniqueOrThrow({
              where: { id: campaignId },
            })
          ).claimCount,
        ).toBe(0);
      }
    },
  );
});
