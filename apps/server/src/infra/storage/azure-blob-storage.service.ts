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
import { Injectable, Logger } from '@nestjs/common';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import {
  OutputStorageService,
  type OutputStorageResult,
  type OutputStorageUpload,
} from './storage.types';

const DEFAULT_CONTAINER = 'foundry-outputs';

@Injectable()
export class AzureBlobStorageService extends OutputStorageService {
  private readonly logger = new Logger(AzureBlobStorageService.name);
  private readonly client: ContainerClient | null;
  private readonly publicBaseUrl: string | null;
  private readonly containerName: string;

  constructor() {
    super();
    const cs = process.env.AZURE_BLOB_CONNECTION_STRING ?? '';
    this.containerName =
      (process.env.AZURE_BLOB_CONTAINER ?? '').trim() || DEFAULT_CONTAINER;
    this.publicBaseUrl =
      (process.env.AZURE_BLOB_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '') ||
      null;

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
    };
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
