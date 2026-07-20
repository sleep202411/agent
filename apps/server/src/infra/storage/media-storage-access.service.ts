import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import { AzureBlobStorageService } from './azure-blob-storage.service';
import { AliyunOssStorageService } from './oss-storage.service';
import { S3CompatibleStorageService } from './s3-storage.service';
import {
  OutputStorageService,
  type CreateReadUrlResult,
  type HeadObjectResult,
  type PromoteStorageObjectResult,
  type StorageObjectRef,
} from './storage.types';

export interface MediaStorageObjectRef {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl?: string | null;
  contentType?: string | null;
}

export interface MediaStorageReadRef extends MediaStorageObjectRef {
  externalUrl: string | null;
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

  /** Provider-aware HEAD for a persisted media placement. */
  async headObject(ref: MediaStorageObjectRef): Promise<HeadObjectResult> {
    const resolved = this.resolveStoredProvider(ref);
    return resolved.provider.headStoredObject(resolved.object);
  }

  /**
   * Server-side staging -> unsigned final promotion. The destination stays in
   * the source placement's provider/bucket/region; only its random key changes.
   * Callers must probe this returned final placement, never staging.
   */
  async promoteObject(
    sourceRef: MediaStorageObjectRef,
    input: {
      storageKey: string;
      contentType: string;
      expectedSizeBytes: number;
      cacheControl?: string;
    },
  ): Promise<PromoteStorageObjectResult> {
    const resolved = this.resolveStoredProvider(sourceRef);
    return resolved.provider.promoteObject({
      source: resolved.object,
      destination: {
        bucket: resolved.object.bucket,
        region: resolved.object.region,
        storageKey: input.storageKey,
      },
      expectedSizeBytes: input.expectedSizeBytes,
      contentType: input.contentType,
      cacheControl: input.cacheControl,
    });
  }

  /** Idempotently reclaim an explicit media placement. */
  async deleteObject(ref: MediaStorageObjectRef): Promise<void> {
    const resolved = this.resolveStoredProvider(ref);
    await resolved.provider.deleteObject(resolved.object);
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

  private resolveStoredProvider(ref: MediaStorageObjectRef): {
    provider: OutputStorageService;
    object: StorageObjectRef;
  } {
    if (!ref.bucket || !ref.objectKey) {
      throw new ServiceUnavailableException(
        `${ref.storageProvider} media object is missing bucket/objectKey`,
      );
    }
    const object: StorageObjectRef = {
      bucket: ref.bucket,
      storageKey: ref.objectKey,
      region: ref.region,
    };
    switch (ref.storageProvider) {
      case MediaStorageProvider.azure_blob:
        return { provider: this.azure, object };
      case MediaStorageProvider.aliyun_oss:
        return { provider: this.oss, object };
      case MediaStorageProvider.s3_compatible:
        return { provider: this.s3, object };
      default:
        throw new ServiceUnavailableException(
          `unsupported stored media provider: ${ref.storageProvider}`,
        );
    }
  }
}
