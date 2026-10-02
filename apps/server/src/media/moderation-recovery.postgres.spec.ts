import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { MediaModerationAdminService } from './media-moderation-admin.service';
import { MediaProcessingService } from './media-processing.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `media-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Media moderation administrator writes (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let adminId: string;
  let assetId: string;
  let recipient: string;
  const service = (client: unknown = db) =>
    new MediaModerationAdminService(
      client as PrismaService,
      new MediaProcessingService(client as PrismaService),
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
    recipient = randomUUID();
    assetId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          moderationStatus: 'approved',
          storageProvider: 'azure_blob',
          bucket: 'fixture-only',
          objectKey: randomUUID(),
          createdByUserId: recipient,
        },
      })
    ).id;
    await db.mediaModerationAction.create({
      data: { assetId, actionType: 'purge_cdn', status: 'pending' },
    });
  });
  afterEach(async () => {
    await db.aiEventOutbox.deleteMany({ where: { userId: recipient } });
    await db.mediaAsset.delete({ where: { id: assetId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const write = (client: unknown = db) =>
    service(client).updateAssetModeration(assetId, adminId, {
      moderationStatus: 'blocked',
      reason: 'Fixture',
    });
  const snapshot = async () => ({
    asset: await db.mediaAsset.findUnique({
      where: { id: assetId },
      include: {
        moderationCases: true,
        moderationActions: { orderBy: { id: 'asc' } },
      },
    }),
    outbox: await db.aiEventOutbox.findMany({ where: { userId: recipient } }),
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
    throw new Error('Expected moderation write wait');
  };
  it('uses the previous status committed during an asset wait in cases and events', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: { moderationStatus: 'flagged' },
      });
    });
    await acquired;
    const pending = write();
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    const current = await snapshot();
    expect(current.asset?.moderationCases[0].metadata).toMatchObject({
      previousStatus: 'flagged',
      nextStatus: 'blocked',
    });
    expect(current.asset?.status).toBe('ready');
    expect(current.outbox).toHaveLength(1);
    expect(
      current.asset?.moderationActions.some(
        (a) => a.actionType === 'restrict_visibility' && a.status === 'pending',
      ),
    ).toBe(true);
  });
  it('does not moderate an asset deleted while waiting', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_assets WHERE id=${assetId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: { deletedAt: new Date() },
      });
    });
    await acquired;
    const pending = write();
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await expect(pending).rejects.toMatchObject({ status: 404 });
    expect(await db.aiEventOutbox.count({ where: { userId: recipient } })).toBe(
      0,
    );
  });
});
