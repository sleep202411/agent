import { Injectable } from '@nestjs/common';

export interface ResolvableMediaAsset {
  storageProvider: string;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
}

/**
 * Converts durable media asset identity into a browser-fetchable URL.
 *
 * DB rows store provider/bucket/objectKey, never a hard-coded CDN URL.
 * This resolver is the only place that knows how each provider becomes
 * a public URL, so CDN moves and region splits stay config-only.
 */
@Injectable()
export class MediaAssetUrlResolverService {
  resolve(asset: ResolvableMediaAsset): string {
    if (asset.storageProvider === 'external_url') {
      if (!asset.externalUrl) {
        throw new Error('external_url media asset is missing externalUrl');
      }
      return asset.externalUrl;
    }

    if (!asset.bucket || !asset.objectKey) {
      throw new Error(
        `media asset ${asset.storageProvider} is missing bucket/objectKey`,
      );
    }

    switch (asset.storageProvider) {
      case 'azure_blob':
        return this.azureBlobUrl(asset.bucket, asset.objectKey);
      case 'aliyun_oss':
        return this.aliyunOssUrl(asset.bucket, asset.objectKey, asset.region);
      case 's3_compatible':
        return this.s3CompatibleUrl(
          asset.bucket,
          asset.objectKey,
          asset.region,
        );
      default:
        throw new Error(
          `unsupported media storage provider: ${asset.storageProvider}`,
        );
    }
  }

  private azureBlobUrl(container: string, objectKey: string): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_AZURE_BLOB ??
        process.env.AZURE_BLOB_PUBLIC_BASE_URL,
    );
    if (configured) {
      return `${configured}/${encodePath(container)}/${encodePath(objectKey)}`;
    }

    const account =
      cleanSegment(process.env.AZURE_BLOB_ACCOUNT_NAME) ??
      accountNameFromConnectionString(process.env.AZURE_BLOB_CONNECTION_STRING);
    if (!account) {
      throw new Error(
        'AZURE_BLOB_ACCOUNT_NAME or AZURE_BLOB_CONNECTION_STRING is required to resolve Azure media URLs',
      );
    }
    return `https://${account}.blob.core.windows.net/${encodePath(container)}/${encodePath(objectKey)}`;
  }

  private aliyunOssUrl(
    bucket: string,
    objectKey: string,
    region: string | null,
  ): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS,
    );
    if (configured) {
      // Aliyun OSS/CDN custom domains are normally bucket-root, so do
      // not append the bucket when this override is configured.
      return `${configured}/${encodePath(objectKey)}`;
    }
    if (!region) {
      throw new Error(
        'media asset region is required to resolve Aliyun OSS URLs without MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
      );
    }
    return `https://${bucket}.oss-${region}.aliyuncs.com/${encodePath(objectKey)}`;
  }

  private s3CompatibleUrl(
    bucket: string,
    objectKey: string,
    region: string | null,
  ): string {
    const configured = cleanBaseUrl(
      process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE,
    );
    if (configured) {
      return `${configured}/${encodePath(objectKey)}`;
    }
    if (!region) {
      throw new Error(
        'media asset region is required to resolve S3-compatible URLs without MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE',
      );
    }
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodePath(objectKey)}`;
  }
}

function cleanBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || null;
}

function cleanSegment(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function accountNameFromConnectionString(
  value: string | undefined,
): string | null {
  if (!value) return null;
  const match = value.match(/(?:^|;)AccountName=([^;]+)/);
  return match?.[1] ?? null;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
