import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { AdminMediaService } from './admin-media.service';
import { MediaProcessingService } from './media-processing.service';
import { CreateAdminMediaProcessingJobSchema } from './admin-media.dto';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `media-enqueue-${randomUUID()}`;
jest.setTimeout(30000);
integration('Media enqueue and explicit restart (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let assetId: string;
  let otherId: string;
  let variantId: string;
  const processing = (client: unknown = db) =>
    new MediaProcessingService(client as PrismaService);
  const admin = (client: unknown = db) =>
    new AdminMediaService(
      client as PrismaService,
      processing(client),
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
    otherId = (
      await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 'external_url',
          externalUrl: 'https://fixture.invalid/other.png',
        },
      })
    ).id;
    variantId = (
      await db.mediaAssetVariant.create({
        data: { assetId: otherId, kind: 'original', variantKey: 'original' },
      })
    ).id;
  });
  afterEach(async () => {
    await db.mediaAsset.deleteMany({
      where: { id: { in: [assetId, otherId] } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const input = () => ({
    assetId,
    jobType: 'backfill_original_placement' as const,
    idempotencyKey: `media-backfill-original-placement:${assetId}`,
  });
  const restart = (client: unknown = db) =>
    admin(client).createProcessingJob(
      assetId,
      randomUUID(),
      CreateAdminMediaProcessingJobSchema.parse({
        jobType: 'backfill_original_placement',
      }),
    );
  it('creates one canonical job for concurrent upload replays', async () => {
    const jobs = await Promise.all([
      processing().enqueueJob(input()),
      processing().enqueueJob(input()),
    ]);
    expect(jobs[0].id).toBe(jobs[1].id);
    expect(await db.mediaProcessingJob.count({ where: { assetId } })).toBe(1);
  });
  it.each(['completed', 'processing'] as const)(
    'preserves %s work on upload replay',
    async (status) => {
      const job = await processing().enqueueJob(input());
      const before = await db.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status,
          attempt: 3,
          output: { providerTask: 'keep' },
          lockedAt: new Date(),
          lockedBy: 'worker',
        },
      });
      expect(await processing().enqueueJob(input())).toEqual(before);
      expect(
        await db.mediaProcessingJob.findUnique({ where: { id: job.id } }),
      ).toEqual(before);
    },
  );
  it.each(['asset', 'type', 'variant'])(
    'rejects reuse of a key with a different %s',
    async (kind) => {
      const before = await processing().enqueueJob(input());
      const other = {
        ...input(),
        ...(kind === 'asset'
          ? { assetId: otherId }
          : kind === 'type'
            ? { jobType: 'poster' as const }
            : {
                sourceVariantId: (
                  await db.mediaAssetVariant.create({
                    data: { assetId, kind: 'original', variantKey: 'original' },
                  })
                ).id,
              }),
      };
      await expect(processing().enqueueJob(other)).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await db.mediaProcessingJob.findUnique({ where: { id: before.id } }),
      ).toEqual(before);
    },
  );
  it('rejects a variant belonging to another asset without enqueuing work', async () => {
    await expect(
      processing().enqueueJob({ ...input(), sourceVariantId: variantId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.mediaProcessingJob.count({ where: { assetId } })).toBe(0);
  });
  it('rejects an explicit restart of active processing', async () => {
    const job = await processing().enqueueJob(input());
    const before = await db.mediaProcessingJob.update({
      where: { id: job.id },
      data: { status: 'processing', output: { retained: true } },
    });
    await expect(restart()).rejects.toMatchObject({ status: 409 });
    expect(
      await db.mediaProcessingJob.findUnique({ where: { id: job.id } }),
    ).toEqual(before);
  });
  it('allows an explicit authorized restart of completed work', async () => {
    const job = await processing().enqueueJob(input());
    await db.mediaProcessingJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        attempt: 8,
        output: { old: true },
        completedAt: new Date(),
      },
    });
    await restart();
    expect(
      await db.mediaProcessingJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'pending',
      attempt: 0,
      output: {},
      completedAt: null,
      createdByAdminId: null,
    });
  });
  it('keeps the direct backfill utility as an explicit restart', async () => {
    const job = await processing().enqueueOriginalPlacementBackfill(assetId);
    await db.mediaProcessingJob.update({
      where: { id: job.id },
      data: { status: 'completed', attempt: 4, output: { old: true } },
    });
    const restarted =
      await processing().enqueueOriginalPlacementBackfill(assetId);
    expect(restarted).toMatchObject({
      id: job.id,
      status: 'pending',
      attempt: 0,
      output: {},
    });
    expect(await db.mediaProcessingJob.count({ where: { assetId } })).toBe(1);
  });
  it('rejects an asset deleted while enqueueing waits for its row', async () => {
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
    const pending = processing().enqueueJob(input());
    void pending.catch(() => undefined);
    try {
      const deadline = Date.now() + 5000;
      while (true) {
        const [row] = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
        if (Number(row.count)) break;
        if (Date.now() > deadline) throw new Error('Expected enqueue wait');
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally {
      release();
    }
    await holder;
    await expect(pending).rejects.toMatchObject({ status: 404 });
    expect(await db.mediaProcessingJob.count({ where: { assetId } })).toBe(0);
  });
});
