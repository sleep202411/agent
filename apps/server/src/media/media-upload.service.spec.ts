/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in upload lifecycle assertions. */
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  WorkspaceMemberRole,
} from '@prisma/client';
import { crewAssetStorageProviderForCell } from '../infra/storage/crew-asset-storage-policy';
import {
  CONTENT_REVIEW_VIDEO_MAX_BYTES,
  EPISODE_SOURCE_MAX_BYTES,
} from '@repo/shared';
import { MediaUploadService } from './media-upload.service';

const USER_ID = 'user-1';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const OTHER_WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000002';
const ASSET_ID = '0197f4a2-0800-7000-8000-000000000003';
const VARIANT_ID = '0197f4a2-0800-7000-8000-000000000004';

function uploadInput() {
  return {
    kind: 'ai_reference_image' as const,
    contentType: 'image/png',
    fileName: 'reference.png',
    sizeBytes: 1024,
  };
}

function serviceFixture() {
  const storage = {
    createUploadUrl: jest.fn(({ storageKey }: { storageKey: string }) =>
      Promise.resolve({
        url: 'https://storage.example.com/signed',
        method: 'PUT' as const,
        headers: { 'Content-Type': 'image/png' },
        storageKey,
        provider: 'azure_blob' as const,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    ),
    headObject: jest.fn((key: string) =>
      Promise.resolve(
        key.includes('-image-final/')
          ? { exists: false }
          : {
              exists: true,
              provider: 'azure_blob',
              bucket: 'media',
              region: 'eastus2',
              contentType: 'image/png',
              sizeBytes: 1024,
            },
      ),
    ),
    promoteObject: jest.fn(
      ({ destination }: { destination: { storageKey: string } }) =>
        Promise.resolve({
          provider: 'azure_blob' as const,
          bucket: 'media',
          region: 'eastus2',
          storageKey: destination.storageKey,
          sizeBytes: 1024,
          contentType: 'image/png',
        }),
    ),
    setCacheControl: jest.fn().mockResolvedValue(undefined),
  };
  const asset = {
    id: ASSET_ID,
    storageProvider: MediaStorageProvider.azure_blob,
    bucket: 'media',
    region: 'eastus2',
    objectKey: '',
    externalUrl: null,
    contentType: 'image/png',
    sizeBytes: 1024n,
    width: 640,
    height: 480,
    durationSeconds: null,
    checksumSha256: 'a'.repeat(64),
    workspaceId: WORKSPACE_ID,
    status: MediaAssetStatus.ready,
  };
  const createAsset = jest.fn(
    ({
      data,
    }: {
      data: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise.resolve({ ...asset, objectKey: data.objectKey as string }),
  );
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([
      {
        total: 100000000000n,
        used: 0n,
        reserved: 1024n,
        unknown: 0n,
        size_bytes: 1024n,
      },
    ]),
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: createAsset,
    },
    mediaAssetVariant: {
      upsert: jest.fn().mockResolvedValue({ id: VARIANT_ID }),
    },
    mediaProcessingJob: {
      upsert: jest.fn().mockResolvedValue({ id: 'poster-job-1' }),
    },
    mediaObjectPlacement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'placement-1' }),
    },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ size_bytes: 1024n }]),
    episodeUpload: { findUnique: jest.fn().mockResolvedValue(null) },
    mediaAsset: { findFirst: jest.fn().mockResolvedValue(null) },
    crew: {
      findFirst: jest.fn().mockResolvedValue({ id: 'crew-1' }),
    },
    crewMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest.fn().mockResolvedValue({}),
  };
  const storyPermissions = {
    requireProject: jest.fn().mockImplementation((_user, projectId) =>
      Promise.resolve({
        project: { id: projectId, workspaceId: WORKSPACE_ID },
      }),
    ),
  };
  const readiness = {
    enqueueAutomaticChecks: jest.fn().mockResolvedValue(undefined),
  };
  const uploadedImages = {
    probe: jest.fn().mockResolvedValue({
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1024n,
      width: 640,
      height: 480,
      contentType: 'image/png',
      fileExtension: 'png',
    }),
  };
  const r2Storage = {
    ...storage,
    promoteObject: jest.fn(
      ({
        destination,
        expectedSizeBytes,
        contentType,
      }: {
        destination: { storageKey: string; bucket: string; region: string };
        expectedSizeBytes: number;
        contentType: string;
      }) =>
        Promise.resolve({
          ...destination,
          provider: 's3_compatible' as const,
          sizeBytes: expectedSizeBytes,
          contentType,
        }),
    ),
    headStoredObject: jest.fn().mockResolvedValue({
      exists: true,
      provider: 's3_compatible',
      bucket: 'media',
      region: 'auto',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    }),
    createUploadUrl: jest.fn(({ storageKey }: { storageKey: string }) =>
      Promise.resolve({
        url: 'https://r2.example.com/signed',
        method: 'PUT' as const,
        headers: { 'Content-Type': 'image/png' },
        storageKey,
        provider: 's3_compatible' as const,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    ),
  };
  const storageRegistry = {
    forProvider: jest.fn().mockReturnValue(r2Storage),
  };
  const mediaFacts = {
    probeObjectDuration: jest.fn().mockResolvedValue(8.5),
    ensureFacts: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new MediaUploadService(
    prisma as never,
    storage as never,
    {
      resolve: jest
        .fn()
        .mockReturnValue('https://cdn.example.com/reference.png'),
    } as never,
    {} as never,
    readiness as never,
    workspacePermissions as never,
    uploadedImages as never,
    mediaFacts as never,
    storageRegistry as never,
    storyPermissions as never,
  );
  return {
    service,
    storage,
    prisma,
    createAsset,
    workspacePermissions,
    storyPermissions,
    readiness,
    tx,
    uploadedImages,
    r2Storage,
    storageRegistry,
  };
}

describe('MediaUploadService workspace-scoped generic uploads', () => {
  it('allows 35 GiB for episode sources and 2 GB for content-review videos', async () => {
    const { service } = serviceFixture();
    const source = {
      kind: 'episode_source_video' as const,
      contentType: 'video/mp4',
      fileName: 'episode.mp4',
      sizeBytes: EPISODE_SOURCE_MAX_BYTES,
    };
    await expect(service.prepareUpload(USER_ID, source)).resolves.toMatchObject(
      {
        policy: { maxBytes: EPISODE_SOURCE_MAX_BYTES },
      },
    );
    await expect(
      service.prepareUpload(USER_ID, {
        ...source,
        sizeBytes: EPISODE_SOURCE_MAX_BYTES + 1,
      }),
    ).rejects.toThrow();
    await expect(service.createUploadUrl(USER_ID, source)).rejects.toThrow(
      'Episode source videos require multipart upload',
    );
    await expect(
      service.createUploadUrl(USER_ID, {
        ...source,
        kind: 'content_review_video',
      }),
    ).rejects.toThrow('Content review videos require multipart upload');
    await expect(
      service.prepareUpload(USER_ID, {
        ...source,
        kind: 'content_review_video',
        sizeBytes: CONTENT_REVIEW_VIDEO_MAX_BYTES,
      }),
    ).resolves.toMatchObject({
      policy: { maxBytes: CONTENT_REVIEW_VIDEO_MAX_BYTES },
    });
    await expect(
      service.prepareUpload(USER_ID, {
        ...source,
        kind: 'content_review_video',
        sizeBytes: CONTENT_REVIEW_VIDEO_MAX_BYTES + 1,
      }),
    ).rejects.toThrow();
    await expect(
      service.prepareUpload(USER_ID, {
        ...source,
        kind: 'episode_video',
        sizeBytes: 2 * 1024 ** 3 + 1,
      }),
    ).rejects.toThrow();
  });

  it('pins crew storage to R2 globally and Alibaba OSS in the CN cell', () => {
    expect(crewAssetStorageProviderForCell('global')).toBe(
      MediaStorageProvider.s3_compatible,
    );
    expect(crewAssetStorageProviderForCell('com')).toBe(
      MediaStorageProvider.s3_compatible,
    );
    expect(crewAssetStorageProviderForCell('cn')).toBe(
      MediaStorageProvider.aliyun_oss,
    );
  });

  it('rejects Crew quota admission without returning a signed URL or creating an asset', async () => {
    const f = serviceFixture();
    f.tx.$queryRaw.mockResolvedValue([
      { total: 100n, used: 100n, reserved: 0n, unknown: 0n, size_bytes: 0n },
    ]);
    await expect(
      f.service.createUploadUrl(USER_ID, {
        kind: 'crew_asset_file',
        contentType: 'image/png',
        fileName: 'a.png',
        sizeBytes: 1,
        scope: { crewId: 'crew-1' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_STORAGE_QUOTA_EXCEEDED' },
    });
    expect(f.createAsset).not.toHaveBeenCalled();
  });
  it('rejects cancelled Crew confirmation before copying or creating an asset', async () => {
    const f = serviceFixture();
    const { storageKey } = await f.service.prepareUpload(USER_ID, {
      kind: 'crew_asset_file',
      contentType: 'image/png',
      fileName: 'a.png',
      sizeBytes: 1,
      scope: { crewId: 'crew-1' },
    });
    f.prisma.$queryRaw.mockResolvedValue([]);
    await expect(
      f.service.confirmUpload(USER_ID, {
        kind: 'crew_asset_file',
        contentType: 'image/png',
        storageKey,
        scope: { crewId: 'crew-1' },
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_UPLOAD_RESERVATION_EXPIRED' },
    });
    expect(f.r2Storage.promoteObject).not.toHaveBeenCalled();
    expect(f.createAsset).not.toHaveBeenCalled();
  });

  it('routes global crew asset uploads to Cloudflare R2 with a crew-bound key', async () => {
    const fixture = serviceFixture();

    await expect(
      fixture.service.createUploadUrl(USER_ID, {
        kind: 'crew_asset_file',
        contentType: 'image/png',
        fileName: 'concept.png',
        sizeBytes: 1024,
        scope: { crewId: 'crew-1' },
      }),
    ).resolves.toMatchObject({
      provider: 's3_compatible',
      storageKey: expect.stringContaining(
        '/crew-asset-file/user-1/crew-crew-1/',
      ),
    });

    expect(fixture.storageRegistry.forProvider).toHaveBeenCalledWith(
      MediaStorageProvider.s3_compatible,
    );
    expect(fixture.r2Storage.createUploadUrl).toHaveBeenCalled();
    expect(fixture.storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('preserves the intrinsic media kind when a crew upload is confirmed', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(USER_ID, {
      kind: 'crew_asset_file',
      contentType: 'image/png',
      fileName: 'concept.png',
      sizeBytes: 1024,
      scope: { crewId: 'crew-1' },
    });
    fixture.r2Storage.headObject.mockResolvedValue({
      exists: true,
      provider: 's3_compatible',
      bucket: 'crew-assets',
      region: 'auto',
      contentType: 'image/png',
      sizeBytes: 1024,
    });

    await fixture.service.confirmUpload(USER_ID, {
      kind: 'crew_asset_file',
      contentType: 'image/png',
      fileName: 'concept.png',
      storageKey: issued.storageKey,
      scope: { crewId: 'crew-1' },
    });

    expect(fixture.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: MediaAssetKind.image,
          objectKey: expect.stringContaining('/crew-asset-final/'),
          metadata: {
            uploadKind: 'crew_asset_file',
            fileName: 'concept.png',
            crewId: 'crew-1',
          },
        }),
      }),
    );
  });

  it('uploads for a project editor without requiring workspace membership', async () => {
    const f = serviceFixture();
    f.workspacePermissions.requireWorkspaceRole.mockRejectedValue(
      new Error('workspace denied'),
    );
    const scope = { storyProjectId: ASSET_ID };
    const issued = await f.service.createUploadUrl(
      USER_ID,
      { ...uploadInput(), scope },
      OTHER_WORKSPACE_ID,
    );
    expect(issued.storageKey).toContain(
      `/workspace-${WORKSPACE_ID}/story-${ASSET_ID}/`,
    );
    await f.service.confirmUpload(USER_ID, {
      kind: 'ai_reference_image',
      contentType: 'image/png',
      storageKey: issued.storageKey,
      scope,
    });
    expect(f.workspacePermissions.requireWorkspaceRole).not.toHaveBeenCalled();
    expect(f.storyPermissions.requireProject).toHaveBeenCalledTimes(2);
    expect(f.storyPermissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      ASSET_ID,
      'story.edit',
    );
    expect(f.createAsset.mock.calls[0]?.[0]?.data).toMatchObject({
      workspaceId: WORKSPACE_ID,
      metadata: { storyProjectId: ASSET_ID },
    });
  });

  it('rejects a viewer before issuing storage access', async () => {
    const f = serviceFixture();
    f.storyPermissions.requireProject.mockRejectedValue(
      new Error('project edit denied'),
    );
    await expect(
      f.service.createUploadUrl(USER_ID, {
        ...uploadInput(),
        scope: { storyProjectId: ASSET_ID },
      }),
    ).rejects.toThrow('project edit denied');
    expect(f.storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rechecks project permission at confirmation', async () => {
    const f = serviceFixture();
    const scope = { storyProjectId: ASSET_ID };
    const issued = await f.service.createUploadUrl(USER_ID, {
      ...uploadInput(),
      scope,
    });
    f.storyPermissions.requireProject.mockRejectedValue(
      new Error('project access revoked'),
    );
    await expect(
      f.service.confirmUpload(USER_ID, {
        kind: 'ai_reference_image',
        contentType: 'image/png',
        storageKey: issued.storageKey,
        scope,
      }),
    ).rejects.toThrow('project access revoked');
    expect(f.storage.headObject).not.toHaveBeenCalled();
    expect(f.createAsset).not.toHaveBeenCalled();
  });

  it('does not allow confirmation into a different project in the same workspace', async () => {
    const f = serviceFixture();
    const issued = await f.service.createUploadUrl(USER_ID, {
      ...uploadInput(),
      scope: { storyProjectId: ASSET_ID },
    });
    await expect(
      f.service.confirmUpload(USER_ID, {
        kind: 'ai_reference_image',
        contentType: 'image/png',
        storageKey: issued.storageKey,
        scope: { storyProjectId: VARIANT_ID },
      }),
    ).rejects.toMatchObject({ response: { code: 'MEDIA_KEY_SCOPE_MISMATCH' } });
    expect(f.storage.headObject).not.toHaveBeenCalled();
    expect(f.createAsset).not.toHaveBeenCalled();
  });

  it('binds issue and confirm to one workspace and persists that ownership', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      uploadInput(),
      WORKSPACE_ID,
    );

    expect(issued.storageKey).toContain(
      `/ai-reference-image-staging/${USER_ID}/workspace-${WORKSPACE_ID}/`,
    );

    await expect(
      fixture.service.confirmUpload(
        USER_ID,
        {
          kind: 'ai_reference_image',
          contentType: 'image/png',
          storageKey: issued.storageKey,
        },
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      mediaAssetId: ASSET_ID,
      variantId: VARIANT_ID,
      storageKey: expect.stringContaining('/ai-reference-image-final/'),
    });

    expect(
      fixture.workspacePermissions.requireWorkspaceRole,
    ).toHaveBeenCalledTimes(2);
    expect(
      fixture.workspacePermissions.requireWorkspaceRole,
    ).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      WORKSPACE_ID,
      WorkspaceMemberRole.viewer,
    );
    expect(fixture.createAsset).toHaveBeenCalledTimes(1);
    const createCall = fixture.createAsset.mock.calls[0]?.[0];
    expect(createCall?.data).toMatchObject({
      kind: MediaAssetKind.image,
      visibility: MediaAssetVisibility.private,
      status: MediaAssetStatus.ready,
      source: MediaAssetSource.user_upload,
      createdByUserId: USER_ID,
      workspaceId: WORKSPACE_ID,
      objectKey: expect.stringContaining('/ai-reference-image-final/'),
      contentType: 'image/png',
      sizeBytes: 1024n,
      width: 640,
      height: 480,
      checksumSha256: 'a'.repeat(64),
    });
    expect(createCall?.select).toBeDefined();
    expect(fixture.storage.promoteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ storageKey: issued.storageKey }),
        destination: expect.objectContaining({
          storageKey: expect.stringContaining('/ai-reference-image-final/'),
        }),
      }),
    );
    expect(fixture.uploadedImages.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringContaining('/ai-reference-image-final/'),
      }),
      { expectedContentType: 'image/png', maxBytes: 30 * 1024 * 1024 },
    );
    expect(fixture.tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          width: 640,
          height: 480,
          checksumSha256: 'a'.repeat(64),
        }),
      }),
    );
    expect(fixture.readiness.enqueueAutomaticChecks).toHaveBeenCalledWith(
      ASSET_ID,
    );
    expect(fixture.tx.mediaObjectPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assetId: ASSET_ID,
          variantId: VARIANT_ID,
          storageProvider: MediaStorageProvider.azure_blob,
          bucket: 'media',
          region: 'eastus2',
          objectKey: expect.stringContaining('/ai-reference-image-final/'),
        }),
      }),
    );
  });

  it('rejects a key issued for another workspace before reading storage', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      uploadInput(),
      WORKSPACE_ID,
    );

    await expect(
      fixture.service.confirmUpload(
        USER_ID,
        {
          kind: 'ai_reference_image',
          contentType: 'image/png',
          storageKey: issued.storageKey,
        },
        OTHER_WORKSPACE_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_KEY_SCOPE_MISMATCH' },
    });
    expect(fixture.storage.headObject).not.toHaveBeenCalled();
    expect(fixture.prisma.mediaAsset.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a malformed workspace header before minting a signed URL', async () => {
    const fixture = serviceFixture();

    await expect(
      fixture.service.createUploadUrl(
        USER_ID,
        uploadInput(),
        'not-a-workspace',
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_WORKSPACE_ID_INVALID' },
    });
    expect(
      fixture.workspacePermissions.requireWorkspaceRole,
    ).not.toHaveBeenCalled();
    expect(fixture.storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('recovers idempotently from promotion succeeding before the database commit', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      uploadInput(),
      WORKSPACE_ID,
    );
    fixture.storage.headObject.mockImplementation((key: string) =>
      Promise.resolve(
        key.includes('/ai-reference-image-final/')
          ? {
              exists: true,
              provider: 'azure_blob',
              bucket: 'media',
              region: 'eastus2',
              contentType: 'image/png',
              sizeBytes: 1024,
            }
          : { exists: false },
      ),
    );

    await expect(
      fixture.service.confirmUpload(
        USER_ID,
        {
          kind: 'ai_reference_image',
          contentType: 'image/png',
          storageKey: issued.storageKey,
        },
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      mediaAssetId: ASSET_ID,
      storageKey: expect.stringContaining('/ai-reference-image-final/'),
    });

    expect(fixture.storage.headObject).toHaveBeenCalledTimes(1);
    expect(fixture.storage.promoteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ storageKey: issued.storageKey }),
        destination: expect.objectContaining({
          storageKey: expect.stringContaining('/ai-reference-image-final/'),
        }),
        expectedSizeBytes: 1024,
      }),
    );
    expect(fixture.uploadedImages.probe).toHaveBeenCalledTimes(1);
  });

  it('converges concurrent commits under the final-key advisory lock', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      uploadInput(),
      WORKSPACE_ID,
    );
    fixture.tx.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'media',
      region: 'eastus2',
      objectKey: issued.storageKey.replace(
        '/ai-reference-image-staging/',
        '/ai-reference-image-final/',
      ),
      externalUrl: null,
      contentType: 'image/png',
      sizeBytes: 1024n,
      width: 640,
      height: 480,
      durationSeconds: null,
      checksumSha256: 'a'.repeat(64),
      workspaceId: WORKSPACE_ID,
      status: MediaAssetStatus.ready,
    });

    await fixture.service.confirmUpload(
      USER_ID,
      {
        kind: 'ai_reference_image',
        contentType: 'image/png',
        storageKey: issued.storageKey,
      },
      WORKSPACE_ID,
    );

    expect(fixture.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fixture.createAsset).not.toHaveBeenCalled();
    expect(fixture.tx.mediaAssetVariant.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns a video committed by another confirmation without image validation', async () => {
    const fixture = serviceFixture();
    const { storageKey } = await fixture.service.prepareUpload(USER_ID, {
      kind: 'episode_source_video',
      contentType: 'video/mp4',
      fileName: 'episode.mp4',
      sizeBytes: 1024,
    });
    fixture.prisma.episodeUpload.findUnique.mockResolvedValue({
      userId: USER_ID,
      workspaceId: null,
      status: 'uploaded',
      storageKey,
      provider: MediaStorageProvider.s3_compatible,
      bucket: 'media',
      region: 'auto',
      sizeBytes: 1024n,
      contentType: 'video/mp4',
    });
    // The first lookup misses; another request commits before this transaction.
    fixture.tx.mediaAsset.findFirst.mockResolvedValue({
      id: ASSET_ID,
      storageProvider: MediaStorageProvider.s3_compatible,
      bucket: 'media',
      region: 'auto',
      objectKey: storageKey,
      externalUrl: null,
      contentType: 'video/mp4',
      sizeBytes: 1024n,
      width: null,
      height: null,
      durationSeconds: 8.5,
      checksumSha256: null,
      workspaceId: null,
      status: MediaAssetStatus.ready,
    });

    await expect(
      fixture.service.confirmUpload(USER_ID, {
        kind: 'episode_source_video',
        contentType: 'video/mp4',
        storageKey,
      }),
    ).resolves.toMatchObject({ mediaAssetId: ASSET_ID, storageKey });
    expect(fixture.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fixture.createAsset).not.toHaveBeenCalled();
    expect(fixture.uploadedImages.probe).not.toHaveBeenCalled();
  });

  it('enforces the byte cap from storage HEAD before promotion', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      uploadInput(),
      WORKSPACE_ID,
    );
    fixture.storage.headObject.mockImplementation((key: string) =>
      Promise.resolve(
        key.includes('/ai-reference-image-final/')
          ? { exists: false }
          : {
              exists: true,
              provider: 'azure_blob',
              bucket: 'media',
              region: 'eastus2',
              contentType: 'image/png',
              sizeBytes: 30 * 1024 * 1024 + 1,
            },
      ),
    );

    await expect(
      fixture.service.confirmUpload(
        USER_ID,
        {
          kind: 'ai_reference_image',
          contentType: 'image/png',
          storageKey: issued.storageKey,
        },
        WORKSPACE_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_FILE_TOO_LARGE' },
    });
    expect(fixture.storage.promoteObject).not.toHaveBeenCalled();
    expect(fixture.uploadedImages.probe).not.toHaveBeenCalled();
    expect(fixture.createAsset).not.toHaveBeenCalled();
  });
});

