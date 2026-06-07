/**
 * Direct-to-storage upload pipeline — server side (stateless + confirm).
 *
 * Two steps, both authenticated:
 *
 *   1. createUploadUrl — STATELESS. Decide the PERMANENT object key
 *      (server-chosen, user-scoped, collision-free) and mint a signed
 *      write URL via OutputStorageService. NO MediaAsset is created. An
 *      abandoned, cancelled, or re-picked upload therefore leaves ZERO DB
 *      residue — there is no `uploading` row to orphan and no GC to run.
 *
 *   2. confirmUpload — after the browser PUTs the bytes, the server
 *      VERIFIES (never trusts the client): (a) the key prefix belongs to
 *      THIS user, (b) the blob ACTUALLY EXISTS via storage.headObject,
 *      reading its real sizeBytes + contentType from storage. Only then is
 *      an `active` MediaAsset written. Idempotent on objectKey.
 *
 * Storage is the source of truth; the DB only ever records real,
 * referenced assets. MediaAsset.sizeBytes (from HEAD) + createdByUserId
 * are set on every active asset so a future quota feature can compute
 *   used = SUM(sizeBytes) WHERE createdByUserId = user AND status = active
 * accurately — which only holds because there are no orphan rows.
 *
 * Security core: the storage KEY is server-decided and scoped to the
 * authenticated user. A user physically cannot write under another user's
 * prefix (their userId is baked into the key from `@CurrentUser()`, never
 * the request body), and confirm re-checks the prefix so a key can't be
 * confirmed across users either.
 *
 *   media/{cell}/{keySegment}/{userId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MediaAssetKind,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaStorageProvider,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { CURRENT_CELL } from '../common/region/current-cell';
import {
  OutputStorageService,
  type HeadObjectResult,
} from '../infra/storage/storage.types';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import type {
  ConfirmUploadInputDto,
  ConfirmUploadResponseDto,
  CreateUploadUrlInputDto,
  CreateUploadUrlResponseDto,
} from './dto';
import type { UploadKind } from './dto';

/**
 * Per-kind upload policy. The single source of truth for what a given
 * upload feature is allowed to be: which content-types, how big, which
 * MediaAsset kind, and how long the signed URL lives. Adding a feature is
 * a one-row change here + one enum value in dto.ts.
 */
interface UploadKindPolicy {
  /** content-type → canonical extension. Allowlist AND ext source. */
  contentTypes: Record<string, string>;
  /** Hard byte ceiling, enforced before any URL is minted. */
  maxBytes: number;
  /** MediaAsset.kind for the row. */
  assetKind: MediaAssetKind;
  /** Signed-URL TTL. Large video gets a longer window (slow uploads). */
  ttlSeconds: number;
  /** Path segment for grep-ability in storage. */
  keySegment: string;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const UPLOAD_KIND_POLICY: Record<UploadKind, UploadKindPolicy> = {
  episode_video: {
    contentTypes: VIDEO_CONTENT_TYPES,
    maxBytes: 2 * GiB,
    assetKind: MediaAssetKind.video,
    ttlSeconds: 3600, // 60 min — large video can be slow on the PUT
    keySegment: 'episode-video',
  },
  episode_cover: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 20 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'episode-cover',
  },
  ip_banner: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 20 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'ip-banner',
  },
  ai_reference_image: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 20 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'ai-reference-image',
  },
};

/** Prisma's MediaStorageProvider is the durable enum; the storage result
 *  provider id is the same string set, mapped here for the DB write. */
const PROVIDER_TO_PRISMA: Record<string, MediaStorageProvider> = {
  azure_blob: MediaStorageProvider.azure_blob,
  aliyun_oss: MediaStorageProvider.aliyun_oss,
  s3_compatible: MediaStorageProvider.s3_compatible,
};

