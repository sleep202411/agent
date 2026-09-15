import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { AdminMediaService } from './admin-media.service';
import { MediaProcessingService } from './media-processing.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `media-retry-${randomUUID()}`;
jest.setTimeout(30000);
integration('Media operator retries (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let assetId: string;
  let actionId: string;
  let jobId: string;
  const service = (client: unknown = db) =>
    new AdminMediaService(
      client as PrismaService,
      new MediaProcessingService(client as PrismaService),
      {} as never,
    );
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
  });
  beforeEach(async () => {
    assetId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 'external_url',
          externalUrl: 'https://fixture.invalid/asset.png',
        },
      })
    ).id;
    actionId = (
      await db.mediaModerationAction.create({
        data: {
          assetId,
          actionType: 'purge_cdn',
          status: 'failed',
          attempt: 8,
          deadAt: new Date(),
          errorMessage: 'Fixture failure',
        },
      })
    ).id;
    jobId = (
      await db.mediaProcessingJob.create({
        data: {
          assetId,
          jobType: 'thumbnail',
          status: 'dead',
          attempt: 8,
          deadAt: new Date(),
          errorMessage: 'Fixture failure',
          output: { providerTask: 'old' },
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.mediaAsset.delete({ where: { id: assetId } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const write = (kind: string, client: unknown = db) =>
    kind === 'purge'
      ? service(client).retryModerationAction(actionId)
      : service(client).retryProcessingJob(jobId);
  const snapshot = async () => ({
    action: await db.mediaModerationAction.findUnique({
      where: { id: actionId },
    }),
    job: await db.mediaProcessingJob.findUnique({ where: { id: jobId } }),
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
    throw new Error('Expected retry wait');
  };
  it.each(['purge', 'processing'])(
    'preserves a current worker claim for %s',
    async (kind) => {
      if (kind === 'purge')
        await db.mediaModerationAction.update({
          where: { id: actionId },
          data: { lockedAt: new Date(), lockedBy: 'fixture-worker' },
        });
      else
        await db.mediaProcessingJob.update({
          where: { id: jobId },
          data: { lockedAt: new Date(), lockedBy: 'fixture-worker' },
        });
      const before = await snapshot();
      await expect(write(kind)).rejects.toMatchObject({ status: 409 });
      expect(await snapshot()).toEqual(before);
    },
  );
  it.each(['purge', 'processing'])(
    'does not reset %s completion committed during the wait',
    async (kind) => {
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const acquired = new Promise<void>((r) => {
        ready = r;
      });
      const holder = db.$transaction(async (tx) => {
        if (kind === 'purge')
          await tx.$queryRaw`SELECT id FROM media_moderation_actions WHERE id=${actionId}::uuid FOR UPDATE`;
        else
          await tx.$queryRaw`SELECT id FROM media_processing_jobs WHERE id=${jobId}::uuid FOR UPDATE`;
        ready();
        await gate;
        if (kind === 'purge')
          await tx.mediaModerationAction.update({
            where: { id: actionId },
            data: { status: 'completed', deadAt: null },
          });
        else
          await tx.mediaProcessingJob.update({
            where: { id: jobId },
            data: { status: 'completed', deadAt: null },
          });
      });
      await acquired;
      const pending = write(kind);
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({ status: 409 });
      const current = await snapshot();
      expect(
        kind === 'purge' ? current.action?.status : current.job?.status,
      ).toBe('completed');
    },
  );
  it.each(['purge', 'processing'])(
    'admits one of two concurrent %s retries and resets its budget',
    async (kind) => {
      const outcomes = await Promise.allSettled([write(kind), write(kind)]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
      const current = await snapshot();
      expect(kind === 'purge' ? current.action : current.job).toMatchObject({
        status: 'pending',
        attempt: 0,
        lockedAt: null,
        deadAt: null,
      });
      if (kind === 'processing') expect(current.job?.output).toEqual({});
    },
  );
  it('allows expired claims to recover under the existing worker lease durations', async () => {
    const old = new Date(Date.now() - 11 * 60_000);
    await db.mediaModerationAction.update({
      where: { id: actionId },
      data: { lockedAt: old, lockedBy: 'expired' },
    });
    await db.mediaProcessingJob.update({
      where: { id: jobId },
      data: { lockedAt: old, lockedBy: 'expired' },
    });
    await write('purge');
    await write('processing');
    expect((await snapshot()).job?.status).toBe('pending');
    expect((await snapshot()).action?.status).toBe('pending');
  });
});
