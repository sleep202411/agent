import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { BillingService } from './billing.service';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `wallet-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Workspace wallet administrator writes (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let adminId: string;
  let workspaceId: string;
  const service = (client: unknown = db) =>
    new BillingService(
      client as PrismaService,
      {} as never,
      {} as never,
      new WalletLedgerService(client as PrismaService),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
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
  beforeEach(async () => {
    adminId = randomUUID();
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Wallet fixture',
          ownerUserId: adminId,
          createdById: adminId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({ where: { userId: adminId } });
    await db.realtimeSequenceCursor.deleteMany({
      where: { channel: walletWorkspaceChannel(workspaceId) },
    });
    await db.walletTransaction.deleteMany({ where: { workspaceId } });
    await db.walletAccount.deleteMany({
      where: { ownerType: 'workspace', ownerId: workspaceId },
    });
    await db.workspace.delete({ where: { id: workspaceId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const input = (amount = 1000n, key = randomUUID()) => ({
    workspaceId,
    amount,
    grantType: 'admin_adjustment' as const,
    reason: 'Fixture',
    idempotencyKey: key,
    metadata: {},
  });
  const snapshot = async () => ({
    accounts: await db.walletAccount.findMany({
      where: { ownerType: 'workspace', ownerId: workspaceId },
    }),
    transactions: await db.walletTransaction.findMany({
      where: { workspaceId },
      orderBy: { id: 'asc' },
    }),
    entries: await db.walletLedgerEntry.findMany({
      where: { account: { ownerType: 'workspace', ownerId: workspaceId } },
      orderBy: { id: 'asc' },
    }),
    grants: await db.walletCreditGrant.findMany({
      where: { account: { ownerType: 'workspace', ownerId: workspaceId } },
      orderBy: { id: 'asc' },
    }),
    events: await db.aiEventOutbox.findMany({
      where: { userId: adminId },
      orderBy: { id: 'asc' },
    }),
  });
  it('credits and debits exact large amounts with atomic journals, grants, events', async () => {
    const amount = 9007199254740993n;
    await service().createAdminWorkspaceWalletCredit(adminId, input(amount));
    await service().createAdminWorkspaceWalletCredit(adminId, input(-3n));
    const after = await snapshot();
    expect(after.accounts[0].availableBalance).toBe(amount - 3n);
    expect(after.transactions).toHaveLength(2);
    expect(after.events).toHaveLength(2);
    expect(after.grants[0].availableAmount).toBe(amount - 3n);
  });
  it('retains the direct adjustment API and rejects changed replay amounts', async () => {
    await service().createAdminWorkspaceWalletCredit(adminId, input());
    const accountId = (await snapshot()).accounts[0].id;
    const request = input(25n);
    await service().createAdminWalletAdjustment(adminId, accountId, request);
    await service().createAdminWalletAdjustment(adminId, accountId, request);
    await expect(
      service().createAdminWalletAdjustment(adminId, accountId, {
        ...request,
        amount: 26n,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const after = await snapshot();
    expect(after.accounts[0].availableBalance).toBe(1025n);
    expect(after.transactions).toHaveLength(2);
  });
  it('deduplicates simultaneous credits to a previously absent wallet', async () => {
    const request = input();
    await Promise.all([
      service().createAdminWorkspaceWalletCredit(adminId, request),
      service().createAdminWorkspaceWalletCredit(adminId, request),
    ]);
    const after = await snapshot();
    expect(after.accounts).toHaveLength(1);
    expect(after.accounts[0].availableBalance).toBe(1000n);
    expect(after.transactions).toHaveLength(1);
    expect(after.events).toHaveLength(1);
  });
  it.each([false, true])(
    'rolls back all changes on journal failure (existing wallet: %s)',
    async (existing) => {
      if (existing)
        await service().createAdminWorkspaceWalletCredit(adminId, input());
      const before = await snapshot();
      const failing = extendPrismaQueries(db, {
        query: {
          walletLedgerEntry: {
            create({ args, query }) {
              if (args.data.entryType === 'adjustment')
                return Promise.reject(new Error('journal failure'));
              return query(args);
            },
          },
        },
      });
      await expect(
        service(failing).createAdminWorkspaceWalletCredit(adminId, input()),
      ).rejects.toThrow('journal failure');
      expect(await snapshot()).toEqual(before);
    },
  );
  it('rolls back expiry sweeps when the adjustment journal fails', async () => {
    await service().createAdminWorkspaceWalletCredit(adminId, input());
    await db.walletCreditGrant.updateMany({
      where: { account: { ownerType: 'workspace', ownerId: workspaceId } },
      data: {
        validFrom: new Date(Date.now() - 2000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const before = await snapshot();
    const failing = extendPrismaQueries(db, {
      query: {
        walletLedgerEntry: {
          create({ args, query }) {
            if (args.data.entryType === 'adjustment')
              return Promise.reject(new Error('journal failure'));
            return query(args);
          },
        },
      },
    });
    await expect(
      service(failing).createAdminWorkspaceWalletCredit(adminId, input()),
    ).rejects.toThrow('journal failure');
    expect(await snapshot()).toEqual(before);
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
    throw new Error('Expected wallet write wait');
  };
  it.each(['workspace', 'wallet'])(
    'rejects withdrawn eligibility during %s wait',
    async (kind) => {
      if (kind === 'wallet')
        await service().createAdminWorkspaceWalletCredit(adminId, input());
      const before = await snapshot();
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const holder = db.$transaction(async (tx) => {
        if (kind === 'workspace')
          await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${workspaceId}::uuid FOR UPDATE`;
        if (kind === 'wallet')
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${before.accounts[0].id}`})::bigint)`;
        ready();
        await gate;
        if (kind === 'workspace')
          await tx.workspace.update({
            where: { id: workspaceId },
            data: { status: 'suspended', suspendedAt: new Date() },
          });
        if (kind === 'wallet')
          await tx.walletAccount.update({
            where: { id: before.accounts[0].id },
            data: { status: 'frozen' },
          });
      });
      await entered;
      const pending = service().createAdminWorkspaceWalletCredit(
        adminId,
        input(),
      );
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({
        status: 409,
      });
      if (kind === 'wallet')
        before.accounts[0] = (await snapshot()).accounts[0];
      expect(await snapshot()).toEqual(before);
    },
  );
});
