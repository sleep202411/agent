import { randomUUID } from 'node:crypto';
import { PrismaClient, type CheckInConfig } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { WalletLedgerService } from '../workspaces';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';
import { CheckInService } from './check-in.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `check-in-${randomUUID()}`;
jest.setTimeout(30000);
integration('Daily check-in recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: CheckInService;
  let user: AuthUser;
  let originalConfig: CheckInConfig | null;
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
    service = new CheckInService(
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
    originalConfig = await db.checkInConfig.findUnique({
      where: { key: 'default' },
    });
    await db.checkInConfig.upsert({
      where: { key: 'default' },
      create: { key: 'default', enabled: true, rewards: [100, 200] },
      update: { enabled: true, rewards: [100, 200] },
    });
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
    await db.dailyCheckIn.deleteMany({ where: { userId: user.userId } });
    if (originalConfig) {
      await db.checkInConfig.update({
        where: { key: 'default' },
        data: {
          enabled: originalConfig.enabled,
          rewards: originalConfig.rewards,
        },
      });
    } else {
      await db.checkInConfig.delete({ where: { key: 'default' } });
    }
    await db.workspace.deleteMany({
      where: { id: { in: [workspaceId, replacementId] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('recovers captured rewards with check-in disabled and no current default', async () => {
    const [clock] = await db.$queryRaw<
      { today: Date }[]
    >`SELECT date_trunc('day', clock_timestamp()) AS today`;
    await db.dailyCheckIn.create({
      data: {
        userId: user.userId,
        workspaceId,
        amount: 123,
        streakDay: 4,
        checkInDate: clock.today,
      },
    });
    await db.workspace.update({
      where: { id: workspaceId },
      data: { defaultForUserId: null },
    });
    await db.checkInConfig.update({
      where: { key: 'default' },
      data: { enabled: false },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(service.checkIn(user)).resolves.toMatchObject({
        alreadyCheckedIn: true,
        streakDay: 4,
        granted: { workspaceId, amount: '123' },
      });
    }
    expect(
      await db.walletTransaction.count({ where: { actorUserId: user.userId } }),
    ).toBe(1);
  });
  it('serializes simultaneous check-ins without duplicate rewards', async () => {
    await Promise.all([service.checkIn(user), service.checkIn(user)]);
    expect(
      await db.dailyCheckIn.count({ where: { userId: user.userId } }),
    ).toBe(1);
    expect(
      await db.walletTransaction.count({ where: { actorUserId: user.userId } }),
    ).toBe(1);
  });
  it.each(['disabled', 'rewards'])(
    'rereads %s after waiting for configuration changes',
    async (kind) => {
      let ready!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM check_in_configs WHERE key='default' FOR UPDATE`;
        ready();
        await gate;
        await tx.checkInConfig.update({
          where: { key: 'default' },
          data: kind === 'disabled' ? { enabled: false } : { rewards: [321] },
        });
      });
      await entered;
      const pending = service.checkIn(user);
      void pending.catch(() => undefined);
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
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
      if (kind === 'disabled') {
        await expect(pending).rejects.toMatchObject({ status: 403 });
        expect(
          await db.dailyCheckIn.count({ where: { userId: user.userId } }),
        ).toBe(0);
      } else {
        await expect(pending).resolves.toMatchObject({
          granted: { amount: '321' },
        });
      }
    },
  );
});
