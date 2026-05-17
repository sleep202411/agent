/**
 * Output storage abstraction.
 *
 * Today: Azure Blob Storage (intl primary, matches the Foundry side
 * already running on Azure). Tomorrow: a sibling Alibaba OSS impl
 * picked by env so the CN deployment keeps data in-region. Callers
 * never reach for a provider SDK — they go through this interface.
 */

export interface OutputStorageUpload {
  /** Bytes to upload. */
  body: Buffer;
  /**
   * Deterministic object key. Production layout:
   *   foundry/{yyyy}/{mm}/{dd}/{userId}/{jobId}/{outputIndex}-{hash}.{ext}
   * Same key → same blob; safe to re-run an attempt that died after
   * upload but before DB commit.
   */
  key: string;
  contentType: string;
  /** Optional, lets the CDN serve a friendlier filename on download. */
  filename?: string;
}

export interface OutputStorageResult {
  /** Publicly fetchable URL. May include a SAS token if container is private. */
  url: string;
  /** Storage-side key the blob lives under, echoed back for the DB row. */
  storagePath: string;
  /** Size of the uploaded bytes, useful for accounting. */
  bytes: number;
}

export abstract class OutputStorageService {
  abstract upload(input: OutputStorageUpload): Promise<OutputStorageResult>;
  /** Cheap probe for /ready endpoint. Returns false if creds missing or container unreachable. */
  abstract isHealthy(): Promise<boolean>;
}
