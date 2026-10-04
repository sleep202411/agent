import {
  reserveCrewUpload,
  completeCrewUpload,
  cancelCrewUpload,
  lockCrewStorage,
  requireCrewReservation,
} from '../crews/assets/storage-quota';
/**
 * Direct-to-storage upload pipeline — server side.
 *
 * Most generic uploads use a stateless permanent-key issue + confirm flow.
 * Server-verified images are stricter: the signed URL targets disposable
 * staging, confirm promotes to an unsigned final object, then hashes and fully
 * decodes those exact final bytes before creating a ready asset. Story clip videos use
 * a durable, project-scoped staging session and asynchronous finalizer.
 *
 * Generic flow, both steps authenticated:
 *
 *   1. createUploadUrl — STATELESS. Decide the storage key
 *      (server-chosen, user + optional-workspace scoped, collision-free) and
 *      mint a signed write URL via OutputStorageService. NO MediaAsset is
 *      created. An abandoned, cancelled, or re-picked upload therefore leaves
 *      ZERO DB residue — there is no `uploading` row to orphan and no GC to
 *      run.
 *
 *   2. confirmUpload — after the browser PUTs the bytes, the server verifies
 *      ownership and existence. Verified images additionally move to the
 *      unsigned final identity, stream/hash the final bytes, detect their real
 *      format and dimensions, and fully decode them before DB commit.
 *
 * Storage is the source of truth; the DB only ever records real,
 * referenced assets. MediaAsset.sizeBytes (from HEAD) + createdByUserId
 * are set on every active asset so a future quota feature can compute
 *   used = SUM(sizeBytes) WHERE createdByUserId = user AND status = active
 * accurately — which only holds because there are no orphan rows.
 *
 * Security core: the storage KEY is server-decided and scoped to the
 * authenticated user plus either an authorized workspace or the explicit
 * personal scope. A user physically cannot write under another user's prefix
 * (their userId is baked into the key from `@CurrentUser()`, never the request
 * body), and confirm re-checks both scopes so a key cannot cross users or
 * workspaces.
 *
 *   media/{cell}/{keySegment}/{userId}/{scope}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MediaAssetKind,
  MediaAssetSource,
  MediaAssetStatus,
  MediaAssetVisibility,
  MediaProcessingJobType,
  MediaStorageProvider,
  WorkspaceMemberRole,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { CURRENT_CELL } from '../common/region/current-cell';
import {
  CREW_ASSET_MAX_BYTES,
  crewAssetStorageProviderForCell,
} from '../infra/storage/crew-asset-storage-policy';
import { ensureOriginalMediaPlacement } from '../infra/storage/media-asset-placement';
import { MediaProcessingService } from './media-processing.service';
import { hlsStreamJobKey } from './hls-output';
import {
  IMMUTABLE_STORAGE_CACHE_CONTROL,
  OutputStorageService,
  StorageObjectNotFoundError,
  StorageObjectSizeMismatchError,
  type HeadObjectResult,
  type StorageObjectRef,
} from '../infra/storage/storage.types';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import type {
  ConfirmUploadInputDto,
  ConfirmUploadResponseDto,
  CreateUploadUrlInputDto,
  CreateUploadUrlResponseDto,
} from './dto';
import type { UploadKind } from './dto';
import {
  CONTENT_REVIEW_VIDEO_MAX_BYTES,
  EPISODE_SOURCE_MAX_BYTES,
} from '@repo/shared';
import { EPISODE_VIDEO_MAX_BYTES } from './media-upload.policy';
import { WorkspacePermissionService } from '../workspaces';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import {
  UploadedImageProbeService,
  type UploadedImageProbeResult,
} from './uploaded-image-probe.service';
import { MediaAssetFactsService } from './media-asset-facts.service';
import { MediaAssetReadinessService } from './media-asset-readiness.service';

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
  /**
   * When present, browser-writable staging is promoted to this unsigned
   * immutable segment and byte-probed before a MediaAsset can become ready.
   */
  verifiedImageFinalKeySegment?: string;
}

const MiB = 1024 * 1024;

const UPLOAD_KIND_LABEL = {
  episode_video: 'Episode video',
  episode_source_video: 'Episode source video',
  episode_cover: 'Episode cover image',
  ip_banner: 'IP banner',
  news_cover: 'News cover image',
  workspace_icon: 'Workspace icon',
  ai_reference_image: 'Reference image',
  agent_attachment_image: 'Image attachment',
  agent_attachment_document: 'Document attachment',
  ai_reference_video: 'Reference video',
  content_review_video: 'Content review video',
  ai_reference_audio: 'Reference audio',
  story_music_audio: 'Story music',
  crew_asset_file: 'Crew asset file',
} satisfies Record<UploadKind, string>;

function mediaFileTooLargeError(uploadKind: UploadKind, maxBytes: number) {
  return new PayloadTooLargeException({
    code: 'MEDIA_FILE_TOO_LARGE',
    message: `${UPLOAD_KIND_LABEL[uploadKind]} is too large. Maximum size is ${maxBytes / MiB} MB.`,
  });
}

/** Video upload kinds that generic confirm must not transcode. Reference
 *  videos are generation inputs, never streamed — and story clips upload as
 *  reference videos: they get HLS only from the story-playback reconcile, once
 *  a published free work that plays them is live in the player catalogue. */
const HLS_SKIP_UPLOAD_KINDS = new Set<UploadKind>([
  'ai_reference_video',
  'content_review_video',
]);

