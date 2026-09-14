import { requirePrivateUploadTarget } from './private-upload-target';
/**
 * Azure Blob implementation of OutputStorageService.
 *
 * Config (env):
 *   AZURE_BLOB_CONNECTION_STRING  — full connection string from the
 *     storage account (Settings → Access keys). Required.
 *   AZURE_BLOB_CONTAINER         — container name. Defaults to
 *     `foundry-outputs`. Containers should be private; reads are issued
 *     through short-lived SAS URLs after application-level access checks.
 *   AZURE_BLOB_PUBLIC_BASE_URL   — internal CDN/custom domain prefix kept for
 *     legacy resolver + purge compatibility. Product reads go through
 *     createReadUrl(), not through public blob URLs.
 *
 * Why connection string instead of DefaultAzureCredential: matches the
 * other Azure-side wiring in this repo (AZURE_OPENAI_API_KEY,
 * AZURE_WEB_PUBSUB_CONNECTION_STRING). When we move to managed
 * identity end-to-end, swap here in one place.
 */
import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BlobSASPermissions,
  BlobServiceClient,
  type BlobClient,
  type ContainerClient,
} from '@azure/storage-blob';
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

const DEFAULT_CONTAINER = 'foundry-outputs';
const DEFAULT_UPLOAD_URL_TTL_SECONDS = 900;
const DEFAULT_READ_URL_TTL_SECONDS = 300;
/** SAS startsOn skew tolerance — covers small client/server clock drift. */
const SAS_CLOCK_SKEW_MS = 60_000;
/** Server-only read SAS must outlive the longest accepted async copy. */
const COPY_SOURCE_SAS_TTL_SECONDS = 60 * 60;
const COPY_COMPLETION_TIMEOUT_MS = 55 * 60_000;
const COPY_STATUS_POLL_MS = 1_000;

@Injectable()
export class AzureBlobStorageService extends OutputStorageService {
  readonly providerId = 'azure_blob' as const;
  private readonly logger = new Logger(AzureBlobStorageService.name);
  private readonly service: BlobServiceClient | null;
  private readonly client: ContainerClient | null;
  private readonly publicBaseUrl: string | null;
  private readonly containerName: string;
  private readonly privateUploadTarget = (
    process.env.AZURE_BLOB_PRIVATE_CONTAINER ?? ''
  ).trim();
  /** Private container that takendown blobs are moved into (Azure has no
   *  per-blob ACL). Defaults to `${container}-quarantine`. Created on demand. */
  private readonly quarantineContainer: string;
  /** Bucket-region for the MediaAsset row. Azure URLs don't need it
   *  (account host carries the region), so null is the honest value. */
  private readonly region: string | null;

  constructor() {
    super();
    const cs = (process.env.AZURE_BLOB_CONNECTION_STRING ?? '').trim();
    this.containerName =
      (process.env.AZURE_BLOB_CONTAINER ?? '').trim() || DEFAULT_CONTAINER;
    this.publicBaseUrl =
      (process.env.AZURE_BLOB_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '') ||
      null;
    this.quarantineContainer =
      (process.env.AZURE_BLOB_QUARANTINE_CONTAINER ?? '').trim() ||
      `${this.containerName}-quarantine`;
    this.region = (process.env.AZURE_BLOB_REGION ?? '').trim() || null;

    if (!cs) {
      this.logger.warn(
        'AZURE_BLOB_CONNECTION_STRING unset — AzureBlobStorageService is a no-op',
      );
      this.service = null;
      this.client = null;
      return;
    }
    const service = BlobServiceClient.fromConnectionString(cs);
    this.service = service;
    this.client = this.containerClient(this.containerName);
  }

  objectLocation(key: string) {
    this.assertConfigured('Object storage');
    return {
      storageProvider: this.providerId,
      bucket: this.containerName,
      region: this.region,
      objectKey: key,
      externalUrl: null,
    };
  }

  assertConfigured(context: string): void {
    if (!this.client)
      throw new Error(`${context} requires AZURE_BLOB_CONNECTION_STRING`);
  }

