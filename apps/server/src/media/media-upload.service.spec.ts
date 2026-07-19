/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped in upload lifecycle assertions. */
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
  WorkspaceMemberRole,
} from '@prisma/client';
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
        key.includes('/ai-reference-image-final/')
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
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const workspacePermissions = {
    requireWorkspaceRole: jest.fn().mockResolvedValue({}),
  };
  const providerAssets = {
    enqueueImageAssetRegistration: jest.fn().mockResolvedValue(undefined),
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
  const service = new MediaUploadService(
    prisma as never,
    storage as never,
    {
      resolve: jest
        .fn()
        .mockReturnValue('https://cdn.example.com/reference.png'),
    } as never,
    {} as never,
    providerAssets as never,
    {} as never,
    workspacePermissions as never,
    uploadedImages as never,
  );
  return {
    service,
    storage,
    prisma,
    createAsset,
    workspacePermissions,
    tx,
    uploadedImages,
  };
}

describe('MediaUploadService workspace-scoped generic uploads', () => {
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
