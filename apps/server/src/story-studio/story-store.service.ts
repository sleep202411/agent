import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { PrismaService } from '../infra/db/db.module';
import { StoryPublicationListingSnapshotSchema } from './story-publication-listing';
import { StoryPublicationAuthorityService } from './story-publication-authority.service';

/** Public introduction of Java's exact currently playable release version. */
export interface StoryStoreListingDto {
  gameId: string;
  title: string;
  defaultLocale: string;
  description: string;
  tags: string[];
  developer: string;
  trailerUrl: string | null;
  coverUrl: string | null;
  screenshots: { url: string }[];
}

export interface StoryStoreReviewListingDto extends StoryStoreListingDto {
  coverStatus: 'not_provided' | 'available' | 'unavailable';
}

const PLACEMENT_SELECT = {
  variantId: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  publicBaseUrl: true,
  role: true,
  status: true,
  priority: true,
  deletedAt: true,
} satisfies Prisma.MediaObjectPlacementSelect;

/** Keep the canonical resolver's current original and legacy placement paths.
 * A fallen asset's slide is dropped rather than failing the whole listing. */
const ASSET_SELECT = {
  id: true,
  kind: true,
  storageProvider: true,
  bucket: true,
  region: true,
  objectKey: true,
  externalUrl: true,
  status: true,
  moderationStatus: true,
  deletedAt: true,
  placements: { select: PLACEMENT_SELECT },
  variants: {
    where: { variantKey: 'original' },
    select: {
      variantKey: true,
      status: true,
      deletedAt: true,
      placements: { select: PLACEMENT_SELECT },
    },
  },
} satisfies Prisma.MediaAssetSelect;

@Injectable()
export class StoryStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: StoryPublicationAuthorityService,
  ) {}

  async getListing(gameId: string): Promise<StoryStoreListingDto | null> {
    const contentVersion = await this.authority.currentPublicVersion(gameId);
    if (!contentVersion) return null;
    // Java's historical catalogue also contains non-UUID game IDs. They have
    // no Story Project snapshots; avoid passing them into a UUID Prisma field.
    if (!z.uuid().safeParse(gameId).success) return null;
    return this.readFrozenListing(gameId, contentVersion, 'public');
  }

  /** Only called after the admin session and exact Java version are verified. */
  async getReviewListing(
    gameId: string,
    contentVersion: string,
  ): Promise<StoryStoreReviewListingDto | null> {
    // Historical Java works may predate UUID Story Projects entirely.
    if (!z.uuid().safeParse(gameId).success) return null;
    return this.readFrozenListing(gameId, contentVersion, 'review');
  }

  private readFrozenListing(
    gameId: string,
    contentVersion: string,
    audience: 'public',
  ): Promise<StoryStoreListingDto | null>;
  private readFrozenListing(
    gameId: string,
    contentVersion: string,
    audience: 'review',
  ): Promise<StoryStoreReviewListingDto | null>;
  private async readFrozenListing(
    gameId: string,
    contentVersion: string,
    audience: 'public' | 'review',
  ): Promise<StoryStoreListingDto | StoryStoreReviewListingDto | null> {
    const project = await this.prisma.storyProject.findFirst({
      where: {
        id: gameId,
        ...(audience === 'public'
          ? { status: 'active', archivedAt: null }
          : {}),
      },
      select: {
        id: true,
        experienceGameReleases: {
          where: {
            contentVersion,
            ...(audience === 'public'
              ? {
                  status: { not: 'rejected' },
                  mediaAuthorizationRevokedAt: null,
                }
              : {}),
          },
          select: { listingSnapshot: true },
          take: 1,
        },
        experienceDraftReleases: {
          where: {
            contentVersion,
            ...(audience === 'public' ? { status: { not: 'rejected' } } : {}),
          },
          select: { listingSnapshot: true },
          take: 1,
        },
      },
    });
    if (!project) return null;
    // One version must resolve to one frozen receipt, never a choice between
    // independent snapshots when an invalid migration/import duplicated it.
    if (
      project.experienceGameReleases.length &&
      project.experienceDraftReleases.length
    ) {
      throw invalidSnapshot(audience);
    }
    const storedSnapshot =
      project.experienceGameReleases[0]?.listingSnapshot ??
      project.experienceDraftReleases[0]?.listingSnapshot;
    if (storedSnapshot == null) return null;
    const snapshot =
      StoryPublicationListingSnapshotSchema.safeParse(storedSnapshot);
    if (!snapshot.success) {
      throw invalidSnapshot(audience);
    }
    const data = snapshot.data.listing;

    const assetIds = [
      ...(snapshot.data.coverAssetId ? [snapshot.data.coverAssetId] : []),
      ...(data.trailerAssetId ? [data.trailerAssetId] : []),
      ...data.screenshotAssetIds,
    ];
    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: assetIds } },
      select: ASSET_SELECT,
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    const cover = snapshot.data.coverAssetId
      ? byId.get(snapshot.data.coverAssetId)
      : undefined;
    const trailer = data.trailerAssetId
      ? byId.get(data.trailerAssetId)
      : undefined;
    const screenshots = data.screenshotAssetIds
      .map((id) => byId.get(id))
      .filter(
        (asset): asset is (typeof assets)[number] =>
          asset !== undefined && asset.kind === 'image',
      )
      .map((asset) => ({ url: resolveMediaPublicUrl(asset) }))
      .filter((slide): slide is { url: string } => Boolean(slide.url));

    const listing: StoryStoreListingDto = {
      gameId: project.id,
      title: snapshot.data.title,
      defaultLocale: snapshot.data.defaultLocale,
      description: data.description,
      tags: data.tags,
      developer: data.developer,
      trailerUrl:
        trailer && trailer.kind === 'video'
          ? resolveMediaPublicUrl(trailer)
          : null,
      coverUrl: cover?.kind === 'image' ? resolveMediaPublicUrl(cover) : null,
      screenshots,
    };
    if (audience === 'public') return listing;
    return {
      ...listing,
      coverStatus:
        snapshot.data.coverAssetId === null
          ? 'not_provided'
          : listing.coverUrl
            ? 'available'
            : 'unavailable',
    };
  }
}

function invalidSnapshot(
  audience: 'public' | 'review',
): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STORY_PUBLICATION_LISTING_INVALID',
    message:
      audience === 'review'
        ? 'The frozen promotional materials are invalid and cannot be reviewed.'
        : 'The published promotional materials are invalid and cannot be displayed.',
  });
}
