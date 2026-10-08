import { requirePrivateUploadTarget } from './private-upload-target';
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
  assertExpectedStorageObjectSize,
  assertStoredObjectSize,
  assertStoragePromotionLocations,
  IMMUTABLE_STORAGE_CACHE_CONTROL,
  OutputStorageService,
  type CreateReadUrlInput,
  type CreateReadUrlResult,
  type CreateUploadUrlInput,
  type CreateUploadUrlResult,
  type HeadObjectResult,
  type MultipartUploadRef,
  type StoredUploadPart,
  type UploadPartUrl,
  type OutputStorageResult,
  type OutputStorageUpload,
  type OutputStorageUploadFromFile,
  type PromoteStorageObjectInput,
  type PromoteStorageObjectResult,
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

// In-VPC deployments (e.g. ACK in the same region) MUST use the OSS internal
// endpoint: this account blocks the public endpoint outright
// (PublicEndpointForbidden — "use CNAME instead"). Public-internet contexts
// (local dev) keep the default public endpoint. Gated by OSS_INTERNAL.
const ossUseInternalEndpoint = (): boolean =>
  ['1', 'true', 'yes', 'on'].includes(
    (process.env.OSS_INTERNAL ?? '').trim().toLowerCase(),
  );

// Browser-facing presigned URLs (upload PUT + signed read GET) must target a
// host the BROWSER can reach. On an internal-endpoint cell (OSS_INTERNAL=true)
// the internal host is VPC-only, so these are signed against a PUBLIC OSS
// custom domain — a CNAME bound DIRECTLY to the bucket (NOT a read CDN) — given
// by OSS_PUBLIC_BASE_URL, e.g. https://oss.fizzspace.cn. Unset on .com/local,
// where the default endpoint is already public.
const ossPublicCnameEndpoint = (): string =>
  (process.env.OSS_PUBLIC_BASE_URL ?? '').trim();

@Injectable()
export class AliyunOssStorageService extends OutputStorageService {
  readonly providerId = 'aliyun_oss' as const;
  private readonly logger = new Logger(AliyunOssStorageService.name);
  private readonly client: OSS | null;
  private readonly missingConfigurationKeys: string[];
  private readonly bucket: string;
  private readonly privateUploadTarget = (
    process.env.OSS_PRIVATE_BUCKET ?? ''
  ).trim();
  private readonly rawRegion: string;
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;
  /** Bare region form (`cn-hangzhou`) for MediaAsset.region — see file
   *  header. NOT the SDK's `oss-cn-hangzhou` form. */
  private readonly region: string | null;
  /** Browser-facing signer (upload PUT + signed read GET) bound to the public
   *  OSS custom domain (OSS_PUBLIC_BASE_URL) so the minted URL host is
   *  reachable from the browser. Null when unset (.com/local, where the default
   *  endpoint is already public). See browserSigner(). */
  private readonly publicSigner: OSS | null;
  private readonly privateSigner: OSS | null;

