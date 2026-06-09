/**
 * Alibaba OSS implementation of OutputStorageService.
 *
 * Sibling to AzureBlobStorageService for the CN deployment cell — keeps
 * media in-region per the deployment split. Implements ALL THREE abstract
 * methods (upload + isHealthy + createUploadUrl) so it's a complete drop-in
 * for the AI-gen worker too, not just the upload-URL path.
 *
 * Config (env):
 *   OSS_REGION            — full prefix form, e.g. "oss-cn-hangzhou".
 *     The SDK wants this form; we normalize to the bare "cn-hangzhou"
 *     form for MediaAsset.region so it round-trips through the read
 *     resolver (which builds `https://{bucket}.oss-{region}.aliyuncs.com`).
 *   OSS_BUCKET            — bucket name. Required.
 *   OSS_ACCESS_KEY_ID     — access key id. Required.
 *   OSS_ACCESS_KEY_SECRET — access key secret. Required.
 *
 * Unconfigured behavior mirrors Azure: the constructor only warns and
 * leaves `client` null. upload()/createUploadUrl() then throw a clear
 * ServiceUnavailableException rather than silently no-op'ing (a missing
 * upload URL can't be swallowed). isHealthy() returns false.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OSS from 'ali-oss';
import {
  OutputStorageService,
  type CreateUploadUrlInput,
  type CreateUploadUrlResult,
  type HeadObjectResult,
  type OutputStorageResult,
  type OutputStorageUpload,
} from './storage.types';

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 900;

@Injectable()
export class AliyunOssStorageService extends OutputStorageService {
  private readonly logger = new Logger(AliyunOssStorageService.name);
  private readonly client: OSS | null;
  private readonly bucket: string;
  /** Bare region form (`cn-hangzhou`) for MediaAsset.region — see file
   *  header. NOT the SDK's `oss-cn-hangzhou` form. */
  private readonly region: string | null;

  constructor() {
    super();
    const bucket = (process.env.OSS_BUCKET ?? '').trim();
    const rawRegion = (process.env.OSS_REGION ?? '').trim();
    const accessKeyId = (process.env.OSS_ACCESS_KEY_ID ?? '').trim();
    const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET ?? '').trim();

    this.bucket = bucket;
    // Strip the leading `oss-` so the persisted region matches what the
    // read resolver re-prefixes (`oss-${region}`). `oss-cn-hangzhou` →
    // `cn-hangzhou`; a bare `cn-hangzhou` passes through unchanged.
    this.region = rawRegion ? rawRegion.replace(/^oss-/, '') : null;

    if (!bucket || !rawRegion || !accessKeyId || !accessKeySecret) {
      this.logger.warn(
        'OSS_* env incomplete — AliyunOssStorageService is a no-op',
      );
      this.client = null;
      return;
    }
    this.client = new OSS({
      region: rawRegion,
      bucket,
      accessKeyId,
      accessKeySecret,
      secure: true,
      // V4 signing — matches the strict OSS encoding rules and eliminates
      // the SignatureDoesNotMatch family that the legacy path tripped on.
      authorizationV4: true,
    });
  }

  async upload(input: OutputStorageUpload): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('OSS_* env not configured');
    }
    const result = await this.client.put(input.key, input.body, {
      headers: {
        'Content-Type': input.contentType,
        // Gallery outputs are immutable per key — cache hard at the edge.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(input.filename
          ? { 'Content-Disposition': `inline; filename="${input.filename}"` }
          : {}),
      },
    });
    return {
      url: result.url,
      storagePath: result.name,
      bytes: input.body.byteLength,
      provider: 'aliyun_oss',
      bucket: this.bucket,
      region: this.region,
    };
  }

  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'aliyun_oss storage is not configured',
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_UPLOAD_URL_TTL_SECONDS;
    // V4 presigned PUT. Signing Content-Type means the browser MUST send
    // the identical value (uploads.ts already does). Region is persisted
    // in the bare form so the read resolver re-builds the host correctly.
    const url = await this.client.signatureUrlV4(
      'PUT',
      ttl,
      { headers: { 'Content-Type': input.contentType } },
      input.storageKey,
    );
    return {
      url,
      method: 'PUT',
      // Signed → the client must echo this exact Content-Type.
      headers: { 'Content-Type': input.contentType },
      storageKey: input.storageKey,
      provider: 'aliyun_oss',
      bucket: this.bucket,
      region: this.region,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'aliyun_oss storage is not configured',
      );
    }
    try {
      const res = await this.client.head(key);
      // The object's real size + type are HTTP response headers
      // (`content-length` / `content-type`), not the SDK's `res.size`
      // (that's the bytes of the HEAD response payload, ~0). Headers are
      // lower-cased by the SDK. Typed as `object`, so read defensively.
      const headers = (res.res?.headers ?? {}) as Record<string, unknown>;
      const rawLength = headers['content-length'];
      const sizeBytes = rawLength != null ? Number(rawLength) : undefined;
      const rawType = headers['content-type'];
      const contentType = typeof rawType === 'string' ? rawType : undefined;
      return {
        exists: true,
        sizeBytes:
          sizeBytes != null && Number.isFinite(sizeBytes)
            ? sizeBytes
            : undefined,
        contentType,
        provider: 'aliyun_oss',
        bucket: this.bucket,
        region: this.region,
      };
    } catch (err) {
      // OSS throws NoSuchKey / 404 when the object is absent — that's the
      // confirm-step's "no bytes landed" signal. Any other error (auth,
      // network, throttle) is a real fault and must surface.
      if (isOssNotFound(err)) {
        return { exists: false };
      }
      throw err;
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.getBucketInfo(this.bucket);
      return true;
    } catch (err) {
      this.logger.warn(
        `Aliyun OSS health probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}

/**
 * `client.head()` rejects with a 404 / NoSuchKey when the object is
 * absent. Match on status OR code (the SDK populates both) without
 * coupling to a concrete error class.
 */
function isOssNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: string; name?: string };
    if (e.status === 404) return true;
    if (e.code === 'NoSuchKey' || e.name === 'NoSuchKeyError') return true;
  }
  return false;
}