function requiresMultipartUpload(kind: UploadKind): boolean {
  return kind === 'episode_source_video' || kind === 'content_review_video';
}

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const AGENT_DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/pdf': 'pdf',
};

const VIDEO_CONTENT_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const CREW_ASSET_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_CONTENT_TYPES,
  ...VIDEO_CONTENT_TYPES,
  ...AGENT_DOCUMENT_CONTENT_TYPES,
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.adobe.photoshop': 'psd',
  'application/postscript': 'ai',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'pptx',
  'application/octet-stream': 'bin',
};

function mediaKindFromContentType(contentType: string): MediaAssetKind {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith('image/')) return MediaAssetKind.image;
  if (normalized.startsWith('video/')) return MediaAssetKind.video;
  if (normalized.startsWith('audio/')) return MediaAssetKind.audio;
  if (
    normalized === 'application/pdf' ||
    normalized.startsWith('text/') ||
    normalized.includes('wordprocessingml') ||
    normalized.includes('spreadsheetml') ||
    normalized.includes('presentationml') ||
    normalized === 'application/vnd.ms-excel' ||
    normalized === 'application/vnd.ms-powerpoint'
  ) {
    return MediaAssetKind.document;
  }
  return MediaAssetKind.other;
}

/** AI reference videos: MP4/MOV only (Seedance 全能参考 spec — no webm). */
const REFERENCE_VIDEO_CONTENT_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** AI reference audio: MP3/WAV per the Seedance 全能参考 spec. */
const REFERENCE_AUDIO_CONTENT_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

