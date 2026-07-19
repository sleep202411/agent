/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in upload lifecycle assertions. */
import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetStatus,
  MediaStorageProvider,
  StoryVideoUploadStatus,
} from '@prisma/client';
import { StoryVideoUploadSessionService } from './story-video-upload-session.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const SESSION_ID = '0197f4a2-0800-7000-8000-000000000003';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000004';

function uploadSession() {
  return {
    id: SESSION_ID,
    storyProjectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    mediaAssetId: ASSET_ID,
    createdByUserId: USER_ID,
    status: StoryVideoUploadStatus.issued,
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'media',
    region: null,
    stagingObjectKey: `media/global/story-clip-staging/${WORKSPACE_ID}/${SESSION_ID}.mp4`,
    finalObjectKey: null,
    contentType: 'video/mp4',
    declaredSizeBytes: 1024n,
    actualSizeBytes: null,
    expiresAt: new Date(Date.now() + 60_000),
    mediaAsset: { id: ASSET_ID, status: MediaAssetStatus.uploading },
  };
}

function createHarness() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    storyVideoUploadSession: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { declaredSizeBytes: null },
      }),
      create: jest.fn().mockResolvedValue({ id: SESSION_ID }),
      findUnique: jest.fn().mockResolvedValue(uploadSession()),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...uploadSession(),
          ...data,
          status: StoryVideoUploadStatus.confirmed,
          actualSizeBytes: 1024n,
        }),
      ),
    },
    mediaAsset: {
      create: jest.fn().mockResolvedValue({ id: ASSET_ID }),
      update: jest.fn().mockResolvedValue({ id: ASSET_ID }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    storyVideoUploadSession: {
      findFirst: jest.fn().mockResolvedValue(uploadSession()),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (client: typeof tx) => Promise<unknown>)(tx);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
    }),
  };
  const outputStorage = {
    createUploadUrl: jest.fn().mockImplementation(({ storageKey }) =>
      Promise.resolve({
        url: 'https://upload.example.test/signed',
        method: 'PUT',
        headers: { 'content-type': 'video/mp4' },
        storageKey,
        provider: 'azure_blob',
        bucket: 'media',
        region: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ),
  };
  const storageAccess = {
    headObject: jest.fn().mockResolvedValue({
      exists: true,
      provider: 'azure_blob',
      bucket: 'media',
      region: null,
      sizeBytes: 1024,
      contentType: 'video/mp4',
    }),
  };
  const writeGuard = {
    assertHumanWriteAllowed: jest.fn().mockResolvedValue(undefined),
  };
  return {
    tx,
    prisma,
    permissions,
    outputStorage,
    storageAccess,
    writeGuard,
    service: new StoryVideoUploadSessionService(
      prisma as never,
      permissions as never,
      outputStorage as never,
      storageAccess as never,
      writeGuard as never,
    ),
  };
}

describe('StoryVideoUploadSessionService', () => {
  it('does not persist an upload reservation when the project lock is owned by Agent apply', async () => {
    const harness = createHarness();
    const locked = new Error('agent applying');
    harness.writeGuard.assertHumanWriteAllowed.mockRejectedValueOnce(locked);

    await expect(
      harness.service.issue(USER_ID, WORKSPACE_ID, {
        kind: 'story_clip_video',
        contentType: 'video/mp4',
        fileName: 'clip.mp4',
        sizeBytes: 1024,
        scope: { projectId: PROJECT_ID },
      }),
    ).rejects.toBe(locked);
    expect(harness.writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      harness.tx,
      PROJECT_ID,
    );
    expect(harness.tx.mediaAsset.create).not.toHaveBeenCalled();
    expect(harness.tx.storyVideoUploadSession.create).not.toHaveBeenCalled();
  });

  it('rejects Story URL issuance without an explicit workspace binding', async () => {
    const harness = createHarness();

    await expect(
      harness.service.issue(USER_ID, undefined, {
        kind: 'story_clip_video',
        contentType: 'video/mp4',
        fileName: 'clip.mp4',
        sizeBytes: 1024,
        scope: { projectId: PROJECT_ID },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.outputStorage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects MOV/WebM containers so every player receives MP4', async () => {
    const harness = createHarness();

    await expect(
      harness.service.issue(USER_ID, WORKSPACE_ID, {
        kind: 'story_clip_video',
        contentType: 'video/quicktime',
        fileName: 'clip.mov',
        sizeBytes: 1024,
        scope: { projectId: PROJECT_ID },
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'MEDIA_CONTENT_TYPE_NOT_ALLOWED' },
    });
    expect(harness.outputStorage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('persists the project-scoped staging ledger before returning the signed URL', async () => {
    const harness = createHarness();

    const result = await harness.service.issue(USER_ID, WORKSPACE_ID, {
      kind: 'story_clip_video',
      contentType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: 1024,
      scope: { projectId: PROJECT_ID },
    });

    expect(result).toMatchObject({
      provider: 'azure_blob',
      uploadSessionId: expect.any(String),
      mediaAssetId: expect.any(String),
    });
    expect(harness.tx.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          status: MediaAssetStatus.uploading,
          objectKey: expect.stringContaining('/story-clip-staging/'),
        }),
      }),
    );
    expect(harness.tx.storyVideoUploadSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          declaredSizeBytes: 1024n,
        }),
      }),
    );
  });

  it('HEAD-validates exact actual size and refuses a declared-size mismatch', async () => {
    const harness = createHarness();
    harness.storageAccess.headObject.mockResolvedValue({
      exists: true,
      provider: 'azure_blob',
      bucket: 'media',
      region: null,
      sizeBytes: 1023,
      contentType: 'video/mp4',
    });

    await expect(
      harness.service.confirm(USER_ID, WORKSPACE_ID, {
        kind: 'story_clip_video',
        contentType: 'video/mp4',
        storageKey: uploadSession().stagingObjectKey,
        uploadSessionId: SESSION_ID,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(harness.tx.mediaAsset.update).not.toHaveBeenCalled();
  });

  it('confirms a provider-HEAD-verified staging object without making it ready', async () => {
    const harness = createHarness();

    await expect(
      harness.service.confirm(USER_ID, WORKSPACE_ID, {
        kind: 'story_clip_video',
        contentType: 'video/mp4',
        storageKey: uploadSession().stagingObjectKey,
        uploadSessionId: SESSION_ID,
      }),
    ).resolves.toMatchObject({
      mediaAssetId: ASSET_ID,
      variantId: null,
      uploadSessionId: SESSION_ID,
      url: null,
    });
    expect(harness.tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID },
        data: expect.not.objectContaining({ status: MediaAssetStatus.ready }),
      }),
    );
    expect(harness.tx.storyVideoUploadSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: StoryVideoUploadStatus.confirmed,
          actualSizeBytes: 1024n,
        }),
      }),
    );
  });
});
