/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers and mock call order payloads are intentionally untyped. */
import {
  MediaAssetStatus,
  MediaStorageProvider,
  StoryVideoUploadStatus,
} from '@prisma/client';
import { StoryVideoUploadFinalizeWorkerService } from './story-video-upload-finalize-worker.service';

const SESSION_ID = '0197f4a2-0800-7000-8000-000000000001';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000002';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000003';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000004';
const STAGING_KEY = `media/global/story-clip-staging/${WORKSPACE_ID}/${SESSION_ID}.mp4`;
const FINAL_KEY = `media/global/story-clip-final/${WORKSPACE_ID}/${SESSION_ID}.mp4`;

function processingSession() {
  const now = new Date();
  return {
    id: SESSION_ID,
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    mediaAssetId: ASSET_ID,
    createdByUserId: 'user-1',
    status: StoryVideoUploadStatus.processing,
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'media',
    region: null,
    stagingObjectKey: STAGING_KEY,
    finalObjectKey: null,
    contentType: 'video/mp4',
    declaredSizeBytes: 1024n,
    actualSizeBytes: 1024n,
    expiresAt: new Date(now.getTime() + 60_000),
    reclaimAfter: null,
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: null,
    leaseOwner: expect.any(String),
    leaseAcquiredAt: now,
    leaseExpiresAt: new Date(now.getTime() + 45 * 60_000),
    errorCode: null,
    errorDetail: null,
    confirmedAt: now,
    queuedAt: now,
    processingAt: now,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    stagingReclaimedAt: null,
    finalReclaimedAt: null,
    createdAt: now,
    updatedAt: now,
    mediaAsset: {
      id: ASSET_ID,
      status: MediaAssetStatus.uploading,
      metadata: {},
    },
  };
}

function createFinalizeHarness() {
  const base = processingSession();
  const tx = {
    storyVideoUploadSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...base,
          leaseOwner: workerId,
          mediaAsset: base.mediaAsset,
        }),
      ),
      update: jest.fn().mockResolvedValue({ id: SESSION_ID }),
    },
    mediaAsset: { update: jest.fn().mockResolvedValue({ id: ASSET_ID }) },
    mediaAssetVariant: {
      upsert: jest.fn().mockResolvedValue({ id: 'variant-1' }),
    },
    mediaObjectPlacement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'placement-1' }),
    },
  };
  let workerId = '';
  const storyVideoUploadSession = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...base, leaseOwner: workerId }),
      ),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: SESSION_ID }]),
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    storyVideoUploadSession,
    mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const storage = {
    promoteObject: jest.fn().mockResolvedValue({
      provider: 'azure_blob',
      bucket: 'media',
      region: null,
      storageKey: FINAL_KEY,
      sizeBytes: 1024,
      contentType: 'video/mp4',
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const probe = {
    probe: jest.fn().mockResolvedValue({
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1024n,
      width: 1920,
      height: 1080,
      durationMs: 12100,
      durationSeconds: 12,
      durationSecondsExact: 12.1,
      hasAudio: true,
      contentType: 'video/mp4',
      fileExtension: 'mp4',
      videoCodec: 'h264',
      audioCodecs: ['aac'],
      browserSafeMp4: true,
    }),
  };
  const mediaProcessing = { enqueueJob: jest.fn() };
  const worker = new StoryVideoUploadFinalizeWorkerService(
    prisma as never,
    storage as never,
    probe as never,
    mediaProcessing as never,
  );
  workerId = (worker as unknown as { workerId: string }).workerId;
  return { worker, prisma, tx, storage, probe, storyVideoUploadSession };
}

describe('StoryVideoUploadFinalizeWorkerService', () => {
  it('claims before I/O, promotes before probing, and renews the lease after promotion', async () => {
    const harness = createFinalizeHarness();

    await harness.worker.drainOnce(1);

    expect(harness.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(harness.storage.promoteObject).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: STAGING_KEY }),
      expect.objectContaining({
        storageKey: FINAL_KEY,
        expectedSizeBytes: 1024,
      }),
    );
    expect(harness.probe.probe).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: FINAL_KEY }),
    );
    expect(harness.prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      harness.storage.promoteObject.mock.invocationCallOrder[0],
    );
    expect(
      harness.storage.promoteObject.mock.invocationCallOrder[0],
    ).toBeLessThan(harness.probe.probe.mock.invocationCallOrder[0]);
    expect(harness.storyVideoUploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: StoryVideoUploadStatus.processing,
          leaseOwner: expect.any(String),
          leaseExpiresAt: { gt: expect.any(Date) },
        }),
        data: expect.objectContaining({
          finalObjectKey: FINAL_KEY,
          leaseExpiresAt: expect.any(Date),
        }),
      }),
    );
    expect(harness.tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          objectKey: FINAL_KEY,
          status: MediaAssetStatus.ready,
        }),
      }),
    );
  });

  it('reclaims terminal staging again after its next tombstone deadline', async () => {
    const harness = createFinalizeHarness();
    const terminal = {
      ...processingSession(),
      leaseOwner: null,
      status: StoryVideoUploadStatus.ready,
      reclaimAfter: new Date(Date.now() - 1_000),
      stagingReclaimedAt: new Date(Date.now() - 60 * 60_000),
      completedAt: new Date(),
    };
    harness.prisma.$queryRaw.mockResolvedValue([]);
    harness.storyVideoUploadSession.findMany.mockImplementation(
      (query: { where?: { reclaimAfter?: { lte?: Date } } }) =>
        Promise.resolve(query.where?.reclaimAfter?.lte ? [terminal] : []),
    );

    await harness.worker.drainOnce(1);

    expect(harness.storage.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ objectKey: STAGING_KEY }),
    );
    expect(harness.storyVideoUploadSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reclaimAfter: { lte: expect.any(Date) },
        }),
        data: expect.objectContaining({
          stagingReclaimedAt: expect.any(Date),
          reclaimAfter: expect.any(Date),
        }),
      }),
    );
  });
});