const UPLOAD_KIND_POLICY: Record<UploadKind, UploadKindPolicy> = {
  episode_source_video: {
    contentTypes: VIDEO_CONTENT_TYPES,
    maxBytes: EPISODE_SOURCE_MAX_BYTES,
    assetKind: MediaAssetKind.video,
    ttlSeconds: 900,
    keySegment: 'episode-source-video',
  },
  episode_video: {
    contentTypes: VIDEO_CONTENT_TYPES,
    maxBytes: EPISODE_VIDEO_MAX_BYTES,
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
  workspace_icon: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 5 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'workspace-icon-image-staging',
    verifiedImageFinalKeySegment: 'workspace-icon-image-final',
  },
  news_cover: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 20 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'news-cover',
  },
  ai_reference_image: {
    contentTypes: IMAGE_CONTENT_TYPES,
    // 30 MiB matches the catalog's advertised x-ui maxFileSizeMb for
    // multimodal reference images (Seedance 全能参考 spec).
    maxBytes: 30 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    // The signed URL can only ever overwrite disposable staging. Confirm
    // promotes to an unsigned deterministic final key before probing.
    keySegment: 'ai-reference-image-staging',
    verifiedImageFinalKeySegment: 'ai-reference-image-final',
  },
  agent_attachment_image: {
    contentTypes: IMAGE_CONTENT_TYPES,
    maxBytes: 30 * MiB,
    assetKind: MediaAssetKind.image,
    ttlSeconds: 900,
    keySegment: 'agent-attachment-image-staging',
    verifiedImageFinalKeySegment: 'agent-attachment-image-final',
  },
  agent_attachment_document: {
    contentTypes: AGENT_DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * MiB,
    assetKind: MediaAssetKind.document,
    ttlSeconds: 900,
    keySegment: 'agent-attachment-document',
  },
  ai_reference_video: {
    contentTypes: REFERENCE_VIDEO_CONTENT_TYPES,
    // Library and story-clip uploads accept a 2 GiB master. Generation submit
    // still enforces each model's own reference-size contract.
    maxBytes: 2 * 1024 * MiB,
    assetKind: MediaAssetKind.video,
    ttlSeconds: 3600,
    keySegment: 'ai-reference-video',
  },
  // Finished-cut review masters, not generation inputs. Capped at the
  // Aliyun Green videoDetection quota for this account (2 GB).
  content_review_video: {
    contentTypes: REFERENCE_VIDEO_CONTENT_TYPES,
    maxBytes: CONTENT_REVIEW_VIDEO_MAX_BYTES,
    assetKind: MediaAssetKind.video,
    ttlSeconds: 3600,
    keySegment: 'content-review-video',
  },
  ai_reference_audio: {
    contentTypes: REFERENCE_AUDIO_CONTENT_TYPES,
    maxBytes: 15 * MiB,
    assetKind: MediaAssetKind.audio,
    ttlSeconds: 900,
    keySegment: 'ai-reference-audio',
  },
  // A story's background music bed. Same formats as a reference sample but a
  // different CHANNEL: this is playable content the creator attaches to a
  // scene, not a generation input, and it gets its own key segment so the two
  // never share a lifecycle. No story-domain claim step — the binding is a
  // plain media reference, so nothing is frozen and nothing has to be verified
  // before publish. The cap is larger because a bed runs for minutes and WAV
  // costs roughly 10 MB per minute.
  story_music_audio: {
    contentTypes: REFERENCE_AUDIO_CONTENT_TYPES,
    maxBytes: 50 * MiB,
    assetKind: MediaAssetKind.audio,
    ttlSeconds: 900,
    keySegment: 'story-music-audio',
  },
  crew_asset_file: {
    contentTypes: CREW_ASSET_CONTENT_TYPES,
    maxBytes: CREW_ASSET_MAX_BYTES,
    assetKind: MediaAssetKind.other,
    ttlSeconds: 3600,
    keySegment: 'crew-asset-file',
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
    private readonly mediaProcessing: MediaProcessingService,
    private readonly readiness: MediaAssetReadinessService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly uploadedImages: UploadedImageProbeService,
    private readonly mediaFacts: MediaAssetFactsService,
    private readonly storageRegistry: StorageProviderRegistry,
    private readonly storyPermissions: StoryPermissionService,
  ) {}

  /**
   * Auto-enqueue ABR-HLS transcode for a freshly confirmed CN video. IMM is
   * OSS/CN only, so non-`aliyun_oss` (e.g. Azure .com) and non-video assets are
   * skipped — they play as the original mp4. Only PLAYED video is transcoded:
   * `ai_reference_video` is a generation INPUT, never streamed through assetDto,
   * so transcoding it is pure wasted IMM cost + contention on the single-flight
   * media worker. Best-effort: a queue failure must NOT fail the upload confirm
   * (the mp4 is already playable; a backfill can re-enqueue). Idempotent via
   * `hls-stream:{assetId}`.
   */
  private async maybeEnqueueHlsTranscode(
    assetId: string,
    uploadKind: UploadKind,
    assetKind: MediaAssetKind,
    storageProvider: MediaStorageProvider,
  ): Promise<void> {
    if (
      assetKind !== MediaAssetKind.video ||
      storageProvider !== MediaStorageProvider.aliyun_oss ||
      HLS_SKIP_UPLOAD_KINDS.has(uploadKind)
    ) {
      return;
    }
    try {
      await this.mediaProcessing.enqueueJob({
        assetId,
        jobType: MediaProcessingJobType.hls_stream,
        priority: 50,
        idempotencyKey: hlsStreamJobKey(assetId),
      });
    } catch (err) {
      this.logger.warn(
        `failed to enqueue hls_stream for asset=${assetId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Validate scope, type and size before allocating a storage key. */
  async prepareUpload(
    userId: string,
    input: CreateUploadUrlInputDto,
    workspaceId?: string,
  ) {
    const uploadScope = await this.requireUploadScope(
      userId,
      input.kind,
      input.scope?.crewId,
      workspaceId,
      input.scope?.storyProjectId,
    );
    const policy = UPLOAD_KIND_POLICY[input.kind];
    const storage = this.storageForUpload(input.kind);
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
      throw mediaFileTooLargeError(input.kind, policy.maxBytes);
    }

    // 3. Server-decided, scoped, collision-free key. Verified images receive
    //    staging; every other generic kind receives its permanent identity.
    const storageKey = this.buildStorageKey(
      policy.keySegment,
      userId,
      uploadScope.keyScope,
      ext,
    );

    return {
      storage,
      storageKey,
      policy,
      workspaceId: uploadScope.workspaceId,
    };
  }

  async createUploadUrl(
    userId: string,
    input: CreateUploadUrlInputDto,
    workspaceId?: string,
  ): Promise<CreateUploadUrlResponseDto> {
    if (requiresMultipartUpload(input.kind)) {
      throw new BadRequestException(
        input.kind === 'content_review_video'
          ? 'Content review videos require multipart upload'
          : 'Episode source videos require multipart upload',
      );
    }
    const { storage, storageKey, policy } = await this.prepareUpload(
      userId,
      input,
      workspaceId,
    );
    // 4. Mint the signed URL. No DB write, so no transaction — if the
    //    provider is down this throws ServiceUnavailable and nothing was
    //    persisted (there's nothing to roll back).
    try {
      const signed = await storage.createUploadUrl({
        storageKey,
        contentType: input.contentType,
        maxBytes:
          input.kind === 'crew_asset_file' ? input.sizeBytes : policy.maxBytes,
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

      if (input.kind === 'crew_asset_file') {
        const expiresAt = new Date(signed.expiresAt);
        if (
          !Number.isFinite(expiresAt.getTime()) ||
          expiresAt.getTime() <= Date.now()
        )
          throw new ServiceUnavailableException(
            'Storage returned an expired upload URL',
          );
        await this.prisma.$transaction((tx) =>
          reserveCrewUpload(
            tx,
            input.scope!.crewId!,
            userId,
            storageKey,
            input.sizeBytes,
            expiresAt,
          ),
        );
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
      if (input.kind === 'crew_asset_file')
        await this.prisma.$transaction((tx) =>
          cancelCrewUpload(tx, input.scope!.crewId!, userId, storageKey),
        );
      // Provider-down / unconfigured surfaces as ServiceUnavailable; let it
      // through unchanged so the client sees a 503 with a clear code.
      if (err instanceof ServiceUnavailableException) throw err;
      if (
        err instanceof ConflictException ||
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

  async cancelUpload(userId: string, input: ConfirmUploadInputDto) {
    if (input.kind !== 'crew_asset_file' || !input.scope?.crewId)
      throw new BadRequestException('Crew upload scope required');
    // Ownership is checked in the reservation row; cancellation remains possible
    // even when membership was revoked during the upload.
    await this.prisma.$transaction((tx) =>
      cancelCrewUpload(tx, input.scope!.crewId!, userId, input.storageKey),
    );
    return { cancelled: true };
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
    workspaceId?: string,
  ): Promise<ConfirmUploadResponseDto> {
    const uploadScope = await this.requireUploadScope(
      userId,
      input.kind,
      input.scope?.crewId,
      workspaceId,
      input.scope?.storyProjectId,
    );
    const policy = UPLOAD_KIND_POLICY[input.kind];
    let storage = this.storageForUpload(input.kind);
    let sourceLocation: StorageObjectRef | undefined;
    if (requiresMultipartUpload(input.kind)) {
      const session = await this.prisma.episodeUpload.findUnique({
        where: { storageKey: input.storageKey },
      });
      if (
        !session ||
        session.userId !== userId ||
        session.workspaceId !== uploadScope.workspaceId ||
        !['uploaded', 'completed'].includes(session.status) ||
        !session.bucket
      ) {
        throw new BadRequestException('Upload has not been completed');
      }
      const pinned = this.storageRegistry.forProvider(session.provider);
      if (!pinned)
        throw new ServiceUnavailableException(
          'Episode upload storage is unavailable',
        );
      storage = pinned;
      sourceLocation = {
        storageKey: session.storageKey,
        bucket: session.bucket,
        region: session.region,
      };
      const head = await storage.headStoredObject(sourceLocation);
      if (
        !head.exists ||
        head.sizeBytes !== Number(session.sizeBytes) ||
        head.contentType !== session.contentType
      ) {
        throw new BadRequestException(
          'Uploaded video size or content type does not match the upload session',
        );
      }
    }
    const storageKey = input.storageKey;

    // 1. Ownership: the key MUST sit under this user's scope for this kind.
    //    Rebuild the exact prefix the issue step would have produced and
    //    require the key to start with it. A key minted for another user
    //    (or another kind) can't be confirmed onto this user's ledger.
    const uploadScopePrefix = this.buildUploadScopePrefix(
      policy.keySegment,
      userId,
      uploadScope.keyScope,
    );
    if (!storageKey.startsWith(uploadScopePrefix)) {
      throw new ForbiddenException({
        code: 'MEDIA_KEY_SCOPE_MISMATCH',
        message: 'storageKey is not within the caller and workspace scope',
      });
    }

    // Verified images are the strict exception to generic permanent-key
    // uploads. The browser only receives the staging key; the reusable object
    // identity is deterministic but never signed, so validation can never race
    // a later PUT that overwrites the bytes we just inspected.
    const persistedStorageKey = policy.verifiedImageFinalKeySegment
      ? verifiedImageFinalKey(storageKey, policy)
      : input.kind === 'crew_asset_file'
        ? storageKey.replace('/crew-asset-file/', '/crew-asset-final/')
        : storageKey;

    // 2. Idempotency: if a live asset already exists for this exact key,
    //    return it. Confirm is safe to call twice (double-click, retry); we
    //    never duplicate a row. Keys are uuid'd + permanent, so one key maps
    //    to exactly one blob. Soft-deleted rows are ignored so a key isn't
    //    resurrected through a stale tombstone.
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { objectKey: persistedStorageKey, deletedAt: null },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        region: true,
        objectKey: true,
        externalUrl: true,
        contentType: true,
        sizeBytes: true,
        width: true,
        height: true,
        durationSeconds: true,
        checksumSha256: true,
        workspaceId: true,
        metadata: true,
        status: true,
      },
    });
    if (existing) {
      if (!this.assetMatchesUploadScope(existing, uploadScope)) {
        throw new ForbiddenException({
          code: 'MEDIA_ASSET_SCOPE_MISMATCH',
          message: 'the existing media asset belongs to a different scope',
        });
      }
      if (policy.verifiedImageFinalKeySegment) {
        assertReadyVerifiedImageLedger(existing);
      }
      const original = await this.prisma.$transaction((tx) =>
        ensureOriginalMediaPlacement(tx, {
          assetId: existing.id,
          storageProvider: existing.storageProvider,
          bucket: existing.bucket,
          region: existing.region,
          objectKey: existing.objectKey,
          externalUrl: existing.externalUrl,
          contentType: existing.contentType,
          sizeBytes: existing.sizeBytes,
          width: existing.width,
          height: existing.height,
          durationSeconds: existing.durationSeconds,
          checksumSha256: existing.checksumSha256,
          metadata: {
            source: 'direct_upload',
            uploadKind: input.kind,
            ...(policy.verifiedImageFinalKeySegment
              ? {
                  storagePhase: 'immutable_final',
                  inspectedBy: 'server_byte_probe',
                }
              : {}),
          },
        }),
      );
      void this.readiness.enqueueAutomaticChecks(existing.id);
      return {
        mediaAssetId: existing.id,
        variantId: original.variantId,
        storageKey: persistedStorageKey,
        provider: prismaProviderToId(existing.storageProvider),
        url: this.assetUrls.resolve(existing),
      };
    }

    if (input.kind === 'crew_asset_file')
      await requireCrewReservation(
        this.prisma,
        input.scope!.crewId!,
        userId,
        storageKey,
      );
    let truth = policy.verifiedImageFinalKeySegment
      ? await this.finalizeVerifiedImage(
          userId,
          storageKey,
          persistedStorageKey,
          input.contentType,
          input.kind,
          policy,
        )
      : await this.genericUploadTruth(
          userId,
          storageKey,
          input.contentType,
          input.kind,
          policy,
          storage,
          sourceLocation,
        );
    if (input.kind === 'crew_asset_file') {
      if (truth.sizeBytes == null || truth.sizeBytes > CREW_ASSET_MAX_BYTES)
        throw mediaFileTooLargeError(input.kind, CREW_ASSET_MAX_BYTES);
    }
    const confirmedAssetKind =
      input.kind === 'crew_asset_file'
        ? mediaKindFromContentType(truth.contentType)
        : policy.assetKind;

    // Video/audio: measure duration from stored bytes before the ledger write.
    // Client duration is never authority — generation validation reads this.
    if (
      confirmedAssetKind === MediaAssetKind.video ||
      confirmedAssetKind === MediaAssetKind.audio
    ) {
      const durationSeconds = await this.mediaFacts.probeObjectDuration({
        kind: confirmedAssetKind,
        storageProvider: truth.storageProvider,
        bucket: truth.bucket,
        region: truth.region,
        objectKey: truth.objectKey,
        externalUrl: null,
        contentType: truth.contentType,
        sizeBytes: truth.sizeBytes,
      });
      truth = { ...truth, durationSeconds };
    }

    // 5. Write the ACTIVE asset. sizeBytes + contentType come from the HEAD
    //    (storage truth), never the client. createdByUserId + status power
    //    the future quota query and lifecycle.
    const { asset, variantId } = await this.prisma.$transaction(
      async (tx) => {
        if (input.kind === 'crew_asset_file')
          await lockCrewStorage(tx, input.scope!.crewId!);
        // `media_assets.object_key` is indexed but intentionally not globally
        // unique across all import paths. Serialize this exact final identity,
        // then re-read under the lock so two confirm requests converge onto one
        // asset without a check-then-create race.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`media-verified-image-confirm:${persistedStorageKey}`})::bigint
          )
        `;
        const converged = await tx.mediaAsset.findFirst({
          where: { objectKey: persistedStorageKey, deletedAt: null },
          select: {
            id: true,
            storageProvider: true,
            bucket: true,
            region: true,
            objectKey: true,
            externalUrl: true,
            contentType: true,
            sizeBytes: true,
            width: true,
            height: true,
            durationSeconds: true,
            checksumSha256: true,
            workspaceId: true,
            metadata: true,
            status: true,
          },
        });
        if (
          converged &&
          !this.assetMatchesUploadScope(converged, uploadScope)
        ) {
          throw new ForbiddenException({
            code: 'MEDIA_ASSET_SCOPE_MISMATCH',
            message: 'the existing media asset belongs to a different scope',
          });
        }
        if (converged && policy.verifiedImageFinalKeySegment)
          assertReadyVerifiedImageLedger(converged);
        if (!converged && input.kind === 'crew_asset_file') {
          await completeCrewUpload(
            tx,
            input.scope!.crewId!,
            userId,
            storageKey,
            Number(truth.sizeBytes!),
          );
          const promoted = await storage.promoteObject({
            source: { storageKey, bucket: truth.bucket!, region: truth.region },
            destination: {
              storageKey: persistedStorageKey,
              bucket: truth.bucket!,
              region: truth.region,
            },
            expectedSizeBytes: Number(truth.sizeBytes),
            contentType: truth.contentType,
          });
          if (
            promoted.storageKey !== persistedStorageKey ||
            promoted.bucket !== truth.bucket ||
            promoted.region !== truth.region ||
            promoted.provider !== prismaProviderToId(truth.storageProvider) ||
            promoted.sizeBytes !== Number(truth.sizeBytes) ||
            promoted.contentType !== truth.contentType
          )
            throw new ServiceUnavailableException(
              'Crew storage promotion returned a different object identity',
            );
          truth = { ...truth, objectKey: persistedStorageKey };
        }
        const created =
          converged ??
          (await tx.mediaAsset.create({
            data: {
              kind: confirmedAssetKind,
              storageProvider: truth.storageProvider,
              bucket: truth.bucket,
              region: truth.region,
              objectKey: truth.objectKey,
              contentType: truth.contentType,
              sizeBytes: truth.sizeBytes,
              width: truth.width,
              height: truth.height,
              durationSeconds: truth.durationSeconds,
              checksumSha256: truth.checksumSha256,
              // Direct-to-storage uploads are private until a save links them to
              // a public feature row; the read-side resolves URLs from identity
              // regardless of this flag, so this is just intent.
              visibility: MediaAssetVisibility.private,
              // `ready` is this schema's ACTIVE/usable state (what certificates +
              // ip-commerce write and what the read side gates on). The asset is
              // born active here — the old `uploading` pre-create state, the only
              // thing that ever produced orphans, is no longer written at all.
              status: MediaAssetStatus.ready,
              source: MediaAssetSource.user_upload,
              createdByUserId: userId,
              workspaceId: uploadScope.workspaceId,
              metadata: {
                uploadKind: input.kind,
                ...(uploadScope.storyProjectId
                  ? { storyProjectId: uploadScope.storyProjectId }
                  : {}),
                ...(uploadScope.crewId ? { crewId: uploadScope.crewId } : {}),
                ...(policy.verifiedImageFinalKeySegment
                  ? {
                      storagePhase: 'immutable_final',
                      inspectedBy: 'server_byte_probe',
                    }
                  : {}),
              },
            },
            select: {
              id: true,
              storageProvider: true,
              bucket: true,
              region: true,
              objectKey: true,
              externalUrl: true,
              contentType: true,
              sizeBytes: true,
              width: true,
              height: true,
              durationSeconds: true,
              checksumSha256: true,
              workspaceId: true,
              status: true,
            },
          }));
        const original = await ensureOriginalMediaPlacement(tx, {
          assetId: created.id,
          storageProvider: created.storageProvider,
          bucket: created.bucket,
          region: created.region,
          objectKey: created.objectKey,
          externalUrl: created.externalUrl,
          contentType: created.contentType,
          sizeBytes: created.sizeBytes,
          width: created.width,
          height: created.height,
          durationSeconds: created.durationSeconds,
          checksumSha256: created.checksumSha256,
          metadata: {
            source: 'direct_upload',
            uploadKind: input.kind,
            ...(policy.verifiedImageFinalKeySegment
              ? {
                  storagePhase: 'immutable_final',
                  inspectedBy: 'server_byte_probe',
                }
              : {}),
          },
        });
        return { asset: created, variantId: original.variantId };
      },
      input.kind === 'crew_asset_file'
        ? { timeout: 120000, maxWait: 10000 }
        : undefined,
    );

    // CN videos: kick off the ABR-HLS transcode now that the asset is active.
    // Only fires for video on aliyun_oss; everything else plays the mp4.
    await this.maybeEnqueueHlsTranscode(
      asset.id,
      input.kind,
      confirmedAssetKind,
      asset.storageProvider,
    );
    void this.readiness.enqueueAutomaticChecks(asset.id);

    return {
      mediaAssetId: asset.id,
      variantId,
      storageKey: truth.objectKey,
      provider: prismaProviderToId(truth.storageProvider),
      url: this.assetUrls.resolve(asset),
    };
  }

  private async genericUploadTruth(
    userId: string,
    storageKey: string,
    requestedContentType: string,
    uploadKind: UploadKind,
    policy: UploadKindPolicy,
    storage: OutputStorageService = this.storage,
    sourceLocation?: StorageObjectRef,
  ): Promise<ConfirmedUploadTruth> {
    const head = sourceLocation
      ? await storage.headStoredObject(sourceLocation)
      : await this.headUploadObject(userId, storageKey, storage);
    if (!head.exists) throw mediaObjectNotFound();
    // Signed PUT byte limits are advisory. The stored object, not the caller's
    // declaration, must satisfy the kind's budget before it enters the ledger.
    if (
      head.sizeBytes == null ||
      !Number.isSafeInteger(head.sizeBytes) ||
      head.sizeBytes <= 0
    ) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_SIZE_INVALID',
        message: 'Media storage did not return a valid byte size.',
      });
    }
    if (head.sizeBytes > policy.maxBytes) {
      throw mediaFileTooLargeError(uploadKind, policy.maxBytes);
    }

    // Generic objects retain their signed permanent key. Their cache metadata
    // is provider bookkeeping, not validation, and remains best-effort.
    try {
      if (!sourceLocation)
        await storage.setCacheControl(
          storageKey,
          IMMUTABLE_STORAGE_CACHE_CONTROL,
          head.contentType ?? requestedContentType,
        );
    } catch (err) {
      this.logger.warn(
        `confirmUpload setCacheControl failed key=${storageKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const storageProvider = requirePrismaStorageProvider(head.provider);
    return {
      storageProvider,
      bucket: head.bucket ?? null,
      region: head.region ?? null,
      objectKey: storageKey,
      contentType: head.contentType ?? requestedContentType,
      sizeBytes: head.sizeBytes == null ? null : BigInt(head.sizeBytes),
      width: null,
      height: null,
      durationSeconds: null,
      checksumSha256: null,
    };
  }

  private async finalizeVerifiedImage(
    userId: string,
    stagingKey: string,
    finalKey: string,
    requestedContentType: string,
    uploadKind: UploadKind,
    policy: UploadKindPolicy,
  ): Promise<ConfirmedUploadTruth> {
    // A retry after a successful promotion may find staging already deleted.
    // Prefer the unsigned final whenever it exists; unlike staging, it cannot
    // be changed by the still-unexpired browser PUT signature.
    const finalHead = await this.headUploadObject(userId, finalKey);
    const sourceHead = finalHead.exists
      ? finalHead
      : await this.headUploadObject(userId, stagingKey);
    if (!sourceHead.exists) throw mediaObjectNotFound();

    const header = requireVerifiedImageHead(
      sourceHead,
      requestedContentType,
      uploadKind,
      policy,
    );
    let promoted: Awaited<ReturnType<OutputStorageService['promoteObject']>>;
    try {
      promoted = await this.storage.promoteObject({
        source: {
          bucket: header.bucket,
          region: header.region,
          storageKey: stagingKey,
        },
        destination: {
          bucket: header.bucket,
          region: header.region,
          storageKey: finalKey,
        },
        expectedSizeBytes: header.sizeBytes,
        contentType: header.contentType,
        cacheControl: IMMUTABLE_STORAGE_CACHE_CONTROL,
      });
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw mediaObjectNotFound();
      }
      if (error instanceof StorageObjectSizeMismatchError) {
        throw new UnprocessableEntityException({
          code: 'MEDIA_IMAGE_SIZE_MISMATCH',
          message: `The stored image size changed (expected ${error.expectedSizeBytes} bytes, received ${error.actualSizeBytes ?? 'unknown'}).`,
        });
      }
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(
        `verified image promotion failed user=${userId} key=${stagingKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: 'media storage is temporarily unavailable',
      });
    }
    if (
      promoted.provider !== header.providerId ||
      promoted.bucket !== header.bucket ||
      promoted.region !== header.region ||
      promoted.storageKey !== finalKey ||
      promoted.sizeBytes !== header.sizeBytes ||
      normalizeImageMime(promoted.contentType) !== header.contentType
    ) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_IMAGE_STORAGE_IDENTITY_MISMATCH',
        message: 'Media storage promoted a different image object identity.',
      });
    }

    const technical: UploadedImageProbeResult = await this.uploadedImages.probe(
      {
        storageProvider: header.storageProvider,
        bucket: promoted.bucket,
        region: promoted.region,
        objectKey: promoted.storageKey,
        externalUrl: null,
        contentType: promoted.contentType,
        sizeBytes: BigInt(promoted.sizeBytes),
      },
      {
        expectedContentType: header.contentType,
        maxBytes: policy.maxBytes,
      },
    );
    return {
      storageProvider: header.storageProvider,
      bucket: promoted.bucket,
      region: promoted.region,
      objectKey: promoted.storageKey,
      contentType: technical.contentType,
      sizeBytes: technical.sizeBytes,
      width: technical.width,
      height: technical.height,
      durationSeconds: null,
      checksumSha256: technical.checksumSha256,
    };
  }

  private async headUploadObject(
    userId: string,
    storageKey: string,
    storage: OutputStorageService = this.storage,
  ): Promise<HeadObjectResult> {
    try {
      return await storage.headObject(storageKey);
    } catch (err) {
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
  }

  /**
   * media/{cell}/{keySegment}/{userId}/{scope}/{yyyy}/{mm}/{dd}/{uuid}.{ext}
   *
   * userId is sanitized to an ASCII-safe segment (it's an external Java
   * identity, normally numeric/uuid, but we never trust its shape). ext is
   * already server-chosen from the allowlist. uuid is collision-free.
   */
  private buildStorageKey(
    keySegment: string,
    userId: string,
    keyScope: string,
    ext: string,
  ): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${this.buildUploadScopePrefix(keySegment, userId, keyScope)}${yyyy}/${mm}/${dd}/${randomUUID()}.${ext}`;
  }

  /**
   * Bind upload issue and confirmation to the same owner and scope without an
   * upload-session row. Story uploads derive their workspace from the project
   * and include its identity, so confirmation cannot switch projects.
   */
  private buildUploadScopePrefix(
    keySegment: string,
    userId: string,
    keyScope: string,
  ): string {
    return `${this.buildOwnerPrefix(keySegment, userId)}${keyScope}/`;
  }

  private async requireUploadScope(
    userId: string,
    kind: UploadKind,
    crewId: string | undefined,
    workspaceHeader: string | undefined,
    storyProjectId?: string,
  ): Promise<UploadScope> {
    if (storyProjectId) {
      if (
        crewId !== undefined ||
        kind === 'crew_asset_file' ||
        kind === 'episode_source_video' ||
        kind === 'content_review_video'
      ) {
        throw new BadRequestException({
          code: 'MEDIA_SCOPE_CONFLICT',
          message: 'This upload kind cannot declare scope.storyProjectId',
        });
      }
      const { project } = await this.storyPermissions.requireProject(
        userId,
        storyProjectId,
        'story.edit',
      );
      return {
        workspaceId: project.workspaceId,
        crewId: null,
        storyProjectId: project.id,
        keyScope: `workspace-${project.workspaceId}/story-${project.id}`,
      };
    }
    if (kind === 'crew_asset_file') {
      if (!crewId) {
        throw new BadRequestException({
          code: 'MEDIA_CREW_SCOPE_REQUIRED',
          message: 'scope.crewId is required for crew asset uploads',
        });
      }
      if (workspaceHeader !== undefined) {
        throw new BadRequestException({
          code: 'MEDIA_SCOPE_CONFLICT',
          message: 'crew asset uploads cannot also declare x-fizz-workspace-id',
        });
      }
      await this.requireCrewMembership(userId, crewId);
      return {
        workspaceId: null,
        crewId,
        keyScope: `crew-${sanitizeKeySegment(crewId)}`,
      };
    }
    if (crewId !== undefined) {
      throw new BadRequestException({
        code: 'MEDIA_CREW_SCOPE_NOT_ALLOWED',
        message: 'scope.crewId is only valid for crew asset uploads',
      });
    }
    const workspaceId = await this.requireUploadWorkspace(
      userId,
      workspaceHeader,
    );
    return {
      workspaceId,
      crewId: null,
      keyScope: workspaceId ? `workspace-${workspaceId}` : 'personal',
    };
  }

  private storageForUpload(kind: UploadKind): OutputStorageService {
    if (kind !== 'crew_asset_file') return this.storage;
    const provider = crewAssetStorageProviderForCell(CURRENT_CELL);
    const storage = this.storageRegistry.forProvider(provider);
    if (!storage) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_STORAGE_UNAVAILABLE',
        message: `Crew asset storage provider "${provider}" is unavailable`,
      });
    }
    return storage;
  }

  private async requireCrewMembership(
    userId: string,
    crewId: string,
  ): Promise<void> {
    const crew = await this.prisma.crew.findFirst({
      where: { id: crewId, deletedAt: null },
      select: { id: true },
    });
    if (!crew) throw new NotFoundException('Crew not found');
    const member = await this.prisma.crewMember.findFirst({
      where: { crewId, userId, status: 'active' },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({
        code: 'MEDIA_CREW_ACCESS_DENIED',
        message: 'Only active crew members can upload crew assets',
      });
    }
  }

  private assetMatchesUploadScope(
    asset: { workspaceId: string | null; metadata: unknown },
    scope: UploadScope,
  ): boolean {
    if (asset.workspaceId !== scope.workspaceId) return false;
    const metadata =
      asset.metadata && typeof asset.metadata === 'object'
        ? (asset.metadata as Record<string, unknown>)
        : {};
    if (metadata.storyProjectId !== scope.storyProjectId) return false;
    return scope.crewId
      ? metadata.crewId === scope.crewId
      : metadata.crewId === undefined;
  }

  /** Validate an optional workspace header and return its canonical scope. */
  private async requireUploadWorkspace(
    userId: string,
    workspaceHeader?: string,
  ): Promise<string | null> {
    if (workspaceHeader === undefined) return null;
    const workspaceId = workspaceHeader.trim();
    if (!UUID_PATTERN.test(workspaceId)) {
      throw new BadRequestException({
        code: 'MEDIA_WORKSPACE_ID_INVALID',
        message: 'x-fizz-workspace-id must be a valid UUID',
      });
    }
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspaceId,
      WorkspaceMemberRole.viewer,
    );
    return workspaceId;
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadScope {
  storyProjectId?: string;
  workspaceId: string | null;
  crewId: string | null;
  keyScope: string;
}

interface ConfirmedUploadTruth {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string;
  contentType: string;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  /** Server-measured duration for video/audio; null for images. */
  durationSeconds: number | null;
  checksumSha256: string | null;
}

interface VerifiedImageHead {
  providerId: 'azure_blob' | 'aliyun_oss' | 's3_compatible';
  storageProvider: MediaStorageProvider;
  bucket: string;
  region: string | null;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
}

function assertReadyVerifiedImageLedger(asset: {
  status: MediaAssetStatus;
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  objectKey: string | null;
  contentType: string;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
}): void {
  if (
    asset.status !== MediaAssetStatus.ready ||
    asset.storageProvider === MediaStorageProvider.external_url ||
    !asset.bucket ||
    !asset.objectKey ||
    !normalizeImageMime(asset.contentType) ||
    asset.sizeBytes === null ||
    asset.sizeBytes <= 0n ||
    asset.width === null ||
    asset.width <= 0 ||
    asset.height === null ||
    asset.height <= 0 ||
    !asset.checksumSha256 ||
    !/^[a-f0-9]{64}$/.test(asset.checksumSha256)
  ) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_VERIFIED_IMAGE_LEDGER_INCOMPLETE',
      message: 'The finalized image is missing server-verified metadata.',
    });
  }
}

function requireVerifiedImageHead(
  head: HeadObjectResult,
  requestedContentType: string,
  uploadKind: UploadKind,
  policy: UploadKindPolicy,
): VerifiedImageHead {
  if (!head.exists) throw mediaObjectNotFound();
  const contentType = normalizeImageMime(head.contentType);
  const requested = normalizeImageMime(requestedContentType);
  if (!contentType || !requested || contentType !== requested) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_CONTENT_TYPE_MISMATCH',
      message:
        'The stored image content type does not match the issued upload.',
    });
  }
  if (!Object.hasOwn(policy.contentTypes, contentType)) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_CONTENT_TYPE_INVALID',
      message:
        'The stored object does not have a supported image content type.',
    });
  }
  if (
    head.sizeBytes == null ||
    !Number.isSafeInteger(head.sizeBytes) ||
    head.sizeBytes <= 0
  ) {
    throw new UnprocessableEntityException({
      code: 'MEDIA_IMAGE_SIZE_INVALID',
      message: 'Media storage did not return a valid image byte size.',
    });
  }
  if (head.sizeBytes > policy.maxBytes) {
    throw mediaFileTooLargeError(uploadKind, policy.maxBytes);
  }
  if (!head.bucket) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_STORAGE_IDENTITY_INCOMPLETE',
      message: 'Media storage did not return an image bucket identity.',
    });
  }
  const providerId = requireStorageProviderId(head.provider);
  return {
    providerId,
    storageProvider: requirePrismaStorageProvider(providerId),
    bucket: head.bucket,
    region: head.region ?? null,
    contentType,
    sizeBytes: head.sizeBytes,
  };
}

function requireStorageProviderId(
  provider: HeadObjectResult['provider'],
): 'azure_blob' | 'aliyun_oss' | 's3_compatible' {
  if (
    provider === 'azure_blob' ||
    provider === 'aliyun_oss' ||
    provider === 's3_compatible'
  ) {
    return provider;
  }
  throw new ServiceUnavailableException({
    code: 'MEDIA_PROVIDER_UNMAPPED',
    message: `storage provider "${provider ?? 'unknown'}" has no MediaAsset mapping`,
  });
}

function requirePrismaStorageProvider(
  provider: HeadObjectResult['provider'],
): MediaStorageProvider {
  const providerId = requireStorageProviderId(provider);
  const mapped = PROVIDER_TO_PRISMA[providerId];
  if (!mapped) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_PROVIDER_UNMAPPED',
      message: `storage provider "${providerId}" has no MediaAsset mapping`,
    });
  }
  return mapped;
}

function normalizeImageMime(
  value: string | undefined,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    normalized === 'image/jpeg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp'
  ) {
    return normalized;
  }
  return null;
}

function verifiedImageFinalKey(
  stagingKey: string,
  policy: UploadKindPolicy,
): string {
  if (!policy.verifiedImageFinalKeySegment) {
    throw new ServiceUnavailableException({
      code: 'MEDIA_VERIFIED_IMAGE_POLICY_INVALID',
      message: 'Verified image upload policy is missing a final key segment.',
    });
  }
  const marker = `/${policy.keySegment}/`;
  const markerIndex = stagingKey.indexOf(marker);
  if (markerIndex < 0 || stagingKey.indexOf(marker, markerIndex + 1) >= 0) {
    throw new BadRequestException({
      code: 'MEDIA_VERIFIED_IMAGE_STAGING_KEY_INVALID',
      message: 'storageKey is not a valid verified-image staging key',
    });
  }
  return `${stagingKey.slice(0, markerIndex)}/${policy.verifiedImageFinalKeySegment}/${stagingKey.slice(markerIndex + marker.length)}`;
}

function mediaObjectNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'MEDIA_OBJECT_NOT_FOUND',
    message: 'no uploaded object exists at storageKey',
  });
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