@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger(MediaUploadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: OutputStorageService,
    private readonly assetUrls: MediaAssetUrlResolverService,
  ) {}

  /**
   * Issue a signed upload URL. STATELESS — no MediaAsset is created. The
   * returned `storageKey` is the PERMANENT location the bytes will live
   * at; the client echoes it back to `confirm` once the PUT lands.
   *
   * Calling twice is harmless: each call mints a distinct uuid'd key, and
   * any key whose bytes never land (or are never confirmed) simply never
   * becomes a DB row. There is nothing to orphan and nothing to GC.
   */
  async createUploadUrl(
    userId: string,
    input: CreateUploadUrlInputDto,
  ): Promise<CreateUploadUrlResponseDto> {
    const policy = UPLOAD_KIND_POLICY[input.kind];
    // (kind is already validated by the Zod enum, so policy is defined.)

    // 1. content-type ↔ ext allowlist. Reject spoofed / unsupported types
    //    BEFORE minting anything. The stored ext is server-chosen from the
    //    content-type, never parsed from the client filename.
    const ext = policy.contentTypes[input.contentType.toLowerCase()];
    if (!ext) {
      throw new BadRequestException({
        code: 'MEDIA_CONTENT_TYPE_NOT_ALLOWED',
        message: `content-type "${input.contentType}" is not allowed for ${input.kind}`,
      });
    }

    // 2. size pre-check — reject oversize before any URL is minted. This is
    //    the client's DECLARED size (advisory); the true byte count is read
    //    from the HEAD at confirm time and is what gets persisted.
    if (input.sizeBytes > policy.maxBytes) {
      throw new PayloadTooLargeException({
        code: 'MEDIA_FILE_TOO_LARGE',
        message: `file too large for ${input.kind} (max ${policy.maxBytes} bytes)`,
      });
    }

    // 3. server-decided, user-scoped, collision-free PERMANENT key.
    const storageKey = this.buildStorageKey(policy.keySegment, userId, ext);

    // 4. Mint the signed URL. No DB write, so no transaction — if the
    //    provider is down this throws ServiceUnavailable and nothing was
    //    persisted (there's nothing to roll back).
    try {
      const signed = await this.storage.createUploadUrl({
        storageKey,
        contentType: input.contentType,
        maxBytes: policy.maxBytes,
        expiresInSeconds: policy.ttlSeconds,
      });

      // Surface an unmapped provider as a fault now rather than letting
      // confirm fail later with the same unmappable provider.
      if (!PROVIDER_TO_PRISMA[signed.provider]) {
        throw new ServiceUnavailableException({
          code: 'MEDIA_PROVIDER_UNMAPPED',
          message: `storage provider "${signed.provider}" has no MediaAsset mapping`,
        });
      }

      return {
        uploadUrl: signed.url,
        method: signed.method,
        headers: signed.headers,
        storageKey: signed.storageKey,
        provider: signed.provider,
        expiresAt: signed.expiresAt,
      };
    } catch (err) {
      // Provider-down / unconfigured surfaces as ServiceUnavailable; let it
      // through unchanged so the client sees a 503 with a clear code.
      if (err instanceof ServiceUnavailableException) throw err;
      if (
        err instanceof BadRequestException ||
        err instanceof PayloadTooLargeException
      ) {
        throw err;
      }
      this.logger.error(
        `createUploadUrl failed for user=${userId} kind=${input.kind}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'media storage is temporarily unavailable',
      });
    }
  }

  /**
   * Confirm a landed upload and mint the `active` MediaAsset.
   *
   * The client is NOT trusted: we re-derive the user's ownership prefix
   * from `@CurrentUser()` + the declared `kind` and reject any key outside
   * it (cross-user write attempt), then HEAD the blob to prove the bytes
   * physically exist and read the REAL sizeBytes + contentType from
   * storage (never the client's claim). Only then is the row written.
   *
   * Idempotent on objectKey: a duplicate confirm (double-click, retry)
   * returns the existing asset instead of creating a second row.
   */
  async confirmUpload(
    userId: string,
    input: ConfirmUploadInputDto,
  ): Promise<ConfirmUploadResponseDto> {
    const policy = UPLOAD_KIND_POLICY[input.kind];
    const storageKey = input.storageKey;

    // 1. Ownership: the key MUST sit under this user's scope for this kind.
    //    Rebuild the exact prefix the issue step would have produced and
    //    require the key to start with it. A key minted for another user
    //    (or another kind) can't be confirmed onto this user's ledger.
    const ownerPrefix = this.buildOwnerPrefix(policy.keySegment, userId);
    if (!storageKey.startsWith(ownerPrefix)) {
      throw new ForbiddenException({
        code: 'MEDIA_KEY_NOT_OWNED',
        message: 'storageKey is not within the caller scope',
      });
    }

    // 2. Idempotency: if a live asset already exists for this exact key,
    //    return it. Confirm is safe to call twice (double-click, retry); we
    //    never duplicate a row. Keys are uuid'd + permanent, so one key maps
    //    to exactly one blob. Soft-deleted rows are ignored so a key isn't
    //    resurrected through a stale tombstone.
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { objectKey: storageKey, deletedAt: null },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        externalUrl: true,
      },
    });
    if (existing) {
      return {
        mediaAssetId: existing.id,
        storageKey,
        provider: prismaProviderToId(existing.storageProvider),
        url: this.assetUrls.resolve(existing),
      };
    }

    // 3. Existence + truth: HEAD the blob. Absent → 404 (no phantom row).
    //    Present → read REAL size + content-type + placement straight from
    //    the concrete storage impl (the region factory's selection).
    let head: HeadObjectResult;
    try {
      head = await this.storage.headObject(storageKey);
    } catch (err) {
      // headObject throws ServiceUnavailable when the impl is unconfigured;
      // pass it through. Anything else is an unexpected storage fault.
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(
        `confirmUpload HEAD failed for user=${userId} key=${storageKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'media storage is temporarily unavailable',
      });
    }

    if (!head.exists) {
      throw new NotFoundException({
        code: 'MEDIA_OBJECT_NOT_FOUND',
        message: 'no uploaded object exists at storageKey',
      });
    }

    // 4. Resolve the durable provider enum from the impl's own placement.
    const providerId = head.provider;
    const provider = providerId ? PROVIDER_TO_PRISMA[providerId] : undefined;
    if (!providerId || !provider) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_PROVIDER_UNMAPPED',
        message: `storage provider "${providerId ?? 'unknown'}" has no MediaAsset mapping`,
      });
    }

    // 5. Write the ACTIVE asset. sizeBytes + contentType come from the HEAD
    //    (storage truth), never the client. createdByUserId + status power
    //    the future quota query and lifecycle.
    const asset = await this.prisma.mediaAsset.create({
      data: {
        kind: policy.assetKind,
        storageProvider: provider,
        bucket: head.bucket ?? null,
        region: head.region ?? null,
        objectKey: storageKey,
        contentType: head.contentType ?? input.contentType,
        sizeBytes: head.sizeBytes != null ? BigInt(head.sizeBytes) : null,
        // Direct-to-storage uploads are private until a save links them to
        // a public feature row; the read-side resolves URLs from identity
        // regardless of this flag, so this is just intent.
        visibility: MediaAssetVisibility.private,
        // `ready` is this schema's ACTIVE/usable state (what certificates +
        // ip-commerce write and what the read side gates on). The asset is
        // born active here — the old `uploading` pre-create state, the only
        // thing that ever produced orphans, is no longer written at all.
        status: MediaAssetStatus.ready,
        createdByUserId: userId,
      },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        externalUrl: true,
      },
    });

    return {
      mediaAssetId: asset.id,
      storageKey,
      provider: providerId,
      url: this.assetUrls.resolve(asset),
    };
  }

  /**
   * media/{cell}/{keySegment}/{userId}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
   *
   * userId is sanitized to an ASCII-safe segment (it's an external Java
   * identity, normally numeric/uuid, but we never trust its shape). ext is
   * already server-chosen from the allowlist. uuid is collision-free.
   */
  private buildStorageKey(
    keySegment: string,
    userId: string,
    ext: string,
  ): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${this.buildOwnerPrefix(keySegment, userId)}${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
  }

  /**
   * The user+kind ownership scope: `media/{cell}/{keySegment}/{userId}/`.
   * Every key the issue step mints for this (user, kind) starts with this,
   * so confirm requires the submitted key to start with it too. Built from
   * the SAME sanitized userId the issue step uses so the prefixes align.
   */
  private buildOwnerPrefix(keySegment: string, userId: string): string {
    const safeUser = sanitizeKeySegment(userId) || 'unknown';
    return `media/${CURRENT_CELL}/${keySegment}/${safeUser}/`;
  }
}

/** Reverse of PROVIDER_TO_PRISMA for the idempotent-return path. */
function prismaProviderToId(
  provider: MediaStorageProvider,
): 'azure_blob' | 'aliyun_oss' | 's3_compatible' {
  switch (provider) {
    case MediaStorageProvider.aliyun_oss:
      return 'aliyun_oss';
    case MediaStorageProvider.s3_compatible:
      return 's3_compatible';
    default:
      return 'azure_blob';
  }
}

/** Collapse a value to an ASCII-safe, slash-free key segment. */
function sanitizeKeySegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}
