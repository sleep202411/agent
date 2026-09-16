import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { InternalPointsService } from './internal-points.service';
import { WalletLedgerService } from '../workspaces';
import { walletWorkspaceChannel } from '../infra/realtime/realtime-groups';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
integration('Legacy migration recovery (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: InternalPointsService;
  let userId: string;
  let workspaceId: string;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      !['55439', '55440'].includes(url.port) ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await db.$connect();
    service = new InternalPointsService(
      db as never,
      new WalletLedgerService(db as never),
      {
        ensureDefaultWorkspace: () => Promise.resolve({ id: workspaceId }),
      } as never,
    );
  });
  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = (
      await db.workspace.create({
        data: {
          name: 'Migration fixture',
          ownerUserId: userId,
          createdById: userId,
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({ where: { userId } });
    await db.realtimeSequenceCursor.deleteMany({
      where: { channel: walletWorkspaceChannel(workspaceId) },
    });
    await db.walletTransaction.deleteMany({ where: { actorUserId: userId } });
    await db.walletAccount.deleteMany({ where: { ownerId: workspaceId } });
    await db.pointsMigration.deleteMany({ where: { userId } });
    await db.workspace.delete({ where: { id: workspaceId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('recovers the recorded amount once after a marker-only interruption', async () => {
    await db.pointsMigration.create({
      data: { userId, workspaceId, migratedBalance: 123 },
    });
    const first = await service.migrate({ userId, balance: 900 });
    const retry = await service.migrate({ userId, balance: 0 });
    expect(first).toMatchObject({ balance: '123', alreadyMigrated: false });
    expect(retry).toMatchObject({ balance: '123', alreadyMigrated: true });
    expect(
      await db.walletTransaction.count({ where: { actorUserId: userId } }),
    ).toBe(1);
  });
  it('keeps a zero migration at zero on a later positive retry', async () => {
    await db.pointsMigration.create({
      data: { userId, workspaceId, migratedBalance: 0 },
    });
    expect(await service.migrate({ userId, balance: 900 })).toMatchObject({
      balance: '0',
      alreadyMigrated: true,
    });
    expect(
      await db.walletTransaction.count({ where: { actorUserId: userId } }),
    ).toBe(0);
  });
  it('credits the winning marker exactly once for concurrent different inputs', async () => {
    const results = await Promise.all([
      service.migrate({ userId, balance: 50 }),
      service.migrate({ userId, balance: 900 }),
    ]);
    const marker = await db.pointsMigration.findUniqueOrThrow({
      where: { userId },
    });
    expect(results.map((result) => result.balance)).toEqual([
      String(marker.migratedBalance),
      String(marker.migratedBalance),
    ]);
    expect(
      await db.walletTransaction.count({ where: { actorUserId: userId } }),
    ).toBe(1);
  });
});
