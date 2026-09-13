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

/**
 * Input to {@link OutputStorageService.uploadFromFile} — the large-output
 * path. The bytes come from a disk spool file instead of a Buffer so a
 * 300MB-class video output (Seedance 4k HEVC) never has to fit in process
 * memory; impls upload with their staged/multipart file APIs.
 */
export interface OutputStorageUploadFromFile {
  /** Absolute path of the spooled file. Caller owns cleanup. */
  filePath: string;
  /** Exact size of the spooled file, echoed into the result. */
  sizeBytes: number;
  /** Same deterministic key contract as {@link OutputStorageUpload.key}. */
  key: string;
  contentType: string;
  filename?: string;
}

export interface OutputStorageResult {
  /** Storage-side URL returned by the provider SDK. Never expose this to clients. */
  url: string;
  /** Storage-side key the blob lives under, echoed back for the DB row. */
  storagePath: string;
  /** Size of the uploaded bytes, useful for accounting. */
  bytes: number;
  /** Which storage backend owns this persisted output. */
  provider: StorageProviderId;
  /** Azure container / OSS bucket the output was written to. */
  bucket: string;
  /** Provider region in MediaAsset resolver form. */
  region: string | null;
}

/**
 * Which impl minted a signed write URL. Mirrors the Prisma
 * `MediaStorageProvider` enum values so the controller can persist
 * `result.provider` straight into `MediaAsset.storageProvider` without a
 * mapping table. Adding a provider = add the enum value here + in Prisma.
 */
export type StorageProviderId = 'azure_blob' | 'aliyun_oss' | 's3_compatible';

/** Provider-owned multipart state. Never accept this identity from a browser. */
export interface MultipartUploadRef {
  storageKey: string;
  uploadId: string;
  bucket: string;
  region: string | null;
}

export interface StoredUploadPart {
  number: number;
  sizeBytes: number;
  etag: string;
}

export interface UploadPartUrl {
  url: string;
  headers: Record<string, string>;
}

export const IMMUTABLE_STORAGE_CACHE_CONTROL =
  'public, max-age=31536000, immutable';

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
 * `MediaAsset` row so the media access service can later mint a controlled
 * signed read URL with zero provider knowledge in the caller.
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
 * persists them onto MediaAsset so the media access service can later
 * mint a controlled signed read URL with zero provider knowledge in the
 * caller — without re-minting anything just to learn where the blob lives.
 */
export interface HeadObjectResult {
  exists: boolean;
  /** Real byte length from the provider HEAD (Azure contentLength / OSS content-length). */
  sizeBytes?: number;
  /** Real content-type the blob was stored with. */
  contentType?: string;
  /**
   * Provider ETag/version fingerprint when available. It is diagnostic for
   * callers; finalization safety does not depend on it because staged bytes
   * are promoted to an unsigned final key before they are probed.
   */
  etag?: string;
  /** Which impl owns this blob — drives MediaAsset.storageProvider. */
  provider?: StorageProviderId;
  /** Azure container / OSS bucket — persisted to MediaAsset.bucket. */
  bucket?: string;
  /** Provider region in read-resolver form — persisted to MediaAsset.region. */
  region?: string | null;
}

export interface CreateReadUrlInput {
  /** Provider bucket/container recorded on the MediaAsset/Placement row. */
  bucket: string;
  /** Stable object key inside the bucket/container. */
  storageKey: string;
  /**
   * Bare provider region (e.g. `cn-hangzhou`). Required for OSS so a legacy
   * object outside the cell-default region is signed against the right
   * endpoint; ignored by Azure (the account host carries the region).
   */
  region?: string | null;
  /**
   * Response cache policy for this signed read. This intentionally overrides
   * object-level immutable cache headers so moderation takedowns are not
   * defeated by a stale browser/CDN response.
   */
  cacheControl?: string | null;
  /** Optional response content type hint for providers that support it. */
  contentType?: string | null;
  /** Optional browser download/display filename. */
  filename?: string | null;
  /** TTL in seconds. Defaults are provider-side and intentionally short. */
  expiresInSeconds?: number;
}

export interface CreateReadUrlResult {
  /** Fully signed, read-only URL. */
  url: string;
  provider: StorageProviderId;
  bucket: string;
  storageKey: string;
  expiresAt: string;
}

