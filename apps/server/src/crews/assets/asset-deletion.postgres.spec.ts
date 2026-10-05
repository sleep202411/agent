import { ChannelVideosService } from '../../ip-commerce/channel-videos';
import { IpCommerceService } from '../../ip-commerce/ip-commerce.service';
import { extendPrismaQueries } from '../../common/__tests__/prisma-query-extension';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAssetsService } from './assets.service';
import * as Y from 'yjs';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { StoryReferenceService } from '../../story-studio/story-reference.service';
import { StoryProjectsService } from '../../story-studio/story-projects.service';
import { AiGenerationRepository } from '../../ai-generation/repository';
import type { AiJob } from '../../ai-generation/types';
function admissionJob(jobId: string): AiJob {
  return {
    id: jobId,
    userId: 'fixture',
    type: 'image',
    provider: 'fixture',
    modelId: 'fixture',
    deployment: 'fixture',
    schemaVersion: '1',
    canonicalModelId: null,
    providerBindingId: null,

    status: 'in_queue',
    stage: 'queued',
    queueName: 'ai-image-generation',
    prompt: 'Fixture',
    input: {},
    normalizedInput: {},
    idempotencyKey: jobId,
    outputs: [],
    logs: [],
    attempt: 1,
    metrics: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
const url = process.env.TASK01_TEST_DATABASE_URL;
const app = `crew-delete-${randomUUID()}`;
(url ? describe : describe.skip)(
  'Crew asset deletion (owned PostgreSQL)',
  () => {
    let db: PrismaClient,
      service: CrewAssetsService,
      crewId: string,
      nodeId: string,
      mediaId: string,
      workspaceId: string | undefined;
    const storage = { deleteObject: jest.fn() };
    const conversations = { broadcastCrewAssetChange: jest.fn() };
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url, application_name: app }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
      service = new CrewAssetsService(
        db as never,
        { requireWorkspaceRole: jest.fn() } as never,
        undefined as never,
        {
          requireNodePermission: jest.fn().mockResolvedValue('manage'),
          requireContainerPermission: jest.fn().mockResolvedValue('upload'),
        } as never,
        undefined as never,
        storage as never,
        conversations as never,
      );
    });
    beforeEach(async () => {
      workspaceId = undefined;
      storage.deleteObject.mockReset().mockResolvedValue(undefined);
      conversations.broadcastCrewAssetChange
        .mockReset()
        .mockResolvedValue(undefined);
      crewId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Deletion fixture',
          description: 'Fixture',
          logo: 'fixture.png',
          createdByUserId: 'fixture',
        },
      });
      const media = await db.mediaAsset.create({
        data: {
          kind: 'image',
          status: 'ready',
          storageProvider: 's3_compatible',
          bucket: 'fixture',
          objectKey: randomUUID(),
          metadata: { uploadKind: 'crew_asset_file', crewId },
        },
      });
      mediaId = media.id;
      const node = await db.crewAssetNode.create({
        data: {
          crewId,
          kind: 'file',
          status: 'trashed',
          trashedAt: new Date(),
          trashedByUserId: 'fixture',
          name: 'fixture.png',
          mediaAssetId: mediaId,
          createdByUserId: 'fixture',
          updatedByUserId: 'fixture',
        },
      });
      nodeId = node.id;
    });
    afterEach(async () => {
      if (workspaceId) {
        await db.aiJob.deleteMany({ where: { workspaceId } });
        await db.storyProject.deleteMany({ where: { workspaceId } });
        await db.aiEventOutbox.deleteMany({
          where: { payload: { path: ['workspaceId'], equals: workspaceId } },
        });
        await db.workspace.delete({ where: { id: workspaceId } });
      }
      await db.crew.delete({ where: { id: crewId } });
      await db.mediaAsset.delete({ where: { id: mediaId } });
    });
    afterAll(async () => db?.$disconnect());
    it.each(
      (['report', 'cleanup'] as const).flatMap((first) =>
        (['entry', 'pending'] as const).map((cleanupKind) => ({
          first,
          cleanupKind,
        })),
      ),
    )(
      'serializes report evidence when $first commits before $cleanupKind cleanup',
      async ({ first, cleanupKind }) => {
        if (cleanupKind === 'pending')
          await db.crewAssetNode.delete({ where: { id: nodeId } });
        const ip = await db.ip.create({
          data: {
            createdById: 'fixture',
            status: 'published',
            listingVisibility: 'public',
          },
        });
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: { createdByUserId: 'fixture' },
        });
        const reports = new IpCommerceService(
          db as never,
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
          undefined as never,
        );
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const transaction: <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
        const injected = jest
          .spyOn(db, '$transaction')
          .mockImplementationOnce(((
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            transaction(async (tx) => {
              const result = await callback(tx);
              ready();
              await gate;
              return result;
            })) as never);
        const report = () =>
          reports.reportContent(
            { userId: 'fixture' },
            {
              targetType: 'ip',
              targetId: ip.id,
              reason: 'copyright',
              evidenceAssetId: mediaId,
            },
          );
        const cleanup = () =>
          cleanupKind === 'pending'
            ? service.reclaimExpiredPendingUpload(
                mediaId,
                new Date(Date.now() + 60_000),
              )
            : service.removePermanently(crewId, 'fixture', nodeId);
        const leading = first === 'report' ? report() : cleanup();
        let trailing: Promise<unknown> | undefined;
        try {
          await Promise.race([
            started,
            leading.then(() => {
              throw Error('Leading operation did not reach commit gate');
            }),
          ]);
          trailing = (first === 'report' ? cleanup() : report()).then(
            () => null,
            (error: unknown) => error,
          );
          const deadline = Date.now() + 2000;
          while (true) {
            const [row] = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${app} AND wait_event_type='Lock'`;
            if (Number(row.count)) break;
            if (Date.now() > deadline)
              throw Error('Evidence operation did not wait for media lock');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          release();
          await leading;
          const error = await trailing;
          expect(
            await db.ipContentReport.count({ where: { ipId: ip.id } }),
          ).toBe(first === 'report' ? 1 : 0);
          if (first === 'report') {
            expect(error).toBeNull();
            expect(storage.deleteObject).not.toHaveBeenCalled();
            expect(
              await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } }),
            ).toMatchObject({ status: 'ready', deletedAt: null });
          } else {
            expect(error).toMatchObject({
              status: 400,
              response: { code: 'REPORT_EVIDENCE_UNAVAILABLE' },
            });
            expect(storage.deleteObject).toHaveBeenCalledTimes(1);
          }
        } finally {
          release();
          await Promise.allSettled([leading, ...(trailing ? [trailing] : [])]);
          injected.mockRestore();
          await db.ipContentReport.deleteMany({ where: { ipId: ip.id } });
          await db.ip.delete({ where: { id: ip.id } });
        }
      },
    );
    it.each(
      (['channel', 'cleanup'] as const).flatMap((first) =>
        (['entry', 'pending'] as const).map((cleanupKind) => ({
          first,
          cleanupKind,
        })),
      ),
    )(
      'serializes channel submissions when $first commits before $cleanupKind cleanup',
      async ({ first, cleanupKind }) => {
        if (cleanupKind === 'pending')
          await db.crewAssetNode.delete({ where: { id: nodeId } });
        const ip = await db.ip.create({
          data: {
            createdById: 'fixture',
            channelType: 'community',
            status: 'published',
            listingVisibility: 'public',
          },
        });
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: {
            createdByUserId: 'fixture',
            kind: 'video',
            source: 'user_upload',
          },
        });
        await db.$executeRaw`INSERT INTO ip_channel_submission_settings(ip_id,open,updated_by_id) VALUES (${ip.id}::uuid,true,'fixture')`;
        const channels = new ChannelVideosService(
          db as never,
          { ensurePublicEngagementTarget: jest.fn() } as never,
          undefined as never,
        );
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const transaction: <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
        const injected = jest
          .spyOn(db, '$transaction')
          .mockImplementationOnce(((
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            transaction(async (tx) => {
              const result = await callback(tx);
              ready();
              await gate;
              return result;
            })) as never);
        const report = () =>
          channels.submit(
            ip.id,
            { userId: 'fixture' },
            {
              assetId: mediaId,
              title: 'Retained channel video',
              description: '',
            },
          );
        const cleanup = () =>
          cleanupKind === 'pending'
            ? service.reclaimExpiredPendingUpload(
                mediaId,
                new Date(Date.now() + 60_000),
              )
            : service.removePermanently(crewId, 'fixture', nodeId);
        const leading = first === 'channel' ? report() : cleanup();
        let trailing: Promise<unknown> | undefined;
        try {
          await Promise.race([
            started,
            leading.then(() => {
              throw Error('Leading operation did not reach commit gate');
            }),
          ]);
          trailing = (first === 'channel' ? cleanup() : report()).then(
            () => null,
            (error: unknown) => error,
          );
          const deadline = Date.now() + 2000;
          while (true) {
            const [row] = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${app} AND wait_event_type='Lock'`;
            if (Number(row.count)) break;
            if (Date.now() > deadline)
              throw Error('Channel submission did not wait for media lock');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          release();
          await leading;
          const error = await trailing;
          expect(
            await db.ipChannelVideoSubmission.count({
              where: { channelId: ip.id },
            }),
          ).toBe(first === 'channel' ? 1 : 0);
          if (first === 'channel') {
            expect(error).toBeNull();
            expect(storage.deleteObject).not.toHaveBeenCalled();
            expect(
              await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } }),
            ).toMatchObject({ status: 'ready', deletedAt: null });
          } else {
            expect(error).toMatchObject({
              status: 400,
            });
            expect(storage.deleteObject).toHaveBeenCalledTimes(1);
          }
        } finally {
          release();
          await Promise.allSettled([leading, ...(trailing ? [trailing] : [])]);
          injected.mockRestore();
          await db.ip.delete({ where: { id: ip.id } });
        }
      },
    );
    it('preserves channel bytes during delayed physical cleanup of legacy retired media', async () => {
      const ip = await db.ip.create({
        data: { createdById: 'fixture', channelType: 'community' },
      });
      try {
        await db.ipChannelVideoSubmission.create({
          data: {
            id: randomUUID(),
            channelId: ip.id,
            assetId: mediaId,
            submittedById: 'fixture',
            title: 'Existing submission',
          },
        });
        await db.crewAssetNode.delete({ where: { id: nodeId } });
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: {
            status: 'deleted',
            deletedAt: new Date(),
            metadata: {
              uploadKind: 'crew_asset_file',
              crewId,
              crewPhysicalDeletionPending: true,
            },
          },
        });
        await service.reclaimDeletedCrewUpload(mediaId);
        expect(storage.deleteObject).not.toHaveBeenCalled();
        await db.ip.delete({ where: { id: ip.id } });
        await service.reclaimDeletedCrewUpload(mediaId);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        await service.reclaimDeletedCrewUpload(mediaId);
        expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      } finally {
        await db.ip.deleteMany({ where: { id: ip.id } });
      }
    });
    it('does not let reservation cleanup bypass retired-media retention', async () => {
      const key = `media/global/crew-asset-file/${randomUUID()}.png`;
      const finalKey = key.replace('/crew-asset-file/', '/crew-asset-final/');
      await db.mediaAsset.update({
        where: { id: mediaId },
        data: {
          objectKey: finalKey,
          status: 'deleted',
          deletedAt: new Date(),
          metadata: {
            uploadKind: 'crew_asset_file',
            crewId,
            crewPhysicalDeletionPending: true,
          },
        },
      });
      await db.$executeRaw`INSERT INTO crew_upload_reservations (storage_key, crew_id, user_id, size_bytes, expires_at, state) VALUES (${key}, ${crewId}, 'fixture', 1, now() - interval '1 hour', 'completed')`;
      const provider = {
        headObject: jest
          .fn()
          .mockResolvedValue({ exists: true, bucket: 'fixture' }),
        deleteObject: jest.fn().mockResolvedValue(undefined),
      };
      const cleanup = new CrewAssetsService(
        db as never,
        undefined as never,
        undefined as never,
        undefined as never,
        { forProvider: () => provider } as never,
        storage as never,
        conversations as never,
      );
      await cleanup.cleanupUploadReservations();
      expect(provider.deleteObject).toHaveBeenCalledTimes(1);
      expect(provider.deleteObject).toHaveBeenCalledWith(
        expect.objectContaining({ storageKey: key }),
      );
      expect(await db.crewAssetNode.count({ where: { id: nodeId } })).toBe(1);
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } }))
          .metadata,
      ).toMatchObject({ crewPhysicalDeletionPending: true });
    });
    it.each(['file', 'folder'] as const)(
      'explains retained submission evidence when deleting a %s',
      async (kind) => {
        const state = await db.crewTaskWorkflowState.create({
          data: {
            crewId,
            name: 'Submitted',
            color: '#ffffff',
            semantic: 'submitted',
            createdByUserId: 'fixture',
          },
        });
        const task = await db.crewTask.create({
          data: {
            crewId,
            number: 1,
            title: 'Submitted task',
            workflowStateId: state.id,
            createdByUserId: 'fixture',
          },
        });
        const submission = await db.crewTaskSubmission.create({
          data: {
            taskId: task.id,
            versionNumber: 1,
            submittedByUserId: 'fixture',
            assets: { create: { assetNodeId: nodeId } },
          },
        });
        let targetId = nodeId;
        if (kind === 'folder') {
          const folder = await db.crewAssetNode.create({
            data: {
              crewId,
              kind: 'folder',
              status: 'trashed',
              trashedAt: new Date(),
              trashedByUserId: 'fixture',
              name: 'Submission folder',
              createdByUserId: 'fixture',
              updatedByUserId: 'fixture',
            },
          });
          targetId = folder.id;
          await db.crewAssetNode.update({
            where: { id: nodeId },
            data: { parentId: folder.id },
          });
        }
        try {
          await expect(
            service.removePermanently(crewId, 'fixture', targetId),
          ).rejects.toMatchObject({
            status: 409,
            response: { code: 'CREW_ASSET_IN_USE' },
          });
          expect(await db.crewAssetNode.count({ where: { id: nodeId } })).toBe(
            1,
          );
          expect(
            await db.crewTaskSubmissionAsset.count({
              where: { submissionId: submission.id, assetNodeId: nodeId },
            }),
          ).toBe(1);
          expect(
            await db.mediaAsset.findUnique({
              where: { id: mediaId },
              select: { status: true, deletedAt: true },
            }),
          ).toEqual({ status: 'ready', deletedAt: null });
          expect(storage.deleteObject).not.toHaveBeenCalled();
          expect(conversations.broadcastCrewAssetChange).not.toHaveBeenCalled();
        } finally {
          await db.crewTask.delete({ where: { id: task.id } });
        }
      },
    );
    it.each(['link', 'relink'] as const)(
      'rejects Crew-owned uploads through Studio %s',
      async (operation) => {
        workspaceId = (
          await db.workspace.create({
            data: {
              name: 'Linked workspace',
              ownerUserId: 'fixture',
              createdById: 'fixture',
            },
          })
        ).id;
        await db.crew.update({
          where: { id: crewId },
          data: { studioWorkspaceId: workspaceId },
        });
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: { workspaceId },
        });
        await db.crewAssetNode.update({
          where: { id: nodeId },
          data: { status: 'active', trashedAt: null, trashedByUserId: null },
        });
        const action =
          operation === 'link'
            ? service.linkStudioMedia(crewId, 'fixture', {
                mediaAssetIds: [mediaId],
              })
            : service.setStudioLink(crewId, 'fixture', nodeId, {
                mediaAssetId: mediaId,
              });
        await expect(action).rejects.toMatchObject({ status: 403 });
        expect(await db.crewAssetNode.count({ where: { crewId } })).toBe(1);
        expect(
          await db.crewAssetNode.findUniqueOrThrow({ where: { id: nodeId } }),
        ).toMatchObject({ linkedStudioMediaAssetId: null });
      },
    );

    it.each(
      (['cover', 'deletion'] as const).flatMap((first) =>
        ['entry', 'pending'].flatMap((cleanup) =>
          [
            'cover',
            'candidate',
            'story-cover',
            'store-listing',
            'reference',
            'job',
          ].map((binding) => ({
            first,
            cleanup,
            binding,
          })),
        ),
      ),
    )(
      'serializes $binding assignment when $first commits before $cleanup cleanup',
      async ({ first, cleanup, binding }) => {
        if (cleanup === 'pending')
          await db.crewAssetNode.delete({ where: { id: nodeId } });
        const workspace = await db.workspace.create({
          data: {
            name: 'Cover race',
            ownerUserId: 'fixture',
            createdById: 'fixture',
          },
        });
        workspaceId = workspace.id;
        const project = await db.platformProject.create({
          data: { workspaceId, name: 'Cover race', createdById: 'fixture' },
        });
        await db.mediaAsset.update({
          where: { id: mediaId },
          data: { workspaceId },
        });
        const projects = new WorkspacesService(
          db as never,
          undefined as never,
          { record: jest.fn() } as never,
          { requireProjectRole: jest.fn().mockResolvedValue(project) } as never,
          undefined as never,
          undefined as never,
        );
        if (
          binding === 'candidate' ||
          binding === 'story-cover' ||
          binding === 'store-listing' ||
          binding === 'reference'
        )
          await db.workspaceMember.create({
            data: {
              workspaceId,
              userId: 'fixture',
              role: 'owner',
              status: 'active',
            },
          });
        const story =
          binding === 'candidate' ||
          binding === 'story-cover' ||
          binding === 'store-listing' ||
          binding === 'reference'
            ? await db.storyProject.create({
                data: {
                  workspaceId,
                  title: 'Candidate race',
                  writeState: { create: {} },
                  createdByUserId: 'fixture',
                  frameProfile: 'landscape_16_9',
                  members: {
                    create: {
                      userId: 'fixture',
                      role: 'owner',
                      status: 'active',
                      grantedByUserId: 'fixture',
                    },
                  },
                },
              })
            : null;
        const stories = new StoryProjectsService(
          db as never,
          {
            requireProject: jest.fn().mockResolvedValue(story),
            effectiveAccess: jest.fn().mockReturnValue({ capabilities: [] }),
            requireProjectInTransaction: jest.fn().mockResolvedValue(story),
          } as never,
          undefined as never,
          { assertHumanWriteAllowed: jest.fn() } as never,
          { requireUseAccessById: jest.fn() } as never,
        );
        const slot =
          binding === 'reference' && story
            ? await db.storyReferenceSlot.create({
                data: {
                  storyProjectId: story.id,
                  key: 'character',
                  kind: 'character',
                  label: 'Character',
                },
              })
            : null;
        const asset = await db.mediaAsset.findUniqueOrThrow({
          where: { id: mediaId },
        });
        const variant = slot
          ? await db.mediaAssetVariant.create({
              data: {
                assetId: mediaId,
                variantKey: 'original',
                kind: 'original',
                status: 'ready',
                checksumSha256: 'a'.repeat(64),
                placements: {
                  create: {
                    assetId: mediaId,
                    storageProvider: 's3_compatible',
                    bucket: 'fixture',
                    objectKey: asset.objectKey,
                    publicBaseUrl: 'https://fixture.invalid',
                    role: 'primary',
                    status: 'active',
                  },
                },
              },
            })
          : null;
        const references = new StoryReferenceService(
          db as never,
          {
            requireProject: jest.fn().mockResolvedValue({ project: story }),
          } as never,
          { assertHumanWriteAllowed: jest.fn() } as never,
        );
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const transaction: <T>(
          callback: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
        const injected = jest
          .spyOn(db, '$transaction')
          .mockImplementationOnce(((
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            transaction(async (tx) => {
              const result = await callback(tx);
              ready();
              await gate;
              return result;
            })) as never);
        const jobId = randomUUID();
        const beforeCreate = jest.fn(() => Promise.resolve());
        const jobs = new AiGenerationRepository(
          db as never,
          { resolvePublicUrl: () => null } as never,
        );
        const job = {
          ...admissionJob(jobId),
          workspaceId,
          projectId: project.id,
        };
        const setCover = () =>
          slot && story && variant
            ? references.createVersion(
                { userId: 'fixture' } as never,
                story.id,
                slot.id,
                {
                  expectedSlotVersion: 0,
                  assetId: mediaId,
                  variantId: variant.id,
                  source: 'upload',
                },
                'fixture-reference',
              )
            : binding === 'job'
              ? jobs.reserveQueuedJob({
                  userId: 'fixture',
                  modelId: 'fixture',
                  idempotencyKey: jobId,
                  queueName: job.queueName,
                  type: 'image',
                  limitSubject: { type: 'user', id: 'fixture' },
                  perSubjectQueued: null,
                  buildJob: () => job,
                  beforeCreate,
                  references: [
                    { assetId: mediaId, refId: 'ref', kind: 'image' },
                  ],
                })
              : story
                ? binding === 'story-cover' || binding === 'store-listing'
                  ? stories.patch({ userId: 'fixture' } as never, story.id, {
                      ...(binding === 'store-listing'
                        ? {
                            storeListing: {
                              description: 'Saved draft',
                              tags: [],
                              developer: '',
                              trailerAssetId: null,
                              screenshotAssetIds: [mediaId],
                            },
                          }
                        : { coverAssetId: mediaId }),
                      expectedProjectVersion: story.version,
                    })
                  : stories.addCandidateAsset(
                      { userId: 'fixture' } as never,
                      story.id,
                      mediaId,
                    )
                : projects.updateProject(
                    { userId: 'fixture' } as never,
                    project.id,
                    {
                      coverAssetId: mediaId,
                    },
                  );
        const remove = () =>
          cleanup === 'pending'
            ? service.reclaimExpiredPendingUpload(
                mediaId,
                new Date(Date.now() + 60_000),
              )
            : service.removePermanently(crewId, 'fixture', nodeId);
        const leading = first === 'cover' ? setCover() : remove();
        await started;
        const trailing = (first === 'cover' ? remove() : setCover()).then(
          () => null,
          (error: unknown) => error,
        );
        try {
          const deadline = Date.now() + 2000;
          while (true) {
            const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
              SELECT count(*) FROM pg_stat_activity
              WHERE application_name=${app} AND wait_event_type='Lock'
            `;
            if (Number(row.count)) break;
            if (Date.now() > deadline)
              throw new Error(
                'Concurrent operation did not wait for media lock',
              );
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
          await leading;
          injected.mockRestore();
        }
        const error = await trailing;
        const stored = await db.platformProject.findUniqueOrThrow({
          where: { id: project.id },
        });
        const candidateCount = story
          ? await db.storyCandidateAsset.count({
              where: { storyProjectId: story.id },
            })
          : 0;
        if (first === 'cover') {
          expect(error).toBeNull();
          if (binding === 'candidate') expect(candidateCount).toBe(1);
          else if (slot)
            expect(
              await db.storyReferenceVersion.count({
                where: { referenceSlotId: slot.id },
              }),
            ).toBe(1);
          else if (story)
            expect(
              await db.storyProject.findUniqueOrThrow({
                where: { id: story.id },
              }),
            ).toMatchObject(
              binding === 'store-listing'
                ? { storeListing: { screenshotAssetIds: [mediaId] } }
                : { coverAssetId: mediaId },
            );
          else if (binding === 'job') {
            expect(await db.aiJob.count({ where: { id: jobId } })).toBe(1);
            expect(
              await db.mediaAssetUsage.count({
                where: { aiJobId: jobId, assetId: mediaId },
              }),
            ).toBe(1);
            expect(beforeCreate).toHaveBeenCalledTimes(1);
          } else expect(stored.coverAssetId).toBe(mediaId);
          expect(
            await db.mediaAsset.findUnique({ where: { id: mediaId } }),
          ).toMatchObject({ status: 'ready' });
          expect(storage.deleteObject).not.toHaveBeenCalled();
        } else {
          expect(error).toMatchObject({
            status: story ? 422 : 400,
          });
          if (binding === 'job') {
            expect(await db.aiJob.count({ where: { id: jobId } })).toBe(0);
            expect(beforeCreate).not.toHaveBeenCalled();
          }
          if (slot)
            expect(
              await db.storyReferenceVersion.count({
                where: { referenceSlotId: slot.id },
              }),
            ).toBe(0);
          if (binding === 'store-listing' && story) {
            expect(
              await db.storyProject.findUniqueOrThrow({
                where: { id: story.id },
              }),
            ).toMatchObject({ storeListing: null });
          }
          expect(candidateCount).toBe(0);
          expect(stored.coverAssetId).toBeNull();
          expect(storage.deleteObject).toHaveBeenCalledTimes(1);
        }
      },
    );
    it('rolls back job admission when reference-ledger persistence fails', async () => {
      const job = admissionJob(randomUUID());
      const failed = extendPrismaQueries(db, {
        query: {
          mediaAssetUsage: {
            createMany: () =>
              Promise.reject(new Error('Reference ledger unavailable')),
          },
        },
      });
      const repository = new AiGenerationRepository(
        failed as never,
        {} as never,
      );
      await expect(
        repository.reserveQueuedJob({
          userId: job.userId,
          modelId: job.modelId,
          idempotencyKey: job.idempotencyKey,
          queueName: job.queueName,
          type: job.type,
          limitSubject: { type: 'user', id: job.userId },
          perSubjectQueued: null,
          buildJob: () => job,
          references: [{ assetId: mediaId, refId: 'ref', kind: 'image' }],
        }),
      ).rejects.toThrow('Reference ledger unavailable');
      expect(await db.aiJob.count({ where: { id: job.id } })).toBe(0);
      expect(
        await db.mediaAssetUsage.count({ where: { aiJobId: job.id } }),
      ).toBe(0);
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
    it('retries storage failure after retiring an abandoned upload', async () => {
      await db.crewAssetNode.delete({ where: { id: nodeId } });
      storage.deleteObject.mockRejectedValueOnce(
        new Error('Storage unavailable'),
      );
      await expect(
        service.reclaimExpiredPendingUpload(
          mediaId,
          new Date(Date.now() + 60_000),
        ),
      ).resolves.toBe(true);
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'deleted',
        metadata: { crewPhysicalDeletionPending: true },
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        metadata: { uploadKind: 'crew_asset_file', crewId },
      });
      await expect(
        service.reclaimExpiredPendingUpload(
          mediaId,
          new Date(Date.now() + 60_000),
        ),
      ).resolves.toBe(false);
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
    it('keeps an unclaimed upload that already has a project usage', async () => {
      await db.crewAssetNode.delete({ where: { id: nodeId } });
      await db.mediaAssetUsage.create({
        data: { assetId: mediaId, surface: 'project', role: 'reference' },
      });
      await expect(
        service.reclaimExpiredPendingUpload(
          mediaId,
          new Date(Date.now() + 60_000),
        ),
      ).resolves.toBe(false);
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'ready',
        deletedAt: null,
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('does not remove unclaimed-upload bytes before its retirement transaction commits', async () => {
      await db.crewAssetNode.delete({ where: { id: nodeId } });
      const transaction: <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
      const injected = jest.spyOn(db, '$transaction').mockImplementationOnce(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        transaction(async (tx) => {
          await callback(tx);
          throw new Error('Injected rollback');
        })) as never);
      try {
        await expect(
          service.reclaimExpiredPendingUpload(
            mediaId,
            new Date(Date.now() + 60_000),
          ),
        ).rejects.toThrow('Injected rollback');
      } finally {
        injected.mockRestore();
      }
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'ready',
        deletedAt: null,
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it.each(
      (
        [
          'snapshot',
          'version',
          'binary version',
          'binary current',
          'out-of-order edit',
          'pending edit',
          'compacted edit',
          'project cover',
          'uppercase snapshot',
          'job references',
          'job input',
          'job normalized input',
        ] as const
      ).flatMap((reference) =>
        ['entry', 'pending'].map((cleanup) => ({ reference, cleanup })),
      ),
    )(
      'keeps media referenced by $reference during $cleanup cleanup',
      async ({ reference, cleanup }) => {
        if (cleanup === 'pending')
          await db.crewAssetNode.delete({ where: { id: nodeId } });
        const workspace = await db.workspace.create({
          data: {
            name: 'Deletion fixture',
            ownerUserId: 'fixture',
            createdById: 'fixture',
          },
        });
        workspaceId = workspace.id;
        const project = await db.platformProject.create({
          data: {
            workspaceId,
            name: 'Fixture',
            createdById: 'fixture',
            coverAssetId: reference === 'project cover' ? mediaId : undefined,
          },
        });
        if (reference === 'project cover') {
          await db.mediaAsset.update({
            where: { id: mediaId },
            data: { workspaceId },
          });
        }
        if (reference.startsWith('job ')) {
          const refs = [
            { assetId: mediaId, refId: 'reference-1', kind: 'image' },
          ];
          await db.aiJob.create({
            data: {
              id: randomUUID(),
              workspaceId,
              projectId: project.id,
              userId: 'fixture',
              type: 'image',
              provider: 'fixture',
              modelId: 'fixture',
              deployment: 'fixture',
              schemaVersion: '1',
              status: 'in_queue',
              stage: 'queued',
              queueName: 'fixture',
              prompt: 'Fixture',
              idempotencyKey: randomUUID(),
              logs: [],
              metrics: {},
              referenceSnapshot: reference === 'job references' ? refs : [],
              input: reference === 'job input' ? { references: refs } : {},
              normalizedInput:
                reference === 'job normalized input'
                  ? { references: refs }
                  : {},
            },
          });
        }
        const snapshot = {
          nodes: {
            image: {
              data: {
                mediaAssetId:
                  reference === 'uppercase snapshot'
                    ? mediaId.toUpperCase()
                    : mediaId,
              },
            },
          },
        };
        const document = await db.studioDocument.create({
          data: {
            workspaceId,
            platformProjectId: project.id,
            type: 'canvas',
            title: 'Fixture',
            createdById: 'fixture',
            contentSnapshot:
              reference === 'snapshot' || reference === 'uppercase snapshot'
                ? snapshot
                : {},
          },
        });
        if (reference === 'out-of-order edit') {
          const doc = new Y.Doc();
          const node = new Y.Map<unknown>();
          doc.getMap('nodes').set('image', node);
          const vector = Y.encodeStateVector(doc);
          node.set('mediaAssetId', mediaId);
          const dependentUpdate = Buffer.from(
            Y.encodeStateAsUpdate(doc, vector),
          );
          doc.destroy();
          await db.studioDocumentOperation.create({
            data: {
              documentId: document.id,
              sequence: 1,
              operationType: 'yjs_update',
              actorUserId: 'fixture',
              yjsUpdate: dependentUpdate,
            },
          });
          await db.studioDocument.update({
            where: { id: document.id },
            data: { currentSequence: 1 },
          });
        }
        if (reference === 'binary version' || reference === 'binary current') {
          const doc = new Y.Doc();
          const node = new Y.Map<unknown>();
          node.set('mediaAssetId', mediaId);
          doc.getMap('nodes').set('image', node);
          const state = Buffer.from(Y.encodeStateAsUpdate(doc));
          doc.destroy();
          if (reference === 'binary current')
            await db.studioDocument.update({
              where: { id: document.id },
              data: { crdtState: state },
            });
          else
            await db.studioDocumentVersion.create({
              data: {
                documentId: document.id,
                versionNumber: 1,
                sequence: 0,
                schemaVersion: document.schemaVersion,
                snapshot: {},
                crdtState: state,
                createdById: 'fixture',
              },
            });
        }
        if (reference === 'version') {
          await db.studioDocumentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: 1,
              sequence: 0,
              schemaVersion: document.schemaVersion,
              snapshot,
              createdById: 'fixture',
            },
          });
        }
        if (reference === 'pending edit' || reference === 'compacted edit') {
          const ydoc = new Y.Doc();
          const data = new Y.Map<unknown>();
          ydoc.getMap('nodes').set('image', data);
          const base = Y.encodeStateAsUpdate(ydoc);
          const vector = Y.encodeStateVector(ydoc);
          data.set('mediaAssetId', mediaId);
          const update = Y.encodeStateAsUpdate(ydoc, vector);
          ydoc.destroy();
          await db.studioDocument.update({
            where: { id: document.id },
            data: { crdtState: Buffer.from(base), currentSequence: 1 },
          });
          await db.studioDocumentOperation.create({
            data: {
              documentId: document.id,
              sequence: 1,
              operationType: 'yjs_update',
              actorUserId: 'fixture',
              yjsUpdate: Buffer.from(update),
            },
          });
        }
        // Compaction can replace the binary tail between the initial JSON
        // reference query and the per-document read. Exercise that exact gap.
        let restoreQuery: (() => void) | undefined;
        if (reference === 'compacted edit') {
          const transaction: <T>(
            callback: (tx: Prisma.TransactionClient) => Promise<T>,
          ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
          const spy = jest.spyOn(db, '$transaction').mockImplementationOnce(((
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) =>
            transaction(async (tx) => {
              const queryRaw = (query: Prisma.Sql): Promise<unknown> =>
                tx.$queryRaw(query);
              let firstRead = true;
              const wrapped = new Proxy(tx, {
                get(target, key) {
                  if (key !== '$queryRaw')
                    return Reflect.get(target, key) as unknown;
                  return async (query: Prisma.Sql) => {
                    const result: unknown = await queryRaw(query);
                    if (firstRead) {
                      firstRead = false;
                      await db.studioDocument.update({
                        where: { id: document.id },
                        data: {
                          contentSnapshot: snapshot,
                          snapshotSequence: 1,
                        },
                      });
                      await db.studioDocumentOperation.deleteMany({
                        where: { documentId: document.id },
                      });
                    }
                    return result;
                  };
                },
              });
              return callback(wrapped);
            })) as never);
          restoreQuery = () => spy.mockRestore();
        }
        try {
          if (cleanup === 'pending') {
            await expect(
              service.reclaimExpiredPendingUpload(
                mediaId,
                new Date(Date.now() + 60_000),
              ),
            ).resolves.toBe(false);
          } else {
            await service.removePermanently(crewId, 'fixture', nodeId);
          }
        } finally {
          restoreQuery?.();
        }
        expect(
          await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
        ).toBeNull();
        expect(
          await db.mediaAsset.findUnique({ where: { id: mediaId } }),
        ).toMatchObject({
          status: 'ready',
          deletedAt: null,
        });
        expect(storage.deleteObject).not.toHaveBeenCalled();
      },
    );
    it('keeps media and its active usage when removing the Crew library entry', async () => {
      const usage = await db.mediaAssetUsage.create({
        data: { assetId: mediaId, surface: 'project', role: 'reference' },
      });
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'ready',
        deletedAt: null,
      });
      expect(
        await db.mediaAssetUsage.findUnique({ where: { id: usage.id } }),
      ).toMatchObject({
        deletedAt: null,
      });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('does not delete a file restored by an overlapping transaction', async () => {
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        ready = r;
      });
      const restoration = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crew:asset-tree:${crewId}`})::bigint)`;
        await tx.crewAssetNode.update({
          where: { id: nodeId },
          data: { status: 'active', trashedAt: null, trashedByUserId: null },
        });
        ready();
        await gate;
      });
      await started;
      const deletion = service
        .removePermanently(crewId, 'fixture', nodeId)
        .then(
          () => null,
          (e: unknown) => e,
        );
      try {
        const deadline = Date.now() + 2000;
        while (true) {
          const [row] = await db.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${app} AND wait_event_type='Lock'`;
          if (Number(row.count)) break;
          if (Date.now() > deadline) throw Error('Deletion did not wait');
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        release();
        await restoration;
      }
      expect(await deletion).toMatchObject({ status: 404 });
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toMatchObject({ status: 'active' });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('keeps bytes and the trashed node if the database transaction rolls back', async () => {
      const transaction: <T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
      ) => Promise<T> = db.$transaction.bind(db) as typeof db.$transaction;
      const injected = jest.spyOn(db, '$transaction').mockImplementationOnce(((
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) =>
        transaction(async (tx) => {
          await callback(tx);
          throw new Error('Injected rollback');
        })) as never);
      try {
        await expect(
          service.removePermanently(crewId, 'fixture', nodeId),
        ).rejects.toThrow('Injected rollback');
      } finally {
        injected.mockRestore();
      }
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toMatchObject({ status: 'trashed' });
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({ status: 'ready', deletedAt: null });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('persists failed storage cleanup and retries retired placements after restart', async () => {
      await db.mediaObjectPlacement.create({
        data: {
          assetId: mediaId,
          storageProvider: 's3_compatible',
          bucket: 'fixture-copy',
          objectKey: randomUUID(),
          region: 'fixture',
          status: 'active',
        },
      });
      storage.deleteObject.mockRejectedValueOnce(
        new Error('Storage unavailable'),
      );
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({
        status: 'deleted',
        metadata: { crewPhysicalDeletionPending: true },
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(2);
      const retired = await db.mediaAsset.findUniqueOrThrow({
        where: { id: mediaId },
      });
      expect(retired.metadata).toEqual({
        uploadKind: 'crew_asset_file',
        crewId,
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
    it('deletes an uncontested trashed file', async () => {
      await service.removePermanently(crewId, 'fixture', nodeId);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nodeId } }),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUnique({ where: { id: mediaId } }),
      ).toMatchObject({ status: 'deleted' });
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
    it('does not reclaim pending bytes while an active usage exists', async () => {
      storage.deleteObject.mockRejectedValueOnce(
        new Error('Storage unavailable'),
      );
      await service.removePermanently(crewId, 'fixture', nodeId);
      const usage = await db.mediaAssetUsage.create({
        data: { assetId: mediaId, surface: 'project', role: 'reference' },
      });
      storage.deleteObject.mockClear();
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      await db.mediaAssetUsage.delete({ where: { id: usage.id } });
      await service.reclaimDeletedCrewUpload(mediaId);
      expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    });
  },
);
