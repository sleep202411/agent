/**
 * Azure Blob implementation of OutputStorageService.
 *
 * Config (env):
 *   AZURE_BLOB_CONNECTION_STRING  — full connection string from the
 *     storage account (Settings → Access keys). Required.
 *   AZURE_BLOB_CONTAINER         — container name. Defaults to
 *     `foundry-outputs`. Container must already exist and be set to
 *     "Blob (anonymous read)" access level for the public URL flow to
 *     work without SAS. For private containers, switch to SAS in a
 *     follow-up (Azure SDK has `generateBlobSASQueryParameters`).
 *   AZURE_BLOB_PUBLIC_BASE_URL   — optional CDN/custom domain prefix.
 *     If unset, falls back to the raw blob.core.windows.net URL.
 *
 * Why connection string instead of DefaultAzureCredential: matches the
 * other Azure-side wiring in this repo (AZURE_OPENAI_API_KEY,
 * AZURE_WEB_PUBSUB_CONNECTION_STRING). When we move to managed
 * identity end-to-end, swap here in one place.
 */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BlobSASPermissions,
  BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import {
  OutputStorageService,
  type CreateUploadUrlInput,
  type CreateUploadUrlResult,
  type HeadObjectResult,
  type OutputStorageResult,
  type OutputStorageUpload,
} from './storage.types';

const DEFAULT_CONTAINER = 'foundry-outputs';
const DEFAULT_UPLOAD_URL_TTL_SECONDS = 900;
/** SAS startsOn skew tolerance — covers small client/server clock drift. */
const SAS_CLOCK_SKEW_MS = 60_000;

@Injectable()
export class AzureBlobStorageService extends OutputStorageService {
  private readonly logger = new Logger(AzureBlobStorageService.name);
  private readonly client: ContainerClient | null;
  private readonly publicBaseUrl: string | null;
  private readonly containerName: string;
  /** Bucket-region for the MediaAsset row. Azure URLs don't need it
   *  (account host carries the region), so null is the honest value. */
  private readonly region: string | null;

  constructor() {
    super();
    const cs = process.env.AZURE_BLOB_CONNECTION_STRING ?? '';
    this.containerName =
      (process.env.AZURE_BLOB_CONTAINER ?? '').trim() || DEFAULT_CONTAINER;
    this.publicBaseUrl =
      (process.env.AZURE_BLOB_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '') ||
      null;
    this.region = (process.env.AZURE_BLOB_REGION ?? '').trim() || null;

    if (!cs) {
      this.logger.warn(
        'AZURE_BLOB_CONNECTION_STRING unset — AzureBlobStorageService is a no-op',
      );
      this.client = null;
      return;
    }
    const service = BlobServiceClient.fromConnectionString(cs);
    this.client = service.getContainerClient(this.containerName);
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
        // gallery images are immutable per key; max-age caches them
        // hard at the CDN. Bytes don't change so this is safe.
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

  async createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const ttl = input.expiresInSeconds ?? DEFAULT_UPLOAD_URL_TTL_SECONDS;
    const expiresOn = new Date(Date.now() + ttl * 1000);
    const block = this.client.getBlockBlobClient(input.storageKey);
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
      bucket: this.containerName,
      region: this.region,
      expiresAt: expiresOn.toISOString(),
    };
  }

  async headObject(key: string): Promise<HeadObjectResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'azure_blob storage is not configured',
      );
    }
    const block = this.client.getBlockBlobClient(key);
    try {
      const props = await block.getProperties();
      return {
        exists: true,
        sizeBytes: props.contentLength,
        contentType: props.contentType,
        provider: 'azure_blob',
        bucket: this.containerName,
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
