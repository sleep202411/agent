/**
 * S3-compatible implementation of OutputStorageService — built for
 * Cloudflare R2, works against any S3 API (MinIO in tests, AWS proper).
 *
 * Sibling to AzureBlobStorageService / AliyunOssStorageService; fills the
 * `s3_compatible` slot that has been enum-only since the storage split.
 *
 * Config (env):
 *   S3_ENDPOINT           — S3 API endpoint. R2:
 *     `https://<accountid>.r2.cloudflarestorage.com`. Required.
 *   S3_REGION             — signing region. R2: `auto`. Required (persisted
 *     to MediaAsset.region for the read resolver).
 *   S3_BUCKET             — bucket name. Required.
 *   S3_ACCESS_KEY_ID      — access key id. Required.
 *   S3_ACCESS_KEY_SECRET  — access key secret. Required.
 *   S3_QUARANTINE_BUCKET  — private bucket takendown objects move into
 *     (S3 has no usable per-object ACL on R2). Defaults to
 *     `${S3_BUCKET}-quarantine`. Created on demand.
 *   S3_FORCE_PATH_STYLE   — set truthy for path-style addressing. R2 (whose
 *     S3 endpoint is account-scoped, not bucket-scoped) and MinIO both want
 *     it; default off.
 *
 * Public reads: R2's S3 endpoint is NOT the public URL — set
 * `MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE` (read resolver) to the CDN custom
 * domain bound to the bucket; without it the resolver falls back to an
 * `amazonaws.com` host shape that is wrong for R2.
 *
 * Unconfigured behavior mirrors the siblings: constructor warns and leaves
 * `client` null; upload paths throw plainly, URL/HEAD/takedown paths throw
 * ServiceUnavailableException, isHealthy() returns false.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
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
// Content-addressed keys → immutable bytes; same caching rationale as the
// Azure/OSS impls. Takedown works via quarantine move + CDN purge, not
// cache headers.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const s3ForcePathStyle = (): boolean =>
  ['1', 'true', 'yes', 'on'].includes(
    (process.env.S3_FORCE_PATH_STYLE ?? '').trim().toLowerCase(),
  );

@Injectable()
export class S3CompatibleStorageService extends OutputStorageService {
  private readonly logger = new Logger(S3CompatibleStorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly quarantineBucket: string;
  private readonly region: string | null;
  private readonly endpoint: string;
  private readonly forcePathStyle: boolean;
  private readonly autoCreateBucket: boolean;
  private autoCreateInitialized = false;

  constructor() {
    super();
    const endpoint = (process.env.S3_ENDPOINT ?? '').trim();
    const region = (process.env.S3_REGION ?? '').trim();
    const bucket = (process.env.S3_BUCKET ?? '').trim();
    const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? '').trim();
    const accessKeySecret = (process.env.S3_ACCESS_KEY_SECRET ?? '').trim();
    this.bucket = bucket;
    this.quarantineBucket =
      (process.env.S3_QUARANTINE_BUCKET ?? '').trim() ||
      (bucket ? `${bucket}-quarantine` : '');
    this.region = region || null;
    this.endpoint = endpoint;
    this.forcePathStyle = s3ForcePathStyle();
    this.autoCreateBucket = envFlag('S3_AUTO_CREATE_BUCKET');

    if (this.autoCreateBucket && process.env.NODE_ENV === 'production') {
      throw new Error(
        'S3_AUTO_CREATE_BUCKET is a local-development option and must not be enabled in production',
      );
    }

    if (!endpoint || !region || !bucket || !accessKeyId || !accessKeySecret) {
      this.logger.warn(
        'S3_* env incomplete — S3CompatibleStorageService is a no-op',
      );
      this.client = null;
      return;
    }
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey: accessKeySecret },
      forcePathStyle: this.forcePathStyle,
      // Presigning has no body to hash, so the SDK default (WHEN_SUPPORTED)
      // pins `x-amz-checksum-crc32` of ZERO bytes into every presigned PUT —
      // hoisted into the query, i.e. covered by the signature and impossible
      // to drop client-side, so the real bytes can never match it and the
      // upload 400s on checksum. WHEN_REQUIRED emits checksums only for the
      // operations that mandate one.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      // Same hoisting on the read side: `x-amz-checksum-mode=ENABLED` would
      // ride inside every signed GET, demanding a checksum R2 never stored.
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(input: OutputStorageUpload): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('S3_* env not configured');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        ...(input.filename
          ? { ContentDisposition: `inline; filename="${input.filename}"` }
          : {}),
      }),
    );
    return {
      url: this.storageSideUrl(input.key),
      storagePath: input.key,
      bytes: input.body.byteLength,
      provider: 's3_compatible',
      bucket: this.bucket,
      region: this.region,
    };
  }

  override async uploadFromFile(
    input: OutputStorageUploadFromFile,
  ): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('S3_* env not configured');
    }
    // Multipart from disk via lib-storage: parts stream from the file, so a
    // 300MB-class video output never sits in process memory.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: input.key,
        Body: createReadStream(input.filePath),
        ContentType: input.contentType,
        CacheControl: IMMUTABLE_CACHE_CONTROL,
        ...(input.filename
          ? { ContentDisposition: `inline; filename="${input.filename}"` }
          : {}),
      },
    });
    await upload.done();
    return {
      url: this.storageSideUrl(input.key),
      storagePath: input.key,
      bytes: input.sizeBytes,
      provider: 's3_compatible',
      bucket: this.bucket,
      region: this.region,
    };
  }

  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    const client = this.requireClient();
    const ttl = input.expiresInSeconds ?? DEFAULT_UPLOAD_URL_TTL_SECONDS;
    // Presigned PUT with ContentType pinned into the signature — the
    // browser's PUT must echo the identical Content-Type (uploads.ts already
    // sends the headers this result carries). maxBytes stays advisory, same
    // as Azure SAS / OSS V4 presign; enforcement is the server-side
    // pre-check + confirm-time HEAD reconcile.
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.storageKey,
        ContentType: input.contentType,
      }),
      // signableHeaders is load-bearing: without it the presigner leaves
      // content-type OUT of SignedHeaders and any Content-Type is accepted
      // (verified against MinIO) — the pin below is what makes the
      // mismatched-type PUT fail like the Azure SAS / OSS V4 paths do. It
      // takes SignedHeaders to exactly `content-type;host`; every other
      // signing input the SDK emits is hoisted into the query, not signed as
      // a header. The spec pins that set.
      { expiresIn: ttl, signableHeaders: new Set(['content-type']) },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      storageKey: input.storageKey,
      provider: 's3_compatible',
      bucket: this.bucket,
      region: this.region,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async createReadUrl(input: CreateReadUrlInput): Promise<CreateReadUrlResult> {
    const client = this.requireClient();
    const ttl = input.expiresInSeconds ?? DEFAULT_READ_URL_TTL_SECONDS;
    // NOTE: presigned GETs hit the S3 endpoint directly and bypass any CDN
    // custom domain — correct for the controlled-read paths (paid video,
    // moderation evidence) this backs.
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.storageKey,
        ...(input.cacheControl
          ? { ResponseCacheControl: input.cacheControl }
          : {}),
        ...(input.contentType
          ? { ResponseContentType: input.contentType }
          : {}),
        ...(input.filename
          ? {
              ResponseContentDisposition: `inline; filename="${input.filename}"`,
            }
          : {}),
      }),
      { expiresIn: ttl },
    );
    return {
      url,
      provider: 's3_compatible',
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
    const client = this.requireClient();
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.storageKey }),
      );
      return {
        exists: true,
        sizeBytes: head.ContentLength,
        contentType: head.ContentType,
        etag: head.ETag,
        provider: 's3_compatible',
        bucket: ref.bucket,
        region: ref.region ?? this.region,
      };
    } catch (err) {
      if (isS3NotFound(err)) {
        return { exists: false };
      }
      throw err;
    }
  }

  override async promoteObject(
    input: PromoteStorageObjectInput,
  ): Promise<PromoteStorageObjectResult> {
    const client = this.requireClient();
    assertStoragePromotionLocations(input.source, input.destination);
    assertExpectedStorageObjectSize(input.expectedSizeBytes);
    assertSameS3Region(input.source, input.destination);

    const cacheControl = input.cacheControl ?? IMMUTABLE_STORAGE_CACHE_CONTROL;
    const existing = await this.headStoredObject(input.destination);
    if (!existing.exists) {
      const source = await this.headStoredObject(input.source);
      assertStoredObjectSize(input.source, source, input.expectedSizeBytes);
      await client.send(
        new CopyObjectCommand({
          Bucket: input.destination.bucket,
          Key: input.destination.storageKey,
          CopySource: encodeCopySource(
            input.source.bucket,
            input.source.storageKey,
          ),
          MetadataDirective: 'REPLACE',
          ContentType: input.contentType,
          CacheControl: cacheControl,
        }),
      );
    } else {
      assertStoredObjectSize(
        input.destination,
        existing,
        input.expectedSizeBytes,
      );
      // Idempotent retry after copy: a self-copy re-asserts the final headers.
      await client.send(
        new CopyObjectCommand({
          Bucket: input.destination.bucket,
          Key: input.destination.storageKey,
          CopySource: encodeCopySource(
            input.destination.bucket,
            input.destination.storageKey,
          ),
          MetadataDirective: 'REPLACE',
          ContentType: input.contentType,
          CacheControl: cacheControl,
        }),
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
      provider: 's3_compatible',
      sizeBytes: input.expectedSizeBytes,
      contentType: input.contentType,
      ...(finalHead.etag ? { etag: finalHead.etag } : {}),
    };
  }

  override async deleteObject(ref: StorageObjectRef): Promise<void> {
    await this.deleteObjectIfExists(this.requireClient(), ref);
  }

  // Presigned PUTs can't pin Cache-Control (only Content-Type is signed), so
  // direct-uploaded objects land without it. S3 has no header-only update —
  // rewrite is a self-copy with MetadataDirective REPLACE.
  override async setCacheControl(
    key: string,
    cacheControl: string,
    contentType?: string | null,
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: key,
          CopySource: encodeCopySource(this.bucket, key),
          MetadataDirective: 'REPLACE',
          CacheControl: cacheControl,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
    } catch (err) {
      // Contract: MUST NOT throw — a failure here must never break
      // confirmUpload.
      this.logger.warn(
        `setCacheControl self-copy failed for ${key}: ${errorMessage(err)}`,
      );
    }
  }

  async restrictObject(ref: StorageObjectRef): Promise<RestrictObjectResult> {
    const client = this.requireClient();
    const target: StorageObjectRef = {
      bucket: this.quarantineBucket,
      storageKey: ref.storageKey,
    };
    // Idempotent, mirroring Azure: object already quarantined (and source
    // possibly lingering) → converge and report done.
    if (await this.objectExists(client, target)) {
      await this.deleteObjectIfExists(client, ref);
      return { ...target, relocated: true };
    }
    if (!(await this.objectExists(client, ref))) {
      return { ...target, relocated: true };
    }
    await this.ensureBucket(client, this.quarantineBucket);
    await client.send(
      new CopyObjectCommand({
        Bucket: target.bucket,
        Key: target.storageKey,
        CopySource: encodeCopySource(ref.bucket, ref.storageKey),
      }),
    );
    await this.deleteObjectIfExists(client, ref);
    return { ...target, relocated: true };
  }

  async restoreObject(
    current: StorageObjectRef,
    original: StorageObjectRef,
  ): Promise<RestrictObjectResult> {
    const client = this.requireClient();
    if (
      current.bucket === original.bucket &&
      current.storageKey === original.storageKey
    ) {
      return { ...original, relocated: false };
    }
    if (await this.objectExists(client, original)) {
      await this.deleteObjectIfExists(client, current);
      return { ...original, relocated: true };
    }
    if (!(await this.objectExists(client, current))) {
      return { ...original, relocated: true };
    }
    await client.send(
      new CopyObjectCommand({
        Bucket: original.bucket,
        Key: original.storageKey,
        CopySource: encodeCopySource(current.bucket, current.storageKey),
      }),
    );
    await this.deleteObjectIfExists(client, current);
    return { ...original, relocated: true };
  }

  async isHealthy(): Promise<boolean> {
    if (!this.client) return false;
    if (this.autoCreateBucket && !this.autoCreateInitialized) {
      try {
        try {
          await this.client.send(
            new HeadBucketCommand({ Bucket: this.bucket }),
          );
        } catch (err) {
          if (!isS3BucketMissing(err)) throw err;
          await this.ensureBucket(this.client, this.bucket);
        }
        this.autoCreateInitialized = true;
        return true;
      } catch (err) {
        this.logger.warn(
          `S3 local bucket bootstrap failed: ${errorMessage(err)}`,
        );
        return false;
      }
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (err) {
      this.logger.warn(`S3 health probe failed: ${errorMessage(err)}`);
      return false;
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        's3_compatible storage is not configured',
      );
    }
    return this.client;
  }

  private async objectExists(
    client: S3Client,
    ref: StorageObjectRef,
  ): Promise<boolean> {
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.storageKey }),
      );
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      throw err;
    }
  }

  private async deleteObjectIfExists(
    client: S3Client,
    ref: StorageObjectRef,
  ): Promise<void> {
    // S3 DeleteObject is a no-op success on absent keys — already idempotent.
    await client.send(
      new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.storageKey }),
    );
  }

  private async deleteAfterPromotion(ref: StorageObjectRef): Promise<void> {
    try {
      await this.deleteObject(ref);
    } catch (err) {
      // Promotion is complete and the final key was never signed. The session
      // reaper can safely retry staging cleanup later.
      this.logger.warn(
        `Promoted S3 staging object but could not delete ${ref.bucket}/${ref.storageKey}: ` +
          errorMessage(err),
      );
    }
  }

  private async ensureBucket(client: S3Client, bucket: string): Promise<void> {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      if (isBucketAlreadyOurs(err)) return;
      throw err;
    }
  }

  /**
   * Storage-side URL for the DB row (`OutputStorageResult.url` — "never
   * expose to clients"). Product reads resolve through
   * `MediaAssetUrlResolverService` (`MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE`)
   * off bucket/objectKey, so this is diagnostic provenance, not a serving
   * path.
   */
  private storageSideUrl(key: string): string {
    const endpoint = this.endpoint.replace(/\/+$/, '');
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return this.forcePathStyle
      ? `${endpoint}/${this.bucket}/${encoded}`
      : `${endpoint.replace('://', `://${this.bucket}.`)}/${encoded}`;
  }
}

/** `CopySource` is a single header value: "<bucket>/<key>", key URI-encoded. */
function encodeCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function isS3NotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.$metadata?.httpStatusCode === 404) return true;
    if (e.name === 'NotFound' || e.name === 'NoSuchKey') return true;
  }
  return false;
}

function isS3BucketMissing(err: unknown): boolean {
  if (isS3NotFound(err)) return true;
  if (err && typeof err === 'object') {
    const name = (err as { name?: string }).name;
    return name === 'NoSuchBucket';
  }
  return false;
}

function assertSameS3Region(
  source: StorageObjectRef,
  destination: StorageObjectRef,
): void {
  if (
    source.region &&
    destination.region &&
    source.region !== destination.region
  ) {
    throw new Error('S3 server-side promotion requires one storage region');
  }
}

function isBucketAlreadyOurs(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string };
    return (
      e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists'
    );
  }
  return false;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env[name] ?? '').trim().toLowerCase(),
  );
}
