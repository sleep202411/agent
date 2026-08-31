import { MediaAssetKind, Prisma, type PrismaClient } from '@prisma/client';
import { ExperienceHttpUrlSchema } from '@repo/shared/experience-runtime';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import type { StoryBuildDiagnosticDto } from './dto';
import type {
  StoryBuildCoverInput,
  StoryCoverReference,
} from './story-build-compiler';

/**
 * A project cover is catalogue metadata. Publishing and displaying it only
 * requires the permanent public URL; dimensions, checksums and MIME metadata
 * belong to runtime scene media and must not decide whether a cover can ship.
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
});

/** Resolves the project's selected image to the URL a release carries. */
export async function resolveStoryCover(
  db: Pick<PrismaClient, 'mediaAsset'>,
  coverAssetId: string | null,
): Promise<StoryBuildCoverInput> {
  // The overwhelming majority of projects have no cover, and those must cost no
  // query at all.
  if (!coverAssetId) return { reference: null, eligibilityDiagnostics: [] };

  // Ownership was checked when this id was set on the project. Some uploads do
  // not carry a workspace id, so re-scoping the lookup would discard a valid
  // project cover.
  const row = await db.mediaAsset.findFirst({
    where: {
      id: coverAssetId,
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
  if (!ExperienceHttpUrlSchema.safeParse(url).success) {
    return unusable(
      coverAssetId,
      `resolves to ${url}, which is not a public HTTP URL`,
    );
  }

  const reference: StoryCoverReference = {
    mediaAssetId: row.id,
    url,
  };
  return { reference, eligibilityDiagnostics: [] };
}

function unusable(mediaAssetId: string, reason: string): StoryBuildCoverInput {
  return {
    reference: null,
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