/** A single physical stored object — the unit a moderation takedown acts on. */
export interface StorageObjectRef {
  /** Azure container / OSS bucket the object currently lives in. */
  bucket: string;
  /** Object key inside that bucket/container. */
  storageKey: string;
  /**
   * Bare provider region (e.g. `cn-hangzhou`) persisted on the asset/placement.
   * Required for OSS so a legacy object in a non-default region is signed
   * against the correct regional endpoint; ignored by Azure (the account host
   * carries the region).
   */
  region?: string | null;
}

/**
 * Server-side staging -> final promotion. Only the staging object is ever
 * exposed through a signed write URL; `destination` MUST be a server-chosen,
 * never-signed key. Provider implementations copy the object wholly inside
 * storage, validate the final byte length, apply immutable cache headers, and
 * then make a best-effort idempotent deletion of the staging object.
 */
export interface PromoteStorageObjectInput {
  source: StorageObjectRef;
  destination: StorageObjectRef;
  /** Authoritative size captured by confirm-time HEAD. */
  expectedSizeBytes: number;
  /** Content type to persist on the immutable final object. */
  contentType: string;
  /** Defaults to the platform's one-year immutable public cache policy. */
  cacheControl?: string;
}

export interface PromoteStorageObjectResult extends StorageObjectRef {
  provider: StorageProviderId;
  region: string | null;
  sizeBytes: number;
  contentType: string;
  etag?: string;
}

/** Stable error type for a missing source/destination during finalization. */
export class StorageObjectNotFoundError extends Error {
  readonly code = 'STORAGE_OBJECT_NOT_FOUND';

