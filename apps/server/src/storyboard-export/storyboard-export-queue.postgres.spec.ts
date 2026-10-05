import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { buildPrisma } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { StoryboardExportQueueService } from './storyboard-export-queue.service';
import { StoryboardExportJobsService } from './storyboard-export-jobs.service';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
const url = process.env.STORYBOARD_EXPORT_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'export worker leases (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let queue: StoryboardExportQueueService;
    let jobs: StoryboardExportJobsService;
    let workspaceId: string;
    let documentId: string;
    let assetId: string;
    const actor = `queue-${randomUUID()}`;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Dedicated audit database required');
      db = buildPrisma(url);
      queue = new StoryboardExportQueueService(db as never);
      jobs = new StoryboardExportJobsService(
        db as never,
        {} as never,
        {} as never,
      );
      const workspace = await db.workspace.create({
        data: { name: 'Queue fixture', ownerUserId: actor, createdById: actor },
      });
      workspaceId = workspace.id;
      const project = await db.platformProject.create({
        data: { workspaceId, name: 'Queue fixture', createdById: actor },
      });
      const doc = await db.studioDocument.create({
        data: {
          workspaceId,
          platformProjectId: project.id,
          type: 'canvas',
          title: 'Fixture',
          slug: randomUUID(),
          createdById: actor,
        },
      });
      documentId = doc.id;
      const asset = await db.mediaAsset.create({
        data: {
          workspaceId,
          kind: 'video',
          storageProvider: 's3_compatible',
          bucket: 'fixture',
          objectKey: 'fixture.mp4',
          status: 'ready',
          createdByUserId: actor,
        },
      });
      assetId = asset.id;
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM storyboard_export_outputs WHERE job_id IN (SELECT id FROM storyboard_export_jobs WHERE user_id=${actor})`;
      await db.storyboardExportJob.deleteMany({ where: { userId: actor } });
    });
    it('keeps active outputs, retires expired ones and retains failed deletion for retry', async () => {
      const job = await seed();
      const key = `fixture/${randomUUID()}.mp4`;
      const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
      const registry = { forProvider: jest.fn().mockReturnValue(storage) };
      const outputs = new StoryboardExportOutputService(
        db as never,
        registry as never,
        {} as never,
        {} as never,
        queue,
      );
      await db.$executeRaw`INSERT INTO storyboard_export_outputs(object_key,job_id,provider,bucket,next_attempt_at,status) VALUES(${key},${job.id}::uuid,'s3_compatible','private',now()-interval '1 second','published')`;
      await db.storyboardExportJob.update({
        where: { id: job.id },
        data: { status: 'completed', outputRef: { objectKey: key } },
      });
      await outputs.cleanup(key);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      await db.storyboardExportJob.update({
        where: { id: job.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await db.$executeRaw`UPDATE storyboard_export_outputs SET next_attempt_at=now()-interval '1 second' WHERE object_key=${key}`;
      storage.deleteObject.mockRejectedValueOnce(
        new Error('storage unavailable'),
      );
      await expect(outputs.cleanup(key)).rejects.toThrow('storage unavailable');
      const rows = await db.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM storyboard_export_outputs WHERE object_key=${key}`;
      expect(rows).toEqual([{ status: 'retired' }]);
      // A retired object can never be republished, even if its job still exists.
      await expect(
        outputs.publish(job, randomUUID(), { key, sizeBytes: 3 }),
      ).rejects.toThrow('no longer publishable');
      await db.$executeRaw`UPDATE storyboard_export_outputs SET next_attempt_at=now()-interval '1 second' WHERE object_key=${key}`;
      await outputs.cleanup(key);
      expect(storage.deleteObject).toHaveBeenLastCalledWith({
        bucket: 'private',
        region: null,
        storageKey: key,
      });
      expect(
        await db.$queryRaw`SELECT object_key FROM storyboard_export_outputs WHERE object_key=${key}`,
      ).toEqual([]);
      expect(
        (
          await db.storyboardExportJob.findUniqueOrThrow({
            where: { id: job.id },
          })
        ).outputRef,
      ).toBeNull();
    });
    afterAll(async () => {
      if (assetId) await db.mediaAsset.delete({ where: { id: assetId } });
      if (workspaceId)
        await db.workspace.delete({ where: { id: workspaceId } });
      await db?.$disconnect();
    });
    async function seed() {
      const job = await db.storyboardExportJob.create({
        data: {
          requestId: randomUUID(),
          requestHash: 'fixture',
          userId: actor,
          documentId,
          sequence: 0,
          width: 1280,
          height: 720,
          clips: [{ fixture: true }],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await db.mediaAssetUsage.create({
        data: {
          assetId,
          userId: actor,
          storyboardExportJobId: job.id,
          surface: 'canvas',
          role: 'reference',
        },
      });
      return job;
    }
    async function pins(id: string) {
      return db.mediaAssetUsage.count({
        where: { storyboardExportJobId: id, deletedAt: null },
      });
    }
    it('allows one concurrent claimant and fences an interrupted worker after takeover', async () => {
      const job = await seed();
      const claims = await Promise.all([queue.claim(), queue.claim()]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const first = claims.find(Boolean)!;
      expect(first.id).toBe(job.id);
      expect(await queue.heartbeat(job.id, first.leaseToken!)).toBe(true);
      await db.storyboardExportJob.update({
        where: { id: job.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await queue.complete(job.id, first.leaseToken!, { key: 'stale' }),
      ).toBe(false);
      const second = (await queue.claim())!;
      expect(second.attempts).toBe(2);
      expect(second.leaseToken).not.toBe(first.leaseToken);
      expect(await queue.heartbeat(job.id, first.leaseToken!)).toBe(false);
      expect(await queue.fail(job.id, first.leaseToken!, 'stale')).toBe(false);
      expect(await pins(job.id)).toBe(1);
      expect(
        await queue.complete(job.id, second.leaseToken!, {
          key: 'private-output',
        }),
      ).toBe(true);
      expect(await queue.fail(job.id, second.leaseToken!, 'late failure')).toBe(
        false,
      );
      expect(await pins(job.id)).toBe(1);
      await db.storyboardExportJob.update({
        where: { id: job.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await queue.sweep()).toBe(1);
      expect(await pins(job.id)).toBe(0);
      expect(
        await db.storyboardExportJob.findUnique({ where: { id: job.id } }),
      ).toMatchObject({
        status: 'expired',
        outputRef: { key: 'private-output' },
      });
    });
    it('cancels only owned work, invalidates active leases, and releases sources idempotently', async () => {
      const job = await seed();
      const claim = (await queue.claim())!;
      await expect(jobs.cancel('outsider', job.id)).rejects.toThrow(
        'Export not found',
      );
      expect(await jobs.cancel(actor, job.id)).toEqual({
        id: job.id,
        status: 'cancelled',
      });
      expect(await jobs.cancel(actor, job.id)).toEqual({
        id: job.id,
        status: 'cancelled',
      });
      expect(
        await queue.complete(job.id, claim.leaseToken!, { key: 'late' }),
      ).toBe(false);
      expect(await queue.heartbeat(job.id, claim.leaseToken!)).toBe(false);
      expect(await pins(job.id)).toBe(0);
      expect(await queue.claim()).toBeNull();
    });
    it('stops exhausted retries and deleted canvases without leaking retention', async () => {
      const job = await seed();
      await db.storyboardExportJob.update({
        where: { id: job.id },
        data: {
          status: 'running',
          attempts: 3,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 1000),
        },
      });
      expect(await queue.claim()).toBeNull();
      expect(await queue.sweep()).toBe(1);
      expect(await pins(job.id)).toBe(0);
      const missing = await seed();
      await db.storyboardExportJob.update({
        where: { id: missing.id },
        data: { documentId: null },
      });
      expect(await queue.claim()).toBeNull();
      expect(await queue.sweep()).toBe(1);
      expect(await pins(missing.id)).toBe(0);
    });
  },
);
