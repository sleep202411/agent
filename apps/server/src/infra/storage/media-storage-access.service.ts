import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { AliyunOssStorageService } from './oss-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import type { CreateReadUrlResult } from './storage.types';

export interface MediaStorageReadRef {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType?: string | null;
}

export interface MediaStorageReadUrlResult {
  url: string;
  provider: string;
  bucket: string | null;
  objectKey: string | null;
  expiresAt: string | null;
}

@Injectable()
export class MediaStorageAccessService {
  constructor(
    private readonly azure: AzureBlobStorageService,
    private readonly oss: AliyunOssStorageService,
    private readonly s3: S3CompatibleStorageService,
  ) {}

  async createReadUrl(
    ref: MediaStorageReadRef,
    options: {
      cacheControl?: string | null;
      expiresInSeconds?: number;
      filename?: string | null;
    } = {},
  ): Promise<MediaStorageReadUrlResult> {
    if (ref.storageProvider === MediaStorageProvider.external_url) {
      if (!ref.externalUrl) {
        throw new ServiceUnavailableException(
          'external_url media object is missing externalUrl',
        );
      }
      return {
        url: ref.externalUrl,
        provider: MediaStorageProvider.external_url,
        bucket: null,
        objectKey: null,
        expiresAt: null,
      };
    }

    if (!ref.bucket || !ref.objectKey) {
      throw new ServiceUnavailableException(
        `${ref.storageProvider} media object is missing bucket/objectKey`,
      );
    }

    const signed = await this.signProviderReadUrl(
      { ...ref, bucket: ref.bucket, objectKey: ref.objectKey },
      {
        cacheControl: options.cacheControl,
        expiresInSeconds: options.expiresInSeconds,
        filename: options.filename,
      },
    );
    return {
      url: signed.url,
      provider: signed.provider,
      bucket: signed.bucket,
      objectKey: signed.storageKey,
      expiresAt: signed.expiresAt,
    };
  }

  private signProviderReadUrl(
    ref: MediaStorageReadRef & { bucket: string; objectKey: string },
    options: {
      cacheControl?: string | null;
      expiresInSeconds?: number;
      filename?: string | null;
    },
  ): Promise<CreateReadUrlResult> {
    const input = {
      bucket: ref.bucket,
      storageKey: ref.objectKey,
      region: ref.region,
      cacheControl: options.cacheControl ?? null,
      contentType: ref.contentType ?? null,
      filename: options.filename ?? null,
      expiresInSeconds: options.expiresInSeconds,
    };
    switch (ref.storageProvider) {
      case MediaStorageProvider.azure_blob:
        return this.azure.createReadUrl(input);
      case MediaStorageProvider.aliyun_oss:
        return this.oss.createReadUrl(input);
      case MediaStorageProvider.s3_compatible:
        return this.s3.createReadUrl(input);
      default:
        throw new ServiceUnavailableException(
          `unsupported media storage provider: ${ref.storageProvider}`,
        );
    }
  }
}
