import { MediaAssetKind, Prisma, type PrismaClient } from '@prisma/client';
import { isRuntimeMediaUri } from '@repo/shared/interactive-film-runtime';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import type { StoryBuildDiagnosticDto } from './dto';
import type {
  StoryBuildCoverInput,
  StoryCoverMediaReference,
} from './story-build-compiler';

/**
 * The project cover is a PLAIN MEDIA REFERENCE, not a frozen build asset — the
 * same call made for background music, and for the same reason: losing the cover
 * costs a title screen its backdrop, it does not break the story.
 *
 * The build-asset route would also be actively wrong here. It yields a
 * root-relative `/aurora/...` path, and Java's `coverUrl` must be absolute; it
 * serves `private, no-store` behind a per-viewer permission check, which a
 * public catalogue grid and an `og:image` crawler cannot use; and the manifest's
 * frozen-delivery invariant requires the manifest's VIDEO uris to equal exactly
 * the set of frozen build-asset paths, so one non-video frozen asset would fail
 * every Build outright.
 *
 * The accepted cost of a public URL: it sits outside the build's media
 * authorization lifecycle, so revoking authorization does not retract a cover
 * already handed to Java. That is identical to music and it is the same trade —
 * decoration is not worth a signed-URL lifecycle.
 *
 * This module CANNOT FAIL a Build. It answers one of three ways:
 *   - no cover set        -> no asset, no diagnostic, no query
 *   - cover unpublishable -> no asset plus a WARNING naming the reason
 *   - cover ready         -> the complete reference the runtime needs
 * The warning is the point of the middle case: a creator who set a cover that
 * cannot ship must learn why rather than discovering a black title screen.
 */

const COVER_ASSET_SELECT = Prisma.validator<Prisma.MediaAssetSelect>()({
  id: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  status: true,
  moderationStatus: true,
  deletedAt: true,
  placements: true,
  contentType: true,
  width: true,
  height: true,
  checksumSha256: true,
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

/**
 * Resolves the project's cover into the reference a release carries.
 *
 * The image-kind and workspace filters are query predicates rather than checks
 * with their own messages: a cover of the wrong kind cannot be set through the
 * API any more, and an asset from another workspace must never be published
 * inside someone else's release. Both collapse into "the query returned
 * nothing", which reads to the creator as the one thing they can act on — this
 * cover cannot be published, pick another.
 */
export async function resolveStoryCover(
  db: Pick<PrismaClient, 'mediaAsset'>,
  workspaceId: string,
  coverAssetId: string | null,
): Promise<StoryBuildCoverInput> {
  // The overwhelming majority of projects have no cover, and those must cost no
  // query at all.
  if (!coverAssetId) return { asset: null, eligibilityDiagnostics: [] };

  const row = await db.mediaAsset.findFirst({
    where: {
      id: coverAssetId,
      workspaceId,
      kind: MediaAssetKind.image,
    },
    select: COVER_ASSET_SELECT,
  });
  if (!row) return unusable(coverAssetId, 'is not a publishable project image');

  // `resolvePublicUrl` is the single gate for deleted, unready, moderation
  // blocked and unresolvable media, and never throws.
  const url = resolveMediaPublicUrl(row)?.trim();
  if (!url) {
    return unusable(
      coverAssetId,
      'is deleted, still processing, blocked, or has no storage placement',
    );
  }
  if (!isRuntimeMediaUri(url)) {
    return unusable(
      coverAssetId,
      `resolves to ${url}, which a release cannot carry — a permanent HTTPS URL is required`,
    );
  }

  // The runtime image contract requires all three, unlike video which relaxes
  // exactly these. An image that never went through the verified-upload probe
  // can be missing any of them, and that is not a cover.
  const { checksumSha256, width, height, contentType } = row;
  if (!checksumSha256 || !SHA256_PATTERN.test(checksumSha256)) {
    return unusable(coverAssetId, 'has no recorded SHA-256 checksum');
  }
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    return unusable(coverAssetId, 'has no recorded pixel dimensions');
  }
  if (!contentType || !MEDIA_TYPE_PATTERN.test(contentType)) {
    return unusable(coverAssetId, 'has no recorded media type');
  }

  const asset: StoryCoverMediaReference = {
    mediaAssetId: row.id,
    url,
    sha256: checksumSha256,
    width,
    height,
    mediaType: contentType,
  };
  return { asset, eligibilityDiagnostics: [] };
}

function unusable(mediaAssetId: string, reason: string): StoryBuildCoverInput {
  return {
    asset: null,
    eligibilityDiagnostics: [coverWarning(mediaAssetId, reason)],
  };
}

function coverWarning(
  mediaAssetId: string,
  reason: string,
): StoryBuildDiagnosticDto {
  return {
    severity: 'warning',
    code: 'STORY_BUILD_COVER_UNUSABLE',
    message: `The project cover ${reason}, so this release ships without one.`,
    entityType: 'asset',
    entityId: mediaAssetId,
  };
}

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value > 0;
}
