import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StoryboardExportWorkerService } from './storyboard-export-worker.service';
import { captureAuthorizedStoryboard } from './authorized-storyboard';
import { StoryboardExportJobsService } from './storyboard-export-jobs.service';
import { reauthorizeStoryboardJob } from './reauthorize-storyboard-job';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
import { StoryboardExportQueueService } from './storyboard-export-queue.service';
import { StudioDocumentAccessService } from '../documents/studio-document-access.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { MediaAccessService } from '../media/media-access.service';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { PrismaClient } from '@prisma/client';
import { buildPrisma } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { encodeDocumentSnapshot } from '../documents/document-crdt';
import { rootSchemaFor } from '../documents/document-modes';
import { captureSavedStoryboard } from './saved-storyboard';
const url = process.env.STORYBOARD_EXPORT_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'saved export snapshot (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let workspaceId: string;
    let projectId: string;
    const actor = `export-${randomUUID()}`;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55441' ||
        target.pathname !== '/audit_migrations_20261005'
      )
        throw new Error('Dedicated audit database required');
      db = buildPrisma(url);
      const workspace = await db.workspace.create({
        data: {
          name: 'Export fixture',
          ownerUserId: actor,
          createdById: actor,
        },
      });
      workspaceId = workspace.id;
      const project = await db.platformProject.create({
        data: { workspaceId, name: 'Export fixture', createdById: actor },
      });
      projectId = project.id;
    });
    afterAll(async () => {
      await db?.storyboardExportJob.deleteMany({ where: { userId: actor } });
      if (workspaceId)
        await db.workspace.delete({ where: { id: workspaceId } });
      await db?.$disconnect();
    });
    async function seed() {
      const snapshot = {
        nodes: {
          shot: { id: 'shot', type: 'shot', data: { order: 'a1' } },
          source: {
            id: 'source',
            type: 'videoAsset',
            data: {
              src: 'https://media.invalid/source.mp4',
              mediaAssetId: randomUUID(),
            },
          },
        },
        edges: { edge: { id: 'edge', source: 'source', target: 'shot' } },
      };
      const base = encodeDocumentSnapshot(snapshot, rootSchemaFor('canvas')!);
      const row = await db.studioDocument.create({
        data: {
          workspaceId,
          platformProjectId: projectId,
          type: 'canvas',
          title: 'Fixture',
          slug: randomUUID(),
          createdById: actor,
          contentSnapshot: snapshot,
          crdtState: Buffer.from(base.state),
        },
      });
      const client = new Y.Doc();
      Y.applyUpdate(client, base.state);
      const updates: Uint8Array[] = [];
      client.on('update', (u: Uint8Array) => updates.push(u));
      const data = client
        .getMap<Y.Map<unknown>>('nodes')
        .get('source')!
        .get('data') as Y.Map<unknown>;
      const changedId = randomUUID();
      data.set('mediaAssetId', changedId);
      data.set('src', 'https://media.invalid/changed.mp4');
      client.destroy();
      return { row, updates, changedId };
    }
    async function append(id: string, sequence: number, update: Uint8Array) {
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${id}`})::bigint)`;
        await tx.studioDocumentOperation.create({
          data: {
            documentId: id,
            sequence,
            operationType: 'yjs_update',
            actorUserId: actor,
            yjsUpdate: Buffer.from(update),
          },
        });
        await tx.studioDocument.update({
          where: { id },
          data: { currentSequence: sequence },
        });
      });
    }
    (process.env.STORYBOARD_RENDER_INTEGRATION === '1' ? it : it.skip)(
      'runs a saved job through real PostgreSQL, FFmpeg, publication and expiry with storage fixtures',
      async () => {
        const t = await seed();
        const directory = await mkdtemp(
          join(tmpdir(), 'export-worker-integration-'),
        );
        const path = join(directory, 'source.mp4');
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=red:s=160x90:r=30:d=0.4',
          '-c:v',
          'libx264',
          '-threads',
          '1',
          path,
        ]);
        const source = await readFile(path);
        const member = await db.workspaceMember.create({
          data: { workspaceId, userId: actor, role: 'owner' },
        });
        const asset = await db.mediaAsset.create({
          data: {
            id: t.changedId,
            workspaceId,
            kind: 'video',
            storageProvider: 's3_compatible',
            bucket: 'fixture-private',
            objectKey: 'source.mp4',
            contentType: 'video/mp4',
            sizeBytes: BigInt(source.length),
            status: 'ready',
            moderationStatus: 'approved',
            createdByUserId: actor,
          },
        });
        const objects = new Map<string, Buffer>();
        const expiry = () => new Date(Date.now() + 60000).toISOString();
        const storage = {
          providerId: 's3_compatible',
          createPrivateUploadUrl: (input: { storageKey: string }) =>
            Promise.resolve({
              url: `https://private.invalid/${input.storageKey}`,
              method: 'PUT',
              headers: {},
              storageKey: input.storageKey,
              provider: 's3_compatible',
              bucket: 'fixture-private',
              region: null,
              expiresAt: expiry(),
            }),
          headStoredObject: (ref: { storageKey: string }) =>
            Promise.resolve({
              exists: objects.has(ref.storageKey),
              sizeBytes: objects.get(ref.storageKey)?.length,
              contentType: 'video/mp4',
            }),
          createReadUrl: (ref: { storageKey: string }) =>
            Promise.resolve({
              url: `https://private.invalid/${ref.storageKey}`,
              expiresAt: expiry(),
            }),
          deleteObject: (ref: { storageKey: string }) => {
            objects.delete(ref.storageKey);
            return Promise.resolve();
          },
        };
        const fetcher = jest
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (input, options) => {
            if (options?.method !== 'PUT')
              return new Response(new Uint8Array(source), {
                headers: { 'content-length': String(source.length) },
              });
            const chunks: Buffer[] = [];
            for await (const chunk of options.body as unknown as AsyncIterable<Buffer>)
              chunks.push(chunk);
            objects.set(
              new URL(
                input instanceof Request ? input.url : input,
              ).pathname.slice(1),
              Buffer.concat(chunks),
            );
            return new Response(null, { status: 200 });
          });
        let worker: StoryboardExportWorkerService | undefined;
        try {
          await append(t.row.id, 1, Y.mergeUpdates(t.updates));
          const documents = new StudioDocumentAccessService(
            db as never,
            new WorkspacePermissionService(db as never),
            {} as never,
          );
          const media = new MediaAccessService(
            db as never,
            {} as never,
            {} as never,
            {} as never,
            documents,
          );
          const jobs = new StoryboardExportJobsService(
            db as never,
            documents,
            media,
          );
          const queue = new StoryboardExportQueueService(db as never);
          const outputs = new StoryboardExportOutputService(
            db as never,
            { forProvider: () => storage } as never,
            documents,
            media,
            queue,
          );
          worker = new StoryboardExportWorkerService(
            db as never,
            documents,
            media,
            {
              createReadUrl: () =>
                Promise.resolve({
                  url: 'https://source.invalid/source.mp4',
                  expiresAt: expiry(),
                }),
            } as never,
            queue,
            outputs,
          );
          const job = await jobs.create(actor, {
            requestId: randomUUID(),
            documentId: t.row.id,
            expectedSequence: 1,
            width: 160,
            height: 90,
          });
          await worker.drain();
          expect(await jobs.get(actor, job.id)).toMatchObject({
            status: 'completed',
          });
          expect(objects.size).toBe(1);
          const outputPath = join(directory, 'result.mp4');
          await writeFile(outputPath, [...objects.values()][0]);
          const probe = JSON.parse(
            execFileSync(
              'ffprobe',
              ['-v', 'error', '-show_streams', '-of', 'json', outputPath],
              { encoding: 'utf8' },
            ),
          ) as {
            streams: Array<{
              codec_name: string;
              codec_type: string;
              width?: number;
              height?: number;
            }>;
          };
          expect(
            probe.streams.find((item) => item.codec_type === 'video'),
          ).toMatchObject({ codec_name: 'h264', width: 160, height: 90 });
          expect(
            probe.streams.find((item) => item.codec_type === 'audio'),
          ).toMatchObject({ codec_name: 'aac' });
          expect((await outputs.download(actor, job.id)).url).toContain(
            'https://private.invalid/storyboard-exports/',
          );
          await db.storyboardExportJob.update({
            where: { id: job.id },
            data: { expiresAt: new Date(Date.now() - 1000) },
          });
          await db.$executeRaw`UPDATE storyboard_export_outputs SET next_attempt_at=now()-interval '1 second' WHERE job_id=${job.id}::uuid`;
          await queue.sweep();
          await outputs.sweep();
          expect(objects.size).toBe(0);
          expect(
            await db.mediaAssetUsage.count({
              where: { storyboardExportJobId: job.id, deletedAt: null },
            }),
          ).toBe(0);
          await expect(outputs.download(actor, job.id)).rejects.toThrow();
        } finally {
          await worker?.onModuleDestroy();
          fetcher.mockRestore();
          await db.$executeRaw`DELETE FROM storyboard_export_outputs WHERE job_id IN (SELECT id FROM storyboard_export_jobs WHERE user_id=${actor})`;
          await db.storyboardExportJob.deleteMany({ where: { userId: actor } });
          await db.mediaAsset.delete({ where: { id: asset.id } });
          await db.workspaceMember.delete({ where: { id: member.id } });
          await rm(directory, { recursive: true, force: true });
        }
      },
    );
    it('captures acknowledged updates before background compaction instead of stale JSON', async () => {
      const t = await seed();
      await append(t.row.id, 1, Y.mergeUpdates(t.updates));
      const result = await db.$transaction((tx) =>
        captureSavedStoryboard(tx, t.row.id, 1),
      );
      expect(result.sequence).toBe(1);
      expect(result.clips[0]).toMatchObject({
        mediaAssetId: t.changedId,
        sourceUrl: 'https://media.invalid/changed.mp4',
      });
      expect(
        (await db.studioDocument.findUniqueOrThrow({ where: { id: t.row.id } }))
          .snapshotSequence,
      ).toBe(0);
    });
    it('rejects a stale client revision and incomplete dependency state', async () => {
      const t = await seed();
      await append(t.row.id, 1, t.updates[1]);
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('saved canvas changed');
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 1)),
      ).rejects.toThrow('waiting for dependencies');
      await append(t.row.id, 2, t.updates[0]);
      const result = await db.$transaction((tx) =>
        captureSavedStoryboard(tx, t.row.id, 2),
      );
      expect(result.clips[0].mediaAssetId).toBe(t.changedId);
    });
    it('rejects archived and deleted canvases', async () => {
      const t = await seed();
      await db.studioDocument.update({
        where: { id: t.row.id },
        data: { status: 'archived' },
      });
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('Active canvas');
      await db.studioDocument.update({
        where: { id: t.row.id },
        data: { status: 'active', deletedAt: new Date() },
      });
      await expect(
        db.$transaction((tx) => captureSavedStoryboard(tx, t.row.id, 0)),
      ).rejects.toThrow('Active canvas');
    });
    it('admits canonical media from acknowledged edits with real document access and moderation gates', async () => {
      const t = await seed();
      const member = await db.workspaceMember.create({
        data: { workspaceId, userId: actor, role: 'owner' },
      });
      const asset = await db.mediaAsset.create({
        data: {
          id: t.changedId,
          workspaceId,
          kind: 'video',
          storageProvider: 's3_compatible',
          bucket: 'fixture-private',
          objectKey: 'original.mp4',
          contentType: 'video/mp4',
          sizeBytes: 100n,
          status: 'ready',
          moderationStatus: 'approved',
          createdByUserId: 'another-creator',
        },
      });
      try {
        await append(t.row.id, 1, Y.mergeUpdates(t.updates));
        const documents = new StudioDocumentAccessService(
          db as never,
          new WorkspacePermissionService(db as never),
          {} as never,
        );
        const media = new MediaAccessService(
          db as never,
          {} as never,
          {} as never,
          {} as never,
          documents,
        );
        const capture = (userId: string) =>
          db.$transaction((tx) =>
            captureAuthorizedStoryboard(
              tx,
              documents,
              media,
              userId,
              t.row.id,
              1,
            ),
          );
        const result = await capture(actor);
        expect(result.clips[0].source).toMatchObject({
          assetId: asset.id,
          bucket: 'fixture-private',
          objectKey: 'original.mp4',
        });
        expect(JSON.stringify(result)).not.toContain('https://media.invalid');
        await expect(capture('outsider')).rejects.toThrow();
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { moderationStatus: 'blocked' },
        });
        await expect(capture(actor)).rejects.toThrow(
          'Media asset is no longer available',
        );
      } finally {
        await db.mediaAsset.delete({ where: { id: asset.id } });
        await db.workspaceMember.delete({ where: { id: member.id } });
      }
    });
    it('atomically admits concurrent retries with retention, enforces ownership and capacity, and rolls back rejected captures', async () => {
      const t = await seed();
      const member = await db.workspaceMember.create({
        data: { workspaceId, userId: actor, role: 'owner' },
      });
      const asset = await db.mediaAsset.create({
        data: {
          id: t.changedId,
          workspaceId,
          kind: 'video',
          storageProvider: 's3_compatible',
          bucket: 'fixture-private',
          objectKey: 'original.mp4',
          contentType: 'video/mp4',
          sizeBytes: 100n,
          status: 'ready',
          moderationStatus: 'approved',
          createdByUserId: actor,
        },
      });
      try {
        await append(t.row.id, 1, Y.mergeUpdates(t.updates));
        const documents = new StudioDocumentAccessService(
          db as never,
          new WorkspacePermissionService(db as never),
          {} as never,
        );
        const media = new MediaAccessService(
          db as never,
          {} as never,
          {} as never,
          {} as never,
          documents,
        );
        const jobs = new StoryboardExportJobsService(
          db as never,
          documents,
          media,
        );
        const input = {
          requestId: randomUUID(),
          documentId: t.row.id,
          expectedSequence: 1,
          width: 1280,
          height: 720,
        };
        await expect(jobs.create('outsider', input)).rejects.toThrow();
        await expect(
          jobs.create(actor, { ...input, expectedSequence: 0 }),
        ).rejects.toThrow('saved canvas changed');
        expect(
          await db.storyboardExportJob.count({ where: { userId: actor } }),
        ).toBe(0);
        expect(
          await db.mediaAssetUsage.count({ where: { assetId: asset.id } }),
        ).toBe(0);
        const [first, replay] = await Promise.all([
          jobs.create(actor, input),
          jobs.create(actor, input),
        ]);
        expect(first).toEqual(replay);
        expect(first.status).toBe('queued');
        expect(JSON.stringify(first)).not.toMatch(
          /fixture-private|original.mp4|leaseToken|clips|requestHash/,
        );
        expect(
          await db.mediaAssetUsage.count({
            where: { storyboardExportJobId: first.id, deletedAt: null },
          }),
        ).toBe(1);
        await expect(
          jobs.create(actor, { ...input, width: 1920 }),
        ).rejects.toThrow('different settings');
        await expect(jobs.get('outsider', first.id)).rejects.toThrow(
          'Export not found',
        );
        expect(await jobs.get(actor, first.id)).toEqual(first);
        expect(await jobs.list(actor, t.row.id)).toEqual([first]);
        await expect(jobs.list('outsider', t.row.id)).rejects.toThrow();
        const running = await db.storyboardExportJob.update({
          where: { id: first.id },
          data: { status: 'running' },
        });
        const reauthorize = () =>
          db.$transaction((tx) =>
            reauthorizeStoryboardJob(tx, documents, media, running),
          );
        expect(await reauthorize()).toHaveLength(1);
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { objectKey: 'changed.mp4' },
        });
        await expect(reauthorize()).rejects.toThrow('source changed');
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { objectKey: 'original.mp4', moderationStatus: 'blocked' },
        });
        await expect(reauthorize()).rejects.toThrow(
          'Media asset is no longer available',
        );
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { moderationStatus: 'approved' },
        });
        await db.mediaAssetUsage.updateMany({
          where: { storyboardExportJobId: first.id },
          data: { deletedAt: new Date() },
        });
        await expect(reauthorize()).rejects.toThrow('no longer retained');
        await db.mediaAssetUsage.updateMany({
          where: { storyboardExportJobId: first.id },
          data: { deletedAt: null },
        });
        await db.storyboardExportJob.update({
          where: { id: first.id },
          data: { status: 'cancelled' },
        });
        await expect(reauthorize()).rejects.toThrow('no longer available');
        await db.storyboardExportJob.update({
          where: { id: first.id },
          data: { status: 'queued' },
        });
        await jobs.create(actor, { ...input, requestId: randomUUID() });
        await jobs.create(actor, { ...input, requestId: randomUUID() });
        await expect(
          jobs.create(actor, { ...input, requestId: randomUUID() }),
        ).rejects.toThrow('Three exports');
        // A retry remains readable at capacity; it must never create extra pins.
        expect(await jobs.create(actor, input)).toEqual(first);
        expect(
          await db.mediaAssetUsage.count({
            where: { assetId: asset.id, deletedAt: null },
          }),
        ).toBe(3);
        const token = randomUUID();
        const publishing = await db.storyboardExportJob.update({
          where: { id: first.id },
          data: {
            status: 'running',
            leaseToken: token,
            leaseExpiresAt: new Date(Date.now() + 60000),
          },
        });
        const key = `fixture/${randomUUID()}.mp4`;
        await db.$executeRaw`INSERT INTO storyboard_export_outputs(object_key,job_id,provider,bucket) VALUES(${key},${first.id}::uuid,'s3_compatible','fixture-private')`;
        const storage = {
          createReadUrl: jest.fn().mockResolvedValue({
            url: 'https://private.invalid/result',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          }),
        };
        const outputs = new StoryboardExportOutputService(
          db as never,
          { forProvider: () => storage } as never,
          documents,
          media,
          new StoryboardExportQueueService(db as never),
        );
        await expect(
          outputs.publish(publishing, randomUUID(), { key, sizeBytes: 3 }),
        ).rejects.toThrow('lease was lost');
        await outputs.publish(publishing, token, { key, sizeBytes: 3 });
        expect(await outputs.download(actor, first.id)).toMatchObject({
          url: 'https://private.invalid/result',
        });
        expect(storage.createReadUrl).toHaveBeenCalledWith(
          expect.objectContaining({
            expiresInSeconds: 60,
            cacheControl: 'private, no-store',
            filename: 'storyboard.mp4',
          }),
        );
        await expect(outputs.download('outsider', first.id)).rejects.toThrow(
          'Completed export not found',
        );
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { moderationStatus: 'blocked' },
        });
        await expect(outputs.download(actor, first.id)).rejects.toThrow(
          'Media asset is no longer available',
        );
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { moderationStatus: 'approved' },
        });
        await db.workspaceMember.delete({ where: { id: member.id } });
        await expect(outputs.download(actor, first.id)).rejects.toThrow();
        await expect(jobs.get(actor, first.id)).rejects.toThrow();
        await expect(jobs.create(actor, input)).rejects.toThrow();
      } finally {
        await db.$executeRaw`DELETE FROM storyboard_export_outputs WHERE job_id IN (SELECT id FROM storyboard_export_jobs WHERE user_id=${actor})`;
        await db.storyboardExportJob.deleteMany({ where: { userId: actor } });
        expect(
          await db.mediaAssetUsage.count({ where: { assetId: asset.id } }),
        ).toBe(0);
        await db.mediaAsset.delete({ where: { id: asset.id } });
        await db.workspaceMember.deleteMany({ where: { id: member.id } });
      }
    });
  },
);