describe('generic upload confirmation byte limits', () => {
  it('rejects actual stored bytes above the kind limit despite a small declaration', async () => {
    const f = serviceFixture();
    const issued = await f.service.createUploadUrl(USER_ID, {
      kind: 'episode_video',
      contentType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes: 1024,
    });
    f.storage.headObject.mockResolvedValue({
      exists: true,
      provider: 'azure_blob',
      bucket: 'media',
      region: 'eastus2',
      contentType: 'video/mp4',
      sizeBytes: 2 * 1024 ** 3 + 1,
    });
    await expect(
      f.service.confirmUpload(USER_ID, {
        kind: 'episode_video',
        contentType: 'video/mp4',
        storageKey: issued.storageKey,
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(f.createAsset).not.toHaveBeenCalled();
  });
});

describe('generic upload stored-size metadata', () => {
  it.each([
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    'rejects invalid stored size %s before recording an asset',
    async (sizeBytes) => {
      const f = serviceFixture();
      const issued = await f.service.createUploadUrl(USER_ID, {
        kind: 'episode_video',
        contentType: 'video/mp4',
        fileName: 'clip.mp4',
        sizeBytes: 1024,
      });
      f.storage.headObject.mockResolvedValue({
        exists: true,
        provider: 'azure_blob',
        bucket: 'media',
        region: 'eastus2',
        contentType: 'video/mp4',
        sizeBytes,
      } as never);
      await expect(
        f.service.confirmUpload(USER_ID, {
          kind: 'episode_video',
          contentType: 'video/mp4',
          storageKey: issued.storageKey,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(f.createAsset).not.toHaveBeenCalled();
      expect(f.storage.setCacheControl).not.toHaveBeenCalled();
    },
  );
  it('accepts exactly the kind limit', async () => {
    const f = serviceFixture();
    const sizeBytes = 2 * 1024 ** 3;
    const issued = await f.service.createUploadUrl(USER_ID, {
      kind: 'episode_video',
      contentType: 'video/mp4',
      fileName: 'clip.mp4',
      sizeBytes,
    });
    f.storage.headObject.mockResolvedValue({
      exists: true,
      provider: 'azure_blob',
      bucket: 'media',
      region: 'eastus2',
      contentType: 'video/mp4',
      sizeBytes,
    });
    await expect(
      f.service.confirmUpload(USER_ID, {
        kind: 'episode_video',
        contentType: 'video/mp4',
        storageKey: issued.storageKey,
      }),
    ).resolves.toHaveProperty('mediaAssetId');
    expect(f.createAsset).toHaveBeenCalled();
  });
});

describe('workspace icon uploads', () => {
  it('enforces image types and the 5 MB cap before issuing a URL', async () => {
    const fixture = serviceFixture();
    for (const override of [
      { contentType: 'image/svg+xml' },
      { sizeBytes: 5 * 1024 * 1024 + 1 },
    ]) {
      await expect(
        fixture.service.prepareUpload(USER_ID, {
          ...uploadInput(),
          kind: 'workspace_icon',
          ...override,
        }),
      ).rejects.toThrow();
    }
    expect(fixture.storage.createUploadUrl).not.toHaveBeenCalled();
  });
  it('verifies personal icon bytes before returning a durable image for workspace creation', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.prepareUpload(USER_ID, {
      ...uploadInput(),
      kind: 'workspace_icon',
    });
    expect(issued.storageKey).toContain('/personal/');
    await expect(
      fixture.service.confirmUpload(USER_ID, {
        kind: 'workspace_icon',
        contentType: 'image/png',
        storageKey: issued.storageKey,
      }),
    ).resolves.toMatchObject({
      storageKey: expect.stringContaining('/workspace-icon-image-final/'),
    });
    expect(fixture.uploadedImages.probe).toHaveBeenCalledWith(
      expect.anything(),
      { expectedContentType: 'image/png', maxBytes: 5 * 1024 * 1024 },
    );
    await expect(
      fixture.service.confirmUpload('another-user', {
        kind: 'workspace_icon',
        contentType: 'image/png',
        storageKey: issued.storageKey,
      }),
    ).rejects.toThrow();
  });
});
