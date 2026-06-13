import { Injectable } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { AliyunOssStorageService } from './oss-storage.service';
import type { OutputStorageService } from './storage.types';

/**
 * Resolves a concrete {@link OutputStorageService} by the provider an object
 * was actually stored under (`MediaAsset.storageProvider` /
 * `MediaObjectPlacement.storageProvider`), rather than the cell-default
 * binding from {@link StorageModule}.
 *
 * Moderation takedown must act on an asset's REAL location — a legacy OSS
 * object in the `.com` (Azure-default) cell still has to be flipped through
 * the OSS impl. The cell-default `OutputStorageService` token is wrong for
 * that; this registry maps the enum to the right instance.
 *
 * `external_url` has no object we control and `s3_compatible` has no impl
 * today, so both resolve to `null` — callers treat that as "no physical
 * takedown possible; the DTO moderation gate is the only enforcement".
 */
@Injectable()
export class StorageProviderRegistry {
  constructor(
    private readonly azure: AzureBlobStorageService,
    private readonly oss: AliyunOssStorageService,
  ) {}

  forProvider(provider: MediaStorageProvider): OutputStorageService | null {
    switch (provider) {
      case MediaStorageProvider.azure_blob:
        return this.azure;
      case MediaStorageProvider.aliyun_oss:
        return this.oss;
      default:
        return null;
    }
  }
}