  constructor(readonly ref: StorageObjectRef) {
    super(`Storage object not found: ${ref.bucket}/${ref.storageKey}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

/** Stable error type for a provider object whose bytes do not match the job. */
export class StorageObjectSizeMismatchError extends Error {
  readonly code = 'STORAGE_OBJECT_SIZE_MISMATCH';

  constructor(
    readonly ref: StorageObjectRef,
    readonly expectedSizeBytes: number,
    readonly actualSizeBytes: number | undefined,
  ) {
    super(
      `Storage object size mismatch for ${ref.bucket}/${ref.storageKey}: ` +
        `expected ${expectedSizeBytes}, got ${actualSizeBytes ?? 'unknown'}`,
    );
    this.name = 'StorageObjectSizeMismatchError';
  }
}

export function assertStoragePromotionLocations(
  source: StorageObjectRef,
  destination: StorageObjectRef,
): void {
  if (
    source.bucket === destination.bucket &&
    source.storageKey === destination.storageKey
  ) {
    throw new Error('Storage promotion destination must differ from staging');
  }
}

export function assertExpectedStorageObjectSize(
  expectedSizeBytes: number,
): void {
  if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 0) {
    throw new RangeError(
      'expectedSizeBytes must be a non-negative safe integer',
    );
  }
}

export function assertStoredObjectSize(
  ref: StorageObjectRef,
  head: HeadObjectResult,
  expectedSizeBytes: number,
): asserts head is HeadObjectResult & { exists: true; sizeBytes: number } {
  if (!head.exists) throw new StorageObjectNotFoundError(ref);
  if (head.sizeBytes !== expectedSizeBytes) {
    throw new StorageObjectSizeMismatchError(
      ref,
      expectedSizeBytes,
      head.sizeBytes,
    );
  }
}

/**
 * Result of {@link OutputStorageService.restrictObject} /
 * {@link OutputStorageService.restoreObject}.
 *
 * `bucket`/`storageKey` are where the object lives AFTER the operation:
 * - OSS flips the object ACL in place → location is UNCHANGED, `relocated:false`.
 * - Azure has no per-blob ACL → the object is server-side copied to a private
 *   quarantine container and the source deleted → location CHANGES,
 *   `relocated:true`. The caller persists the new location so admin evidence
 *   reads and a later restore can find the object.
 */
export interface RestrictObjectResult {
  bucket: string;
  storageKey: string;
  relocated: boolean;
}

export abstract class OutputStorageService {
  abstract beginMultipartUpload(
    storageKey: string,
    contentType: string,
  ): Promise<MultipartUploadRef>;
  abstract listUploadParts(
    ref: MultipartUploadRef,
  ): Promise<StoredUploadPart[]>;
  abstract signUploadPart(
    ref: MultipartUploadRef,
    number: number,
  ): Promise<UploadPartUrl>;
  abstract completeMultipartUpload(
    ref: MultipartUploadRef,
    parts: StoredUploadPart[],
    contentType: string,
  ): Promise<void>;
  abstract abortMultipartUpload(ref: MultipartUploadRef): Promise<void>;
  /** Stable provider identity for diagnostics and provider-aware orchestration. */
  abstract readonly providerId: StorageProviderId;
  abstract upload(input: OutputStorageUpload): Promise<OutputStorageResult>;
  /**
   * Upload from a disk spool file. Azure/OSS override with their staged
   * block / multipart file APIs so the bytes stream from disk; this default
   * exists only so other impls (and test doubles) keep working — it buffers
   * the whole file and MUST NOT be relied on for large outputs.
   */
  async uploadFromFile(
    input: OutputStorageUploadFromFile,
  ): Promise<OutputStorageResult> {
    const { readFile } = await import('node:fs/promises');
    return this.upload({
      body: await readFile(input.filePath),
      key: input.key,
      contentType: input.contentType,
      filename: input.filename,
    });
  }
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
  /** Sign directly into an explicitly configured private destination. No public-media fallback.
   * Deployment must disable anonymous access/CDN publication for this destination.
   * Domain callers still enforce ownership, limits, finalization and retention.
   */
  createPrivateUploadUrl(
    _input: CreateUploadUrlInput,
  ): Promise<CreateUploadUrlResult> {
    void _input;
    return Promise.reject(
      new Error('Private uploads are not supported by this storage provider'),
    );
  }

  /**
   * Mint a short-lived, read-only URL. Product surfaces should call this only
   * after domain access checks have passed; storage providers do not know
   * about users, workspaces, moderation, or entitlements.
   */
  abstract createReadUrl(
    input: CreateReadUrlInput,
  ): Promise<CreateReadUrlResult>;
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
  /**
   * HEAD an explicit persisted placement. The default preserves compatibility
   * with test doubles and legacy single-bucket providers; production
   * providers override it so bucket/container and region are honored.
   */
  async headStoredObject(ref: StorageObjectRef): Promise<HeadObjectResult> {
    return this.headObject(ref.storageKey);
  }
  /**
   * Promote staged bytes to a server-chosen final key. Implementations MUST be
   * idempotent: a retry that finds a valid final object converges successfully.
   * The final object is verified before staging deletion is attempted.
   */
  abstract promoteObject(
    input: PromoteStorageObjectInput,
  ): Promise<PromoteStorageObjectResult>;
  /**
   * Idempotently delete one explicit placement. Used by upload-session
   * reclamation; deleting an absent object is success.
   */
  abstract deleteObject(ref: StorageObjectRef): Promise<void>;
  /**
   * Best-effort: set the stored object's `Cache-Control` so Front Door + the
   * browser cache it. Object keys are content-addressed (uuid + hash) → the
   * bytes are immutable, so public media is cached aggressively. The SAS
   * direct-upload path does NOT set this on the blob, so confirmUpload calls
   * this after the bytes land.
   *
   * Default is a no-op — only providers whose direct-upload path leaves the
   * stored object without Cache-Control override it (Azure Blob does; OSS
   * already sets it on its own `upload()`). MUST NOT throw — a failure here
   * must never break confirmUpload; callers wrap it defensively too.
   */
  setCacheControl(
    key: string,
    cacheControl: string,
    contentType?: string | null,
  ): Promise<void> {
    // no-op default; impls override where the upload path doesn't set it.
    void key;
    void cacheControl;
    void contentType;
    return Promise.resolve();
  }
  /**
   * Make a single stored object unreachable via its public URL — the physical
   * half of a moderation takedown (the DB/DTO half is the moderation status
   * gate). OSS flips the object ACL to private; Azure copies the blob into a
   * private quarantine container and deletes the source (no per-blob ACL).
   *
   * MUST be idempotent: re-running on an already-restricted object resolves
   * cleanly (so the action queue can retry safely). Throws
   * ServiceUnavailableException when the impl is unconfigured.
   */
  abstract restrictObject(ref: StorageObjectRef): Promise<RestrictObjectResult>;
  /**
   * Reverse {@link restrictObject}. `current` is where the object lives now
   * (the quarantine location for Azure, unchanged for OSS); `original` is the
   * public location to restore it to (used by Azure to copy back; ignored by
   * OSS, which flips the ACL in place). MUST be idempotent.
   */
  abstract restoreObject(
    current: StorageObjectRef,
    original: StorageObjectRef,
  ): Promise<RestrictObjectResult>;
}
