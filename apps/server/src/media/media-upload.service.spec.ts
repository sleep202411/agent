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
        expiresAt: '2026-07-17T13:00:00.000Z',
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
    mediaAsset: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: createAsset,
    },
    mediaAssetVariant: {
      upsert: jest.fn().mockResolvedValue({ id: VARIANT_ID }),
    },
    mediaObjectPlacement: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'placement-1' }),
    },
  };
  const prisma = {
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
    createUploadUrl: jest.fn(({ storageKey }: { storageKey: string }) =>
      Promise.resolve({
        url: 'https://r2.example.com/signed',
        method: 'PUT' as const,
        headers: { 'Content-Type': 'image/png' },
        storageKey,
        provider: 's3_compatible' as const,
        expiresAt: '2026-07-17T13:00:00.000Z',
      }),
    ),
  };
  const storageRegistry = {
    forProvider: jest.fn().mockReturnValue(r2Storage),
  };
  const mediaDurations = {
    probeObjectDuration: jest.fn().mockResolvedValue(8.5),
    ensureDurations: jest.fn().mockResolvedValue(new Map()),
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
    {} as never,
    workspacePermissions as never,
    uploadedImages as never,
    mediaDurations as never,
    storageRegistry as never,
  );
  return {
    service,
    storage,
    prisma,
    createAsset,
    workspacePermissions,
    readiness,
    tx,
    uploadedImages,
    r2Storage,
    storageRegistry,
  };
}

describe('MediaUploadService workspace-scoped generic uploads', () => {
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
      storageKey: issued.storageKey,
      scope: { crewId: 'crew-1' },
    });

    expect(fixture.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: MediaAssetKind.image,
          metadata: {
            uploadKind: 'crew_asset_file',
            crewId: 'crew-1',
          },
        }),
      }),
    );
  });

  it('issues a workspace-scoped Studio Agent document upload with a closed MIME policy', async () => {
    const fixture = serviceFixture();

    await expect(
      fixture.service.createUploadUrl(
        USER_ID,
        {
          kind: 'studio_agent_document',
          contentType: 'application/pdf',
          fileName: 'outline.pdf',
          sizeBytes: 1024,
        },
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      storageKey: expect.stringContaining(
        `/studio-agent-document/${USER_ID}/workspace-${WORKSPACE_ID}/`,
      ),
    });

    await expect(
      fixture.service.createUploadUrl(
        USER_ID,
        {
          kind: 'studio_agent_document',
          contentType: 'application/octet-stream',
          fileName: 'spoofed.pdf',
          sizeBytes: 1024,
        },
        WORKSPACE_ID,
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_CONTENT_TYPE_NOT_ALLOWED' },
    });
  });

  it('promotes and byte-probes Studio Agent images before readiness', async () => {
    const fixture = serviceFixture();
    const issued = await fixture.service.createUploadUrl(
      USER_ID,
      {
        kind: 'studio_agent_image',
        contentType: 'image/png',
        fileName: 'story-reference.png',
        sizeBytes: 1024,
      },
      WORKSPACE_ID,
    );

    expect(issued.storageKey).toContain(
      `/studio-agent-image-staging/${USER_ID}/workspace-${WORKSPACE_ID}/`,
    );

    await expect(
      fixture.service.confirmUpload(
        USER_ID,
        {
          kind: 'studio_agent_image',
          contentType: 'image/png',
          storageKey: issued.storageKey,
        },
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      mediaAssetId: ASSET_ID,
      storageKey: expect.stringContaining('/studio-agent-image-final/'),
    });

    expect(fixture.uploadedImages.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: expect.stringContaining('/studio-agent-image-final/'),
      }),
      { expectedContentType: 'image/png', maxBytes: 30 * 1024 * 1024 },
    );
    expect(fixture.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            uploadKind: 'studio_agent_image',
            storagePhase: 'immutable_final',
            inspectedBy: 'server_byte_probe',
          },
        }),
      }),
    );
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
