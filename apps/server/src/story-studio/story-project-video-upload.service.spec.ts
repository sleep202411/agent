/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in upload lifecycle assertions. */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StoryVideoUploadStatus } from '@prisma/client';
import { StoryProjectVideoLibraryService } from './story-project-video-library.service';

const USER = { userId: 'user-1' };
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const OTHER_WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000099';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';
const SESSION_ID = '0197f4a2-0800-7000-8000-000000000004';

function session(
  status: StoryVideoUploadStatus,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: SESSION_ID,
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    mediaAssetId: ASSET_ID,
    createdByUserId: USER.userId,
    status,
    storageProvider: 'azure_blob',
    bucket: 'media',
    region: null,
    stagingObjectKey: `staging/${SESSION_ID}.mp4`,
    finalObjectKey: null,
    contentType: 'video/mp4',
    declaredSizeBytes: 1024n,
    actualSizeBytes: 1024n,
    expiresAt: new Date(Date.now() + 60_000),
    reclaimAfter: null,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    errorCode: null,
    errorDetail: null,
    confirmedAt: new Date(),
    queuedAt: null,
    processingAt: null,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    stagingReclaimedAt: null,
    finalReclaimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createHarness(
  options: {
    initial?: ReturnType<typeof session>;
    afterUpdate?: ReturnType<typeof session>;
    projectWorkspaceId?: string;
  } = {},
) {
  const initial = options.initial ?? session(StoryVideoUploadStatus.confirmed);
  const afterUpdate =
    options.afterUpdate ?? session(StoryVideoUploadStatus.queued);
  const storyVideoUploadSession = {
    findUnique: jest.fn().mockResolvedValue(initial),
    findUniqueOrThrow: jest.fn().mockResolvedValue(afterUpdate),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = {
    storyVideoUploadSession,
    mediaAsset: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: unknown) => Promise<unknown>) =>
      callback({
        storyVideoUploadSession,
        mediaAsset: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      }),
    ),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: {
        id: PROJECT_ID,
        workspaceId: options.projectWorkspaceId ?? WORKSPACE_ID,
      },
    }),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    permissions,
    writeGuard,
    service: new StoryProjectVideoLibraryService(
      prisma as never,
      permissions as never,
      writeGuard as never,
    ),
  };
}

describe('StoryProjectVideoLibraryService async upload finalization', () => {
  it('checks the authoritative project lock inside the queue transaction', async () => {
    const harness = createHarness();
    const locked = new Error('agent applying');
    harness.writeGuard.assertHumanWriteAllowed.mockRejectedValueOnce(locked);

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBe(locked);
    expect(harness.writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
    );
    expect(
      harness.prisma.storyVideoUploadSession.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('atomically queues a confirmed session without doing storage I/O', async () => {
    const harness = createHarness();

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).resolves.toEqual({
      mediaAssetId: ASSET_ID,
      status: 'queued',
      pollAfterMs: 1500,
      item: null,
      error: null,
    });
    expect(
      harness.prisma.storyVideoUploadSession.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SESSION_ID,
          storyProjectId: PROJECT_ID,
          status: StoryVideoUploadStatus.confirmed,
        },
        data: expect.objectContaining({
          status: StoryVideoUploadStatus.queued,
        }),
      }),
    );
  });

  it('returns an already-processing session idempotently', async () => {
    const processing = session(StoryVideoUploadStatus.processing);
    const harness = createHarness({ initial: processing });

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).resolves.toMatchObject({
      status: 'processing',
      pollAfterMs: 1500,
      error: null,
    });
    expect(
      harness.prisma.storyVideoUploadSession.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('rejects start before storage confirmation', async () => {
    const harness = createHarness({
      initial: session(StoryVideoUploadStatus.issued),
    });

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps upload polling read-only while reporting an elapsed session', async () => {
    const harness = createHarness({
      initial: session(StoryVideoUploadStatus.confirmed, {
        expiresAt: new Date(Date.now() - 1_000),
      }),
    });

    await expect(
      harness.service.getUploadFinalize(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        ASSET_ID,
      ),
    ).resolves.toMatchObject({
      status: 'expired',
      error: { code: 'STORY_VIDEO_UPLOAD_EXPIRED' },
    });
    expect(harness.permissions.requireProject).toHaveBeenCalledWith(
      USER.userId,
      PROJECT_ID,
      'story.read',
    );
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.writeGuard.assertHumanWriteAllowed).not.toHaveBeenCalled();
  });

  it('hides sessions owned by another uploader', async () => {
    const harness = createHarness({
      initial: session(StoryVideoUploadStatus.confirmed, {
        createdByUserId: 'other-user',
      }),
    });

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a project selected through the wrong workspace header', async () => {
    const harness = createHarness({ projectWorkspaceId: OTHER_WORKSPACE_ID });

    await expect(
      harness.service.completeUpload(USER as never, WORKSPACE_ID, PROJECT_ID, {
        mediaAssetId: ASSET_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      harness.prisma.storyVideoUploadSession.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('does not cancel a worker-owned processing session', async () => {
    const harness = createHarness({
      initial: session(StoryVideoUploadStatus.processing),
    });

    await expect(
      harness.service.cancelUploadFinalize(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        ASSET_ID,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_VIDEO_FINALIZE_ALREADY_PROCESSING',
      }),
    });
  });

  it('returns a non-null terminal cancellation error', async () => {
    const cancelled = session(StoryVideoUploadStatus.cancelled, {
      errorCode: 'STORY_VIDEO_UPLOAD_CANCELLED',
      errorDetail: 'The Story video upload was cancelled.',
    });
    const harness = createHarness({
      initial: session(StoryVideoUploadStatus.queued),
      afterUpdate: cancelled,
    });

    await expect(
      harness.service.cancelUploadFinalize(
        USER as never,
        WORKSPACE_ID,
        PROJECT_ID,
        ASSET_ID,
      ),
    ).resolves.toMatchObject({
      status: 'cancelled',
      pollAfterMs: null,
      error: {
        code: 'STORY_VIDEO_UPLOAD_CANCELLED',
        message: 'The Story video upload was cancelled.',
      },
    });
  });
});
