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
  type CreateReadUrlInput,
  type CreateReadUrlResult,
  type CreateUploadUrlInput,
  type CreateUploadUrlResult,
  type HeadObjectResult,
  type OutputStorageResult,
  type OutputStorageUpload,
  type RestrictObjectResult,
  type StorageObjectRef,
} from './storage.types';

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 900;
const DEFAULT_READ_URL_TTL_SECONDS = 300;
/**
 * ali-oss accepts the object ACL `default` (revert to inheriting the bucket
 * ACL), but `@types/ali-oss`'s `ACLType` union omits it. Cast once, here.
 */
const OSS_ACL_INHERIT_BUCKET = 'default' as unknown as OSS.ACLType;

@Injectable()
export class AliyunOssStorageService extends OutputStorageService {
  private readonly logger = new Logger(AliyunOssStorageService.name);
  private readonly client: OSS | null;
  private readonly bucket: string;
  private readonly rawRegion: string;
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
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
    this.rawRegion = rawRegion;
    this.accessKeyId = accessKeyId;
    this.accessKeySecret = accessKeySecret;
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
        // Content-addressed keys → immutable bytes; cache aggressively.
        // Takedown invalidates blocked objects at the storage layer + CDN purge,
        // not via cache headers.
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

  async createReadUrl(input: CreateReadUrlInput): Promise<CreateReadUrlResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'aliyun_oss storage is not configured',
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_READ_URL_TTL_SECONDS;
    const client = this.clientForBucket(input.bucket, input.region);
    const url = await client.signatureUrlV4(
      'GET',
      ttl,
      responseOptionsForRead(input),
      input.storageKey,
    );
    return {
      url,
      provider: 'aliyun_oss',
      bucket: input.bucket,
      storageKey: input.storageKey,
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

  async restrictObject(ref: StorageObjectRef): Promise<RestrictObjectResult> {
    // OSS supports per-object ACL: flip to `private` so the bucket's
    // public-read no longer applies. In place — location is unchanged.
    // Idempotent: setting an already-private object private is a no-op.
    await this.clientForBucket(ref.bucket, ref.region).putACL(
      ref.storageKey,
      'private',
    );
    return { bucket: ref.bucket, storageKey: ref.storageKey, relocated: false };
  }

  // OSS flips ACL in place and never relocates, so the abstract method's
  // `original` argument is unused here — the impl simply omits it.
  async restoreObject(
    current: StorageObjectRef,
  ): Promise<RestrictObjectResult> {
    // `default` makes the object inherit the bucket ACL again (public-read for
    // a public bucket).
    await this.clientForBucket(current.bucket, current.region).putACL(
      current.storageKey,
      OSS_ACL_INHERIT_BUCKET,
    );
    return {
      bucket: current.bucket,
      storageKey: current.storageKey,
      relocated: false,
    };
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

  private clientForBucket(bucket: string, region?: string | null): OSS {
    // The object's own region (bare form, e.g. `cn-hangzhou`) wins so a legacy
    // object outside the cell-default region is signed against the right
    // endpoint. SDK wants the `oss-` prefix form. Fall back to the configured
    // region for same-region objects (and reuse the cached client then).
    const sdkRegion = region ? `oss-${region.replace(/^oss-/, '')}` : null;
    if (
      this.client &&
      bucket === this.bucket &&
      (!sdkRegion || sdkRegion === this.rawRegion)
    ) {
      return this.client;
    }
    if (!this.accessKeyId || !this.accessKeySecret) {
      throw new ServiceUnavailableException(
        'aliyun_oss storage is not configured',
      );
    }
    const effectiveRegion = sdkRegion || this.rawRegion;
    if (!effectiveRegion) {
      throw new ServiceUnavailableException(
        'aliyun_oss storage is not configured',
      );
    }
    return new OSS({
      region: effectiveRegion,
      bucket,
      accessKeyId: this.accessKeyId,
      accessKeySecret: this.accessKeySecret,
      secure: true,
      authorizationV4: true,
    });
  }
}

function responseOptionsForRead(input: CreateReadUrlInput) {
  const queries: Record<string, string> = {};
  if (input.cacheControl) {
    queries['response-cache-control'] = input.cacheControl;
  }
  if (input.contentType) {
    queries['response-content-type'] = input.contentType;
  }
  if (input.filename) {
    queries['response-content-disposition'] =
      `inline; filename="${input.filename}"`;
  }
  return Object.keys(queries).length > 0 ? { queries } : undefined;
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
