import {
  MediaAssetVariantStatus,
  MediaModerationActionStatus,
  MediaModerationActionType,
  MediaObjectPlacementStatus,
  MediaProcessingJobStatus,
  Prisma,
} from '@prisma/client';
import {
  STORY_PLAYBACK_HLS_MIME_TYPE,
  type StoryBuildAssetPlayback,
} from '@repo/shared/story-playback';
import { z } from 'zod';
import { immMaxMinutes } from '../infra/storage/imm-transcode.service';
import {
  resolveMediaPlaybackUrl,
  type GatedMediaAsset,
  type ResolvableMediaAssetVariant,
} from '../infra/storage/media-asset-url-resolver.service';
import { isJsonObject } from './media-action-queue.util';

/**
 * Shared lifecycle of one asset's IMM HLS output (`hls/{assetId}/`): the
 * transcode job key, the durable prefix-takedown action, and the guards the
 * transcode worker, the takedown worker, moderation and the story-playback
 * reconcile all agree on.
 */

/** The single canonical `hls_stream` job of an asset. */
export const hlsStreamJobKey = (assetId: string) => `hls-stream:${assetId}`;

/** `metadata.scope` of a `delete_object` action that empties an HLS prefix. */
export const HLS_PREFIX_SCOPE = 'hls_prefix';

/**
 * How long after a prefix takedown completes before IMM may write the same
 * keys again. With CDN Range origin fetch on, rewriting a key while a refresh
 * is still propagating can splice old and new bytes into one cached object.
 */
export const HLS_CDN_SETTLE_MS = 10 * 60_000;

export interface HlsPrefixTakedownMetadata {
  scope: 'hls_prefix';
  /** `moderation` = a block; `lifecycle` = the reconcile's grace-period GC. */
  origin: 'moderation' | 'lifecycle';
  bucket: string;
  region: string | null;
  prefix: string;
  /** Keys that were published and so may sit on CDN edges. */
  refreshKeys: string[];
  // Progress, written by the takedown worker between steps.
  passes?: number;
  deletedObjects?: number;
  refreshedChunks?: number;
  cdnRefreshTaskIds?: string[];
  cdnRefreshedAt?: string | null;
  waitingForJobId?: string | null;
}

const HlsPrefixTakedownMetadataSchema = z.object({
  scope: z.literal(HLS_PREFIX_SCOPE),
  origin: z.enum(['moderation', 'lifecycle']),
  bucket: z.string().min(1),
  region: z.string().nullable(),
  prefix: z.string().min(1),
  refreshKeys: z.array(z.string().min(1)),
  passes: z.number().int().nonnegative().optional(),
  deletedObjects: z.number().int().nonnegative().optional(),
  refreshedChunks: z.number().int().nonnegative().optional(),
  cdnRefreshTaskIds: z.array(z.string()).optional(),
  cdnRefreshedAt: z.string().nullable().optional(),
  waitingForJobId: z.string().nullable().optional(),
});