  async upload(input: OutputStorageUpload): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('AZURE_BLOB_CONNECTION_STRING not configured');
    }
    const block = this.client.getBlockBlobClient(input.key);
    // overwrite-safe: deterministic keys collide only on re-upload of
    // the same content, which is the idempotent recovery path.
    await block.uploadData(input.body, {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
        ...(input.filename
          ? {
              blobContentDisposition: `inline; filename="${input.filename}"`,
            }
          : {}),
        // Object keys are content-addressed (uuid + hash), so the bytes are
        // immutable — cache them aggressively for CDN/browser performance.
        // Moderation takedown invalidates a blocked object at the storage layer
        // (ACL/quarantine) plus a CDN purge; it does not rely on cache headers.
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return {
      url: this.publicUrl(input.key, block.url),
      storagePath: input.key,
      bytes: input.body.byteLength,
      provider: 'azure_blob',
      bucket: this.containerName,
      region: this.region,
    };
  }

  override async uploadFromFile(
    input: OutputStorageUploadFromFile,
  ): Promise<OutputStorageResult> {
    if (!this.client) {
      throw new Error('AZURE_BLOB_CONNECTION_STRING not configured');
    }
    const block = this.client.getBlockBlobClient(input.key);
    // Staged block upload straight from disk — the SDK streams the file in
    // chunks, so a 300MB-class video output never sits in process memory.
    await block.uploadFile(input.filePath, {
      blobHTTPHeaders: {
        blobContentType: input.contentType,
        ...(input.filename
          ? {
              blobContentDisposition: `inline; filename="${input.filename}"`,
            }
          : {}),
        // Same immutable-bytes caching rationale as upload().
        blobCacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return {
      url: this.publicUrl(input.key, block.url),
      storagePath: input.key,
      bytes: input.sizeBytes,
      provider: 'azure_blob',
      bucket: this.containerName,
      region: this.region,
    };
  }

  async beginMultipartUpload(
    storageKey: string,
    contentType: string,
  ): Promise<MultipartUploadRef> {
    if (!this.client)
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    // An empty blob makes the uncommitted block list queryable before part one.
    await this.client
      .getBlockBlobClient(storageKey)
      .uploadData(Buffer.alloc(0), {
        blobHTTPHeaders: { blobContentType: contentType },
      });
    return {
      storageKey,
      uploadId: randomUUID(),
      bucket: this.containerName,
      region: this.region,
    };
  }

  private uploadBlockId(ref: MultipartUploadRef, number: number): string {
    return Buffer.from(
      `${ref.uploadId}:${String(number).padStart(6, '0')}`,
    ).toString('base64');
  }

  async listUploadParts(ref: MultipartUploadRef): Promise<StoredUploadPart[]> {
    const result = await this.containerClient(ref.bucket)
      .getBlockBlobClient(ref.storageKey)
      .getBlockList('uncommitted');
    return (result.uncommittedBlocks ?? []).map((block) => {
      const raw = Buffer.from(block.name, 'base64').toString();
      const number = Number(raw.slice(ref.uploadId.length + 1));
      if (
        !raw.startsWith(`${ref.uploadId}:`) ||
        !Number.isInteger(number) ||
        number < 1
      )
        throw new Error('Invalid stored upload block');
      return { number, sizeBytes: block.size, etag: block.name };
    });
  }

  async signUploadPart(
    ref: MultipartUploadRef,
    number: number,
  ): Promise<UploadPartUrl> {
    const block = this.containerClient(ref.bucket).getBlockBlobClient(
      ref.storageKey,
    );
    const url = new URL(
      await block.generateSasUrl({
        permissions: BlobSASPermissions.parse('w'),
        expiresOn: new Date(Date.now() + 900_000),
        startsOn: new Date(Date.now() - SAS_CLOCK_SKEW_MS),
      }),
    );
    url.searchParams.set('comp', 'block');
    url.searchParams.set('blockid', this.uploadBlockId(ref, number));
    return { url: url.toString(), headers: {} };
  }

  async completeMultipartUpload(
    ref: MultipartUploadRef,
    parts: StoredUploadPart[],
    contentType: string,
  ): Promise<void> {
    await this.containerClient(ref.bucket)
      .getBlockBlobClient(ref.storageKey)
      .commitBlockList(
        parts.map((p) => this.uploadBlockId(ref, p.number)),
        {
          blobHTTPHeaders: {
            blobContentType: contentType,
            blobCacheControl: IMMUTABLE_STORAGE_CACHE_CONTROL,
          },
        },
      );
  }

  async abortMultipartUpload(ref: MultipartUploadRef): Promise<void> {
    // Azure has no AbortMultipartUpload. Committing an empty list discards all
    // uncommitted blocks, then delete removes the temporary empty object.
    const block = this.containerClient(ref.bucket).getBlockBlobClient(
      ref.storageKey,
    );
    await block.commitBlockList([]);
    await block.deleteIfExists();
  }

  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    return this.signUploadUrl(input, this.containerName);
  }

  async createPrivateUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    const target = requirePrivateUploadTarget(
      'AZURE_BLOB_PRIVATE_CONTAINER',
      this.privateUploadTarget,
      [this.containerName, this.quarantineContainer],
    );
    return this.signUploadUrl(input, target);
  }

  private async signUploadUrl(
    input: CreateUploadUrlInput,
    target: string,
  ): Promise<CreateUploadUrlResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_UPLOAD_URL_TTL_SECONDS;
    const expiresOn = new Date(Date.now() + ttl * 1000);
    const block = this.containerClient(target).getBlockBlobClient(
      input.storageKey,
    );
    // Write-SAS via the SDK. The signing credential is the
    // StorageSharedKeyCredential already parsed from the connection
    // string by BlobServiceClient.fromConnectionString — no new env var.
    //
    // Permissions are create+write ONLY ('cw') — no read, no delete, no
    // list. A leaked SAS can neither exfiltrate nor destroy; the worst it
    // can do is write bytes under the one uuid'd key we minted it for.
    //
    // contentType is pinned into the signature: the browser's PUT must
    // send the identical Content-Type or Azure rejects it. uploads.ts
    // already sets Content-Type from file.type, kept in lockstep here.
    const url = await block.generateSasUrl({
      permissions: BlobSASPermissions.parse('cw'),
      expiresOn,
      startsOn: new Date(Date.now() - SAS_CLOCK_SKEW_MS),
      contentType: input.contentType,
    });
    return {
      url,
      method: 'PUT',
      // x-ms-blob-type is MANDATORY for a single-PUT block blob. The
      // client merges this into its PUT headers (uploads.ts spreads
      // info.headers). Content-Type is echoed because it's signed above.
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': input.contentType,
      },
      storageKey: input.storageKey,
      provider: 'azure_blob',
      bucket: target,
      region: this.region,
      expiresAt: expiresOn.toISOString(),
    };
  }

  async createReadUrl(input: CreateReadUrlInput): Promise<CreateReadUrlResult> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_READ_URL_TTL_SECONDS;
    const expiresOn = new Date(Date.now() + ttl * 1000);
    const blob = this.containerClient(input.bucket).getBlobClient(
      input.storageKey,
    );
    const url = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      startsOn: new Date(Date.now() - SAS_CLOCK_SKEW_MS),
      cacheControl: input.cacheControl ?? undefined,
      contentType: input.contentType ?? undefined,
      contentDisposition: input.filename
        ? `inline; filename="${input.filename}"`
        : undefined,
    });
    return {
      url,
      provider: 'azure_blob',
      bucket: input.bucket,
      storageKey: input.storageKey,
      expiresAt: expiresOn.toISOString(),
    };
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    return this.headStoredObject({
      bucket: this.containerName,
      storageKey: key,
      region: this.region,
    });
  }

  override async headStoredObject(
    ref: StorageObjectRef,
  ): Promise<HeadObjectResult> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const block = this.containerClient(ref.bucket).getBlockBlobClient(
      ref.storageKey,
    );
    try {
      const props = await block.getProperties();
      return {
        exists: true,
        sizeBytes: props.contentLength,
        contentType: props.contentType,
        etag: props.etag,
        provider: 'azure_blob',
        bucket: ref.bucket,
        region: this.region,
      };
    } catch (err) {
      // A genuine "blob not found" is a 404 RestError — that's the
      // confirm-step's "no bytes landed" signal, NOT a fault. Anything
      // else (auth/network) is a real error and must surface so a transient
      // failure is never mistaken for an absent blob.
      if (isAzureNotFound(err)) {
        return { exists: false };
      }
      throw err;
    }
  }

  override async promoteObject(
    input: PromoteStorageObjectInput,
  ): Promise<PromoteStorageObjectResult> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    assertStoragePromotionLocations(input.source, input.destination);
    assertExpectedStorageObjectSize(input.expectedSizeBytes);

    const cacheControl = input.cacheControl ?? IMMUTABLE_STORAGE_CACHE_CONTROL;
    const finalBlob = this.containerClient(
      input.destination.bucket,
    ).getBlockBlobClient(input.destination.storageKey);
    let existing = await this.headStoredObject(input.destination);
    if (existing.exists && !(await this.copyDestinationIsUsable(finalBlob))) {
      await finalBlob.deleteIfExists();
      existing = { exists: false };
    }
    if (!existing.exists) {
      const source = await this.headStoredObject(input.source);
      assertStoredObjectSize(input.source, source, input.expectedSizeBytes);
      await this.copyBlob(input.source, input.destination);
    }

    // Copy inherits staging headers. Rewrite them only on the unsigned final
    // object so staging remains disposable and the final object is immutable.
    await finalBlob.setHTTPHeaders({
      blobCacheControl: cacheControl,
      blobContentType: input.contentType,
    });
    const finalHead = await this.headStoredObject(input.destination);
    assertStoredObjectSize(
      input.destination,
      finalHead,
      input.expectedSizeBytes,
    );
    await this.deleteAfterPromotion(input.source);
    return promotionResult(
      'azure_blob',
      input.destination,
      input.expectedSizeBytes,
      input.contentType,
      finalHead.etag,
      this.region,
    );
  }

  override async deleteObject(ref: StorageObjectRef): Promise<void> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    await this.deleteBlobIfExists(ref);
  }

  // The SAS write-URL (createUploadUrl) can't set the blob's Cache-Control, so
  // SAS-uploaded objects land without it and Front Door won't cache them. Set it
  // after the bytes land. setHTTPHeaders REPLACES all blob HTTP headers, so
  // re-assert Content-Type (no Content-Disposition is set on these uploads).
  override async setCacheControl(
    key: string,
    cacheControl: string,
    contentType?: string | null,
  ): Promise<void> {
    if (!this.client) return;
    const block = this.client.getBlockBlobClient(key);
    await block.setHTTPHeaders({
      blobCacheControl: cacheControl,
      ...(contentType ? { blobContentType: contentType } : {}),
    });
  }

  async restrictObject(ref: StorageObjectRef): Promise<RestrictObjectResult> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const target: StorageObjectRef = {
      bucket: this.quarantineContainer,
      storageKey: ref.storageKey,
    };
    // Idempotent: if the blob already sits in quarantine (and the source is
    // gone), a retry is a no-op success.
    if (await this.blobExists(target)) {
      await this.deleteBlobIfExists(ref);
      return { ...target, relocated: true };
    }
    if (!(await this.blobExists(ref))) {
      // Source already gone but target absent — nothing to move. Surface so the
      // queue marks it done rather than spinning; quarantine is the intent.
      return { ...target, relocated: true };
    }
    await this.copyBlob(ref, target);
    await this.deleteBlobIfExists(ref);
    return { ...target, relocated: true };
  }

  async restoreObject(
    current: StorageObjectRef,
    original: StorageObjectRef,
  ): Promise<RestrictObjectResult> {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    // Same location → nothing was relocated (object never quarantined); a no-op.
    // Guards the always-run restore path from deleting a still-public object
    // when current === original.
    if (
      current.bucket === original.bucket &&
      current.storageKey === original.storageKey
    ) {
      return { ...original, relocated: false };
    }
    // Idempotent: object already back at its public location.
    if (await this.blobExists(original)) {
      await this.deleteBlobIfExists(current);
      return { ...original, relocated: true };
    }
    if (!(await this.blobExists(current))) {
      // Neither location has the blob — can't restore. Report the public
      // location anyway so the DB row stops pointing at quarantine.
      return { ...original, relocated: true };
    }
    await this.copyBlob(current, original);
    await this.deleteBlobIfExists(current);
    return { ...original, relocated: true };
  }

  /** Server-side copy within the storage account. The source is authorized
   *  with a short read-SAS so the copy works regardless of the source
   *  container's public/private access level. */
  private async copyBlob(
    source: StorageObjectRef,
    target: StorageObjectRef,
  ): Promise<void> {
    await this.containerClient(target.bucket).createIfNotExists();
    const sourceBlob = this.containerClient(source.bucket).getBlobClient(
      source.storageKey,
    );
    const sourceSas = await sourceBlob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + COPY_SOURCE_SAS_TTL_SECONDS * 1000),
      startsOn: new Date(Date.now() - SAS_CLOCK_SKEW_MS),
    });
    const targetBlob = this.containerClient(target.bucket).getBlobClient(
      target.storageKey,
    );
    const poller = await targetBlob.beginCopyFromURL(sourceSas, {
      intervalInMs: COPY_STATUS_POLL_MS,
    });
    const timeoutError = new ServiceUnavailableException({
      code: 'AZURE_BLOB_COPY_TIMEOUT',
      message: 'Azure Blob timed out while copying the uploaded video.',
    });
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        poller.pollUntilDone(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(timeoutError),
            COPY_COMPLETION_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (error === timeoutError) {
        await poller.cancelOperation().catch(() => undefined);
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!(await this.copyDestinationIsUsable(targetBlob))) {
      throw new ServiceUnavailableException({
        code: 'AZURE_BLOB_COPY_FAILED',
        message: 'Azure Blob did not complete the server-side copy.',
      });
    }
  }

  private async copyDestinationIsUsable(blob: BlobClient): Promise<boolean> {
    const deadline = Date.now() + COPY_COMPLETION_TIMEOUT_MS;
    for (;;) {
      const properties = await blob.getProperties();
      const status = properties.copyStatus;
      if (!status || status === 'success') return true;
      if (status === 'failed' || status === 'aborted') return false;
      if (Date.now() >= deadline) {
        throw new ServiceUnavailableException({
          code: 'AZURE_BLOB_COPY_TIMEOUT',
          message: 'Azure Blob timed out while copying the uploaded video.',
        });
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, COPY_STATUS_POLL_MS),
      );
    }
  }

  private async blobExists(ref: StorageObjectRef): Promise<boolean> {
    return this.containerClient(ref.bucket)
      .getBlobClient(ref.storageKey)
      .exists();
  }

  private async deleteBlobIfExists(ref: StorageObjectRef): Promise<void> {
    await this.containerClient(ref.bucket)
      .getBlobClient(ref.storageKey)
      .deleteIfExists();
  }

  private async deleteAfterPromotion(ref: StorageObjectRef): Promise<void> {
    try {
      await this.deleteObject(ref);
    } catch (err) {
      // The never-signed final object is already durable. A lingering staging
      // object cannot mutate it and will be reclaimed by the session reaper.
      this.logger.warn(
        `Promoted Azure staging object but could not delete ${ref.bucket}/${ref.storageKey}: ` +
          errorMessage(err),
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.client) return false;
    try {
      // A cheap operation that round-trips the storage account: HEAD
      // on the container's properties. Returns 200 / 404; either way
      // proves the credentials work and the network is reachable.
      await this.client.getProperties();
      return true;
    } catch (err) {
      this.logger.warn(
        `Azure Blob health probe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private publicUrl(key: string, sdkUrl: string): string {
    if (!this.publicBaseUrl) return sdkUrl;
    return `${this.publicBaseUrl}/${this.containerName}/${key}`;
  }

  private containerClient(container: string): ContainerClient {
    if (!this.service) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    return this.service.getContainerClient(container);
  }
}

/**
 * A getProperties() failure is a "blob absent" (404) when the SDK's
 * RestError carries statusCode 404 or the storage code is BlobNotFound.
 * We pattern-match defensively (statusCode OR code) without importing
 * RestError, so a minor SDK shape change can't break the happy path.
 */
function isAzureNotFound(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: number; code?: string };
    if (e.statusCode === 404) return true;
    if (e.code === 'BlobNotFound' || e.code === 'ContainerNotFound') {
      return true;
    }
  }
  return false;
}

function promotionResult(
  provider: 'azure_blob',
  ref: StorageObjectRef,
  sizeBytes: number,
  contentType: string,
  etag: string | undefined,
  defaultRegion: string | null,
): PromoteStorageObjectResult {
  return {
    bucket: ref.bucket,
    storageKey: ref.storageKey,
    region: ref.region ?? defaultRegion,
    provider,
    sizeBytes,
    contentType,
    ...(etag ? { etag } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