  constructor() {
    super();
    const bucket = (process.env.OSS_BUCKET ?? '').trim();
    const rawRegion = (process.env.OSS_REGION ?? '').trim();
    const accessKeyId = (process.env.OSS_ACCESS_KEY_ID ?? '').trim();
    const accessKeySecret = (process.env.OSS_ACCESS_KEY_SECRET ?? '').trim();

    this.missingConfigurationKeys = [
      ['OSS_BUCKET', bucket],
      ['OSS_REGION', rawRegion],
      ['OSS_ACCESS_KEY_ID', accessKeyId],
      ['OSS_ACCESS_KEY_SECRET', accessKeySecret],
      ['OSS_PUBLIC_BASE_URL', process.env.OSS_PUBLIC_BASE_URL?.trim()],
      [
        'MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS',
        process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS?.trim(),
      ],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key as string);
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
      this.publicSigner = null;
      this.privateSigner = null;
      return;
    }
    this.client = new OSS({
      region: rawRegion,
      bucket,
      accessKeyId,
      accessKeySecret,
      secure: true,
      internal: ossUseInternalEndpoint(),
      // V4 signing — matches the strict OSS encoding rules and eliminates
      // the SignatureDoesNotMatch family that the legacy path tripped on.
      authorizationV4: true,
    });
    // Browser-facing signer: bind the public OSS custom domain (cname:true) so
    // presigned upload/read URLs point at a host the browser can reach. Region
    // is KEPT — V4 derives the canonical sign-region from it; dropping it would
    // yield SignatureDoesNotMatch. internal:false — never the in-VPC endpoint.
    const publicEndpoint = ossPublicCnameEndpoint();
    this.publicSigner = publicEndpoint
      ? new OSS({
          region: rawRegion,
          bucket,
          accessKeyId,
          accessKeySecret,
          endpoint: publicEndpoint,
          cname: true,
          secure: true,
          internal: false,
          authorizationV4: true,
        })
      : null;
    const privateEndpoint = (
      process.env.OSS_PRIVATE_PUBLIC_BASE_URL ?? ''
    ).trim();
    if (privateEndpoint) {
      requirePrivateUploadTarget(
        'OSS_PRIVATE_BUCKET',
        this.privateUploadTarget,
        [bucket, ''],
      );
      const url = new URL(privateEndpoint);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        (publicEndpoint && url.host === new URL(publicEndpoint).host)
      ) {
        throw new ServiceUnavailableException(
          'OSS_PRIVATE_PUBLIC_BASE_URL must be a separate HTTPS OSS bucket CNAME origin',
        );
      }
    }
    this.privateSigner =
      privateEndpoint && this.privateUploadTarget
        ? new OSS({
            region: rawRegion,
            bucket: this.privateUploadTarget,
            accessKeyId,
            accessKeySecret,
            endpoint: privateEndpoint,
            cname: true,
            secure: true,
            internal: false,
            authorizationV4: true,
          })
        : null;
  }

  objectLocation(key: string) {
    this.assertConfigured('Object storage');
    return {
      storageProvider: this.providerId,
      bucket: this.bucket,
      region: this.region,
      objectKey: key,
      externalUrl: null,
    };
  }

  assertConfigured(context: string): void {
    if (this.missingConfigurationKeys.length)
      throw new Error(
        `${context} requires: ${this.missingConfigurationKeys.join(', ')}`,
      );
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

  override async uploadFromFile(
    input: OutputStorageUploadFromFile,
  ): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('OSS_* env not configured');
    }
    // Multipart from disk: 300MB-class video outputs would blow ali-oss's
    // 60s default single-PUT budget on the public endpoint; parts stream
    // from the file, each with its own generous timeout.
    await this.client.multipartUpload(input.key, input.filePath, {
      timeout: 10 * 60_000,
      headers: {
        'Content-Type': input.contentType,
        // Same immutable-bytes caching rationale as upload().
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(input.filename
          ? { 'Content-Disposition': `inline; filename="${input.filename}"` }
          : {}),
      },
    });
    return {
      url: this.client.generateObjectUrl(input.key),
      storagePath: input.key,
      bytes: input.sizeBytes,
      provider: 'aliyun_oss',
      bucket: this.bucket,
      region: this.region,
    };
  }

  async beginMultipartUpload(
    storageKey: string,
    contentType: string,
  ): Promise<MultipartUploadRef> {
    const result = await this.clientForBucket(this.bucket).initMultipartUpload(
      storageKey,
      {
        mime: contentType,
        headers: { 'Cache-Control': IMMUTABLE_STORAGE_CACHE_CONTROL },
      },
    );
    if (!result.uploadId)
      throw new Error('Storage did not return an upload ID');
    return {
      storageKey,
      uploadId: result.uploadId,
      bucket: this.bucket,
      region: this.region,
    };
  }

  async listUploadParts(ref: MultipartUploadRef): Promise<StoredUploadPart[]> {
    const parts: StoredUploadPart[] = [];
    let marker = 0;
    for (;;) {
      const result = await this.clientForBucket(
        ref.bucket,
        ref.region,
      ).listParts(ref.storageKey, ref.uploadId, {
        'max-parts': 1000,
        'part-number-marker': marker,
        'encoding-type': 'url',
      });
      // ali-oss returns raw XML values (including a single object instead of an
      // array for one part); its declaration incorrectly calls Size `size`.
      const entries: unknown[] = Array.isArray(result.parts)
        ? result.parts
        : [result.parts];
      for (const entry of entries) {
        const p = entry as {
          PartNumber?: unknown;
          ETag?: unknown;
          Size?: unknown;
        };
        const number = Number(p.PartNumber);
        const sizeBytes = Number(p.Size);
        if (
          !Number.isInteger(number) ||
          number < 1 ||
          !Number.isSafeInteger(sizeBytes) ||
          sizeBytes < 1 ||
          typeof p.ETag !== 'string'
        ) {
          throw new Error('Invalid stored upload part');
        }
        parts.push({ number, sizeBytes, etag: p.ETag });
      }
      if (String(result.isTruncated) !== 'true') return parts;
      const next = Number(result.nextPartNumberMarker);
      if (!Number.isInteger(next) || next <= marker)
        throw new Error('Invalid storage pagination marker');
      marker = next;
    }
  }

  async signUploadPart(
    ref: MultipartUploadRef,
    number: number,
  ): Promise<UploadPartUrl> {
    const url = await this.browserSigner(ref.bucket, ref.region).signatureUrlV4(
      'PUT',
      900,
      {
        queries: { uploadId: ref.uploadId, partNumber: String(number) },
      },
      ref.storageKey,
    );
    return { url, headers: {} };
  }

  async completeMultipartUpload(
    ref: MultipartUploadRef,
    parts: StoredUploadPart[],
  ): Promise<void> {
    await this.clientForBucket(ref.bucket, ref.region).completeMultipartUpload(
      ref.storageKey,
      ref.uploadId,
      parts.map((p) => ({ number: p.number, etag: p.etag })),
    );
  }

  async abortMultipartUpload(ref: MultipartUploadRef): Promise<void> {
    try {
      await this.clientForBucket(ref.bucket, ref.region).abortMultipartUpload(
        ref.storageKey,
        ref.uploadId,
      );
    } catch (error) {
      if (!(error instanceof Error && error.name === 'NoSuchUploadError'))
        throw error;
    }
  }

  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    return this.signUploadUrl(input, this.bucket);
  }

  async createPrivateUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    const target = requirePrivateUploadTarget(
      'OSS_PRIVATE_BUCKET',
      this.privateUploadTarget,
      [this.bucket, ''],
    );
    return this.signUploadUrl(input, target);
  }

  private async signUploadUrl(
    input: CreateUploadUrlInput,
    target: string,
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
    const url = await this.browserSigner(target).signatureUrlV4(
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
      bucket: target,
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
    const client = this.browserSigner(input.bucket, input.region);
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
    return this.headStoredObject({
      bucket: this.bucket,
      storageKey: key,
      region: this.region,
    });
  }

  override async headStoredObject(
    ref: StorageObjectRef,
  ): Promise<HeadObjectResult> {
    const client = this.clientForBucket(ref.bucket, ref.region);
    try {
      const res = await client.head(ref.storageKey);
      // The object's real size + type are HTTP response headers
      // (`content-length` / `content-type`), not the SDK's `res.size`
      // (that's the bytes of the HEAD response payload, ~0). Headers are
      // lower-cased by the SDK. Typed as `object`, so read defensively.
      const headers = (res.res?.headers ?? {}) as Record<string, unknown>;
      const rawLength = headers['content-length'];
      const sizeBytes = rawLength != null ? Number(rawLength) : undefined;
      const rawType = headers['content-type'];
      const contentType = typeof rawType === 'string' ? rawType : undefined;
      const rawEtag = headers.etag;
      const etag = typeof rawEtag === 'string' ? rawEtag : undefined;
      return {
        exists: true,
        sizeBytes:
          sizeBytes != null && Number.isFinite(sizeBytes)
            ? sizeBytes
            : undefined,
        contentType,
        etag,
        provider: 'aliyun_oss',
        bucket: ref.bucket,
        region: ref.region ?? this.region,
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

  override async promoteObject(
    input: PromoteStorageObjectInput,
  ): Promise<PromoteStorageObjectResult> {
    assertStoragePromotionLocations(input.source, input.destination);
    assertExpectedStorageObjectSize(input.expectedSizeBytes);
    assertSameOssRegion(input.source, input.destination);

    const destinationClient = this.clientForBucket(
      input.destination.bucket,
      input.destination.region,
    );
    const cacheControl = input.cacheControl ?? IMMUTABLE_STORAGE_CACHE_CONTROL;
    const headers = {
      'Content-Type': input.contentType,
      'Cache-Control': cacheControl,
    };
    const existing = await this.headStoredObject(input.destination);
    if (!existing.exists) {
      const source = await this.headStoredObject(input.source);
      assertStoredObjectSize(input.source, source, input.expectedSizeBytes);
      // Four-argument overload performs an in-provider server-side copy and
      // supports a different source bucket in the same OSS region.
      await destinationClient.copy(
        input.destination.storageKey,
        input.source.storageKey,
        input.source.bucket,
        { headers },
      );
    } else {
      assertStoredObjectSize(
        input.destination,
        existing,
        input.expectedSizeBytes,
      );
      // A retry can arrive after copy but before cleanup. Re-assert immutable
      // serving headers on the final object without touching staging.
      await destinationClient.copy(
        input.destination.storageKey,
        input.destination.storageKey,
        input.destination.bucket,
        { headers },
      );
    }

    const finalHead = await this.headStoredObject(input.destination);
    assertStoredObjectSize(
      input.destination,
      finalHead,
      input.expectedSizeBytes,
    );
    await this.deleteAfterPromotion(input.source);
    return {
      bucket: input.destination.bucket,
      storageKey: input.destination.storageKey,
      region: input.destination.region ?? this.region,
      provider: 'aliyun_oss',
      sizeBytes: input.expectedSizeBytes,
      contentType: input.contentType,
      ...(finalHead.etag ? { etag: finalHead.etag } : {}),
    };
  }

  override async deleteObject(ref: StorageObjectRef): Promise<void> {
    // OSS DELETE is idempotent: deleting an absent object is still success.
    await this.clientForBucket(ref.bucket, ref.region).delete(ref.storageKey);
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

  /** Client for BROWSER-facing presigned URLs (upload PUT, signed read GET).
   *  Prefers the public-CNAME signer so the minted host is browser-reachable.
   *  Fails loud on an internal-endpoint cell with no public CNAME configured —
   *  an internal-host signed URL is a dead end for the browser, so don't mint
   *  one. Off-internal (local/.com) the default client's host is already
   *  public, so fall through to the per-bucket internal client. */
  private browserSigner(bucket: string, region?: string | null): OSS {
    if (
      bucket === this.privateUploadTarget &&
      (!region || region.replace(/^oss-/, '') === this.region)
    ) {
      if (this.privateSigner) return this.privateSigner;
      if (ossUseInternalEndpoint()) {
        throw new ServiceUnavailableException(
          'OSS_PRIVATE_PUBLIC_BASE_URL is required for the private bucket when OSS_INTERNAL=true',
        );
      }
    }
    if (this.publicSigner && bucket === this.bucket) {
      return this.publicSigner;
    }
    if (ossUseInternalEndpoint()) {
      throw new ServiceUnavailableException(
        'OSS_PUBLIC_BASE_URL is required when OSS_INTERNAL=true — browser-' +
          'facing signed URLs cannot use the in-VPC internal endpoint',
      );
    }
    return this.clientForBucket(bucket, region);
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
      internal: ossUseInternalEndpoint(),
      authorizationV4: true,
    });
  }

  private async deleteAfterPromotion(ref: StorageObjectRef): Promise<void> {
    try {
      await this.deleteObject(ref);
    } catch (err) {
      // Final is already independent and unsigned. Reclamation can retry this
      // without holding the promotion job open.
      this.logger.warn(
        `Promoted OSS staging object but could not delete ${ref.bucket}/${ref.storageKey}: ` +
          errorMessage(err),
      );
    }
  }
}

/**
 * Query overrides for a signed OSS GET.
 *
 * Do NOT send `response-content-type`. On the CN public CNAME
 * (`oss.fizzspace.cn`) Aliyun rejects it with InvalidRequest /
 * `Can not override response header on content-type` (EC 0017-00000902),
 * so every playable video 302 from `/aurora` 400s in the browser. The
 * object already has the real Content-Type from upload. Cache-control
 * and content-disposition overrides are still allowed.
 */
export function ossSignedReadQueries(
  input: CreateReadUrlInput,
): { queries: Record<string, string> } | undefined {
  const queries: Record<string, string> = {};
  if (input.cacheControl) {
    queries['response-cache-control'] = input.cacheControl;
  }
  if (input.filename) {
    queries['response-content-disposition'] =
      `inline; filename="${input.filename}"`;
  }
  return Object.keys(queries).length > 0 ? { queries } : undefined;
}

function responseOptionsForRead(input: CreateReadUrlInput) {
  return ossSignedReadQueries(input);
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

function assertSameOssRegion(
  source: StorageObjectRef,
  destination: StorageObjectRef,
): void {
  const sourceRegion = source.region?.replace(/^oss-/, '') ?? null;
  const destinationRegion = destination.region?.replace(/^oss-/, '') ?? null;
  if (sourceRegion && destinationRegion && sourceRegion !== destinationRegion) {
    throw new Error('OSS server-side promotion requires one storage region');
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
