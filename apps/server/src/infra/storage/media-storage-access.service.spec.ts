import { ServiceUnavailableException } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import type { AzureBlobStorageService } from './azure-blob-storage.service';
import { MediaStorageAccessService } from './media-storage-access.service';
import type { AliyunOssStorageService } from './oss-storage.service';
import type { S3CompatibleStorageService } from './s3-storage.service';

describe(MediaStorageAccessService.name, () => {
  const azure = {
    headStoredObject: jest.fn(),
    promoteObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const oss = {
    headStoredObject: jest.fn(),
    promoteObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const s3 = {
    headStoredObject: jest.fn(),
    promoteObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const service = new MediaStorageAccessService(
    azure as unknown as AzureBlobStorageService,
    oss as unknown as AliyunOssStorageService,
    s3 as unknown as S3CompatibleStorageService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('HEADs the exact provider placement', async () => {
    s3.headStoredObject.mockResolvedValue({
      exists: true,
      sizeBytes: 42,
      contentType: 'video/mp4',
    });

    await expect(
      service.headObject({
        storageProvider: MediaStorageProvider.s3_compatible,
        bucket: 'story-media',
        region: 'auto',
        objectKey: 'staging/upload.mp4',
      }),
    ).resolves.toMatchObject({ exists: true, sizeBytes: 42 });
    expect(s3.headStoredObject).toHaveBeenCalledWith({
      bucket: 'story-media',
      region: 'auto',
      storageKey: 'staging/upload.mp4',
    });
  });

  it('promotes within the source provider placement to a server key', async () => {
    oss.promoteObject.mockResolvedValue({
      provider: 'aliyun_oss',
      bucket: 'story-media',
      region: 'cn-hangzhou',
      storageKey: 'final/random.mp4',
      sizeBytes: 42,
      contentType: 'video/mp4',
    });

    await service.promoteObject(
      {
        storageProvider: MediaStorageProvider.aliyun_oss,
        bucket: 'story-media',
        region: 'cn-hangzhou',
        objectKey: 'staging/upload.mp4',
      },
      {
        storageKey: 'final/random.mp4',
        contentType: 'video/mp4',
        expectedSizeBytes: 42,
      },
    );

    expect(oss.promoteObject).toHaveBeenCalledWith({
      source: {
        bucket: 'story-media',
        region: 'cn-hangzhou',
        storageKey: 'staging/upload.mp4',
      },
      destination: {
        bucket: 'story-media',
        region: 'cn-hangzhou',
        storageKey: 'final/random.mp4',
      },
      contentType: 'video/mp4',
      expectedSizeBytes: 42,
    });
  });

  it('routes idempotent deletion to the owning provider', async () => {
    azure.deleteObject.mockResolvedValue(undefined);
    await service.deleteObject({
      storageProvider: MediaStorageProvider.azure_blob,
      bucket: 'story-media',
      region: null,
      objectKey: 'staging/upload.mp4',
    });
    expect(azure.deleteObject).toHaveBeenCalledWith({
      bucket: 'story-media',
      region: null,
      storageKey: 'staging/upload.mp4',
    });
  });

  it('rejects non-object storage providers', async () => {
    await expect(
      service.headObject({
        storageProvider: MediaStorageProvider.external_url,
        bucket: null,
        region: null,
        objectKey: null,
        externalUrl: 'https://example.invalid/video.mp4',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