/** The action's metadata, or null when it is not a well-formed HLS takedown. */
export function parseHlsPrefixTakedownMetadata(
  value: Prisma.JsonValue,
): HlsPrefixTakedownMetadata | null {
  const parsed = HlsPrefixTakedownMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether the asset's `hls_stream` job can still have an IMM task writing into
 * the prefix. Deleting the prefix is final only once this is false:
 * - `processing` — claimed; it may be about to submit, or polling a live task;
 * - `pending` / `failed` with a task id — between polls of a live task;
 * - `dead` with a task id submitted less than 2×IMM_MAX_MINUTES ago — the
 *   worker gave up (timeout, poll errors) but IMM may not have.
 */
export function transcodeMayStillWrite(
  job: { status: MediaProcessingJobStatus; output: Prisma.JsonValue } | null,
  nowMs: number,
): boolean {
  if (!job) return false;
  const output = isJsonObject(job.output) ? job.output : {};
  const hasTask =
    typeof output.immTaskId === 'string' && output.immTaskId.length > 0;
  switch (job.status) {
    case MediaProcessingJobStatus.processing:
      return true;
    case MediaProcessingJobStatus.pending:
    case MediaProcessingJobStatus.failed:
      return hasTask;
    case MediaProcessingJobStatus.dead: {
      if (!hasTask || typeof output.submittedAt !== 'string') return false;
      const submittedAt = Date.parse(output.submittedAt);
      return (
        Number.isFinite(submittedAt) &&
        nowMs - submittedAt < 2 * immMaxMinutes() * 60_000
      );
    }
    default:
      return false;
  }
}

/**
 * Retire an HLS output in the database: CAS the variant from one of
 * `fromStatuses` to `deleted`, soft-delete its placements, and drop the
 * asset's terminal job rows so a later publication queues a fresh transcode
 * instead of replaying an old result. Returns false (and changes nothing) when
 * the variant is not in an expected status — e.g. a newer publish made it
 * `ready` again. Run inside the caller's transaction.
 */
export async function retireHlsOutput(
  tx: Prisma.TransactionClient,
  input: {
    assetId: string;
    variantId: string;
    fromStatuses: MediaAssetVariantStatus[];
    now: Date;
  },
): Promise<boolean> {
  const variant = await tx.mediaAssetVariant.updateMany({
    where: {
      id: input.variantId,
      assetId: input.assetId,
      status: { in: input.fromStatuses },
    },
    data: { status: MediaAssetVariantStatus.deleted, deletedAt: input.now },
  });
  if (variant.count === 0) return false;
  await tx.mediaObjectPlacement.updateMany({
    where: { variantId: input.variantId, deletedAt: null },
    data: { status: MediaObjectPlacementStatus.deleted, deletedAt: input.now },
  });
  await tx.mediaProcessingJob.deleteMany({
    where: {
      idempotencyKey: hlsStreamJobKey(input.assetId),
      status: {
        in: [
          MediaProcessingJobStatus.completed,
          MediaProcessingJobStatus.dead,
          MediaProcessingJobStatus.cancelled,
        ],
      },
    },
  });
  return true;
}

/** `where` of the HLS prefix takedowns still running for an asset. */
export function unfinishedHlsTakedownWhere(
  assetId: string,
): Prisma.MediaModerationActionWhereInput {
  return {
    assetId,
    actionType: MediaModerationActionType.delete_object,
    status: {
      in: [
        MediaModerationActionStatus.pending,
        MediaModerationActionStatus.failed,
      ],
    },
    metadata: { path: ['scope'], equals: HLS_PREFIX_SCOPE },
  };
}

/**
 * `where` of the takedowns that forbid IMM from writing the given asset(s)'
 * prefix at `now`: one still running, or one that completed less than
 * {@link HLS_CDN_SETTLE_MS} ago. The transcode worker defers on exactly this,
 * and the story-playback reconcile queues nothing behind it.
 */
export function blockingHlsTakedownWhere(
  assetId: string | { in: string[] },
  now: Date,
): Prisma.MediaModerationActionWhereInput {
  return {
    assetId,
    actionType: MediaModerationActionType.delete_object,
    metadata: { path: ['scope'], equals: HLS_PREFIX_SCOPE },
    OR: [
      {
        status: {
          in: [
            MediaModerationActionStatus.pending,
            MediaModerationActionStatus.failed,
          ],
        },
      },
      {
        status: MediaModerationActionStatus.completed,
        completedAt: { gt: new Date(now.getTime() - HLS_CDN_SETTLE_MS) },
      },
    ],
  };
}

/** The newest takedown that forbids IMM from writing the asset's prefix now. */
export function findBlockingHlsTakedown(
  prisma: Prisma.TransactionClient,
  assetId: string,
  now: Date,
): Promise<{ id: string } | null> {
  return prisma.mediaModerationAction.findFirst({
    where: blockingHlsTakedownWhere(assetId, now),
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
}

/**
 * The adaptive playback a client may switch to for an asset: the master of its
 * ready HLS variant (with an active primary placement), under the same
 * moderation gate as every public media URL. Null keeps progressive playback.
 */
export function storyHlsPlayback(
  asset: GatedMediaAsset,
  hls: ResolvableMediaAssetVariant | null,
): StoryBuildAssetPlayback | null {
  const playback = resolveMediaPlaybackUrl({
    ...asset,
    variants: hls ? [hls] : [],
  });
  return playback.url && playback.contentType
    ? { url: playback.url, contentType: STORY_PLAYBACK_HLS_MIME_TYPE }
    : null;
}
