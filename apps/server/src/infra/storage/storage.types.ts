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

/**
 * Which impl minted a signed write URL. Mirrors the Prisma
 * `MediaStorageProvider` enum values so the controller can persist
 * `result.provider` straight into `MediaAsset.storageProvider` without a
 * mapping table. Adding a provider = add the enum value here + in Prisma.
 */
export type StorageProviderId = 'azure_blob' | 'aliyun_oss' | 's3_compatible';

/**
 * Input to {@link OutputStorageService.createUploadUrl}.
 *
 * The key is ALWAYS server-decided (see media-upload.service) — never
 * client-controlled — so a leaked endpoint can't be used to overwrite
 * another user's blob.
 */
export interface CreateUploadUrlInput {
  /** SERVER-decided object key. ASCII-safe, uuid'd, scoped to user+feature. */
  storageKey: string;
  /** Pinned into the signature; the browser PUT must echo the same value. */
  contentType: string;
  /**
   * Max bytes the URL should admit. Neither Azure SAS nor OSS V4 presign
   * expose a per-URL byte ceiling, so this is advisory at the provider
   * layer — real enforcement is the server-side pre-check (§4) plus the
   * save-time read-back reconcile. Kept in the contract so a provider that
   * CAN enforce it (e.g. an S3 POST policy) has the value.
   */
  maxBytes: number;
  /** TTL of the signed URL in seconds. Default 900 (15 min). */
  expiresInSeconds?: number;
}

/**
 * Result of {@link OutputStorageService.createUploadUrl}.
 *
 * `provider`/`bucket`/`region` are first-class because the SERVICE (not
 * the controller) is the only thing that knows which impl was selected
 * and where it writes. The controller persists these verbatim onto the
 * `MediaAsset` row so {@link MediaAssetUrlResolverService} can later
 * materialize a read URL with zero provider knowledge in the caller.
 */
export interface CreateUploadUrlResult {
  /** Fully-signed write URL the browser PUTs bytes to. */
  url: string;
  /** Always "PUT" today; in the contract so a provider can differ. */
  method: 'PUT';
  /** Headers the browser MUST echo on the PUT (Azure: x-ms-blob-type). */
  headers: Record<string, string>;
  /** Echoes input.storageKey — authoritative DB key, NOT derived from url. */
  storageKey: string;
  /** Which impl minted this — drives MediaAsset.storageProvider. */
  provider: StorageProviderId;
  /** Azure container / OSS bucket — persisted to MediaAsset.bucket. */
  bucket: string;
  /**
   * Provider region in the form the read resolver expects
   * (`media-asset-url-resolver.service.ts`): bare `cn-hangzhou` for OSS,
   * Azure account region or null. Persisted to MediaAsset.region.
   */
  region: string | null;
  /** Absolute ISO timestamp the URL stops working. Client compares to now. */
  expiresAt: string;
}

/**
 * Result of {@link OutputStorageService.headObject}.
 *
 * `exists` is the only field guaranteed populated. When `false`, the blob
 * is absent (a real 404 from the provider) and the rest are omitted. When
 * `true`, `sizeBytes`/`contentType` are read from the provider's HEAD
 * response and are the AUTHORITATIVE values the confirm step trusts —
 * never the client's declared size/type.
 *
 * `provider`/`bucket`/`region` are the placement of the concrete impl that
 * answered the HEAD (the region factory's selection). The confirm step
 * persists them onto MediaAsset so {@link MediaAssetUrlResolverService}
 * can later materialize a read URL with zero provider knowledge in the
 * caller — without re-minting anything just to learn where the blob lives.
 */
export interface HeadObjectResult {
  exists: boolean;
  /** Real byte length from the provider HEAD (Azure contentLength / OSS content-length). */
  sizeBytes?: number;
  /** Real content-type the blob was stored with. */
  contentType?: string;
  /** Which impl owns this blob — drives MediaAsset.storageProvider. */
  provider?: StorageProviderId;
  /** Azure container / OSS bucket — persisted to MediaAsset.bucket. */
  bucket?: string;
  /** Provider region in read-resolver form — persisted to MediaAsset.region. */
  region?: string | null;
}

export abstract class OutputStorageService {
  abstract upload(input: OutputStorageUpload): Promise<OutputStorageResult>;
  /** Cheap probe for /ready endpoint. Returns false if creds missing or container unreachable. */
  abstract isHealthy(): Promise<boolean>;
  /**
   * NEW: mint a direct-to-storage signed write URL. The browser uploads
   * bytes straight to the provider — never through this server. Throws
   * ServiceUnavailableException when the impl is unconfigured (mirrors
   * `upload()`'s no-op-when-unconfigured posture but as an explicit fault,
   * since a missing URL can't be silently swallowed).
   */
  abstract createUploadUrl(
    input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult>;
  /**
   * HEAD a blob to confirm it ACTUALLY EXISTS and read its real
   * `sizeBytes` + `contentType` straight from storage. Backs the
   * `POST /aurora/media/confirm` step: storage is the source of truth, so
   * a MediaAsset is only ever written for bytes that physically landed —
   * no phantom rows, and the persisted size/type are never client-claimed.
   *
   * Returns `{ exists: false }` on a real 404 (blob absent). Throws the
   * same ServiceUnavailableException as the other methods when the impl is
   * unconfigured, so a missing-creds fault is never mistaken for a 404.
   */
  abstract headObject(key: string): Promise<HeadObjectResult>;
}
