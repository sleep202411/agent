import { MediaAssetKind, Prisma, type PrismaClient } from '@prisma/client';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';

/**
 * A project cover is catalogue metadata. Publishing and displaying it only
 * requires the permanent public URL; dimensions, checksums and MIME metadata
 * belong to runtime scene media and must not decide whether a cover can ship.
 */

const COVER_ASSET_SELECT = Prisma.validator<Prisma.MediaAssetSelect>()({
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

/** Resolves the project's selected image to its public catalogue URL. */
export async function resolveStoryCoverUrl(
  db: Pick<PrismaClient, 'mediaAsset'>,
  coverAssetId: string | null,
): Promise<string | null> {
  // The overwhelming majority of projects have no cover, and those must cost no
  // query at all.
  if (!coverAssetId) return null;

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
  if (!row) return null;

  // `resolvePublicUrl` is the single gate for deleted, unready, moderation
  // blocked and unresolvable media, and never throws.
  const url = resolveMediaPublicUrl(row)?.trim();
  if (!url) return null;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
