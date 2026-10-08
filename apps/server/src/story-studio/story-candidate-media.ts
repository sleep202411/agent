import { BadRequestException } from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  type StoryStoryboardClip,
} from '@prisma/client';

export interface StoryCandidateMedia {
  id: string;
  kind: MediaAssetKind;
  durationMs: number | null;
}

export async function requireStoryCandidateMedia(
  tx: Prisma.TransactionClient,
  projectId: string,
  mediaAssetId: string,
  expectedKind: StoryStoryboardClip['kind'],
  target: 'asset_spec' | 'storyboard_clip',
): Promise<StoryCandidateMedia> {
  const candidate = await tx.storyCandidateAsset.findUnique({
    where: {
      storyProjectId_mediaAssetId: {
        storyProjectId: projectId,
        mediaAssetId,
      },
    },
    select: {
      asset: {
        select: {
          id: true,
          kind: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
          durationSeconds: true,
          variants: {
            where: {
              variantKey: 'original',
              status: MediaAssetVariantStatus.ready,
              deletedAt: null,
            },
            select: { durationMs: true, durationSeconds: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!candidate || candidate.asset.deletedAt) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_INVALID'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_INVALID',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image must belong to this project candidate library.'
          : 'The imported media must belong to this project candidate library.',
    });
  }
  if (candidate.asset.status !== MediaAssetStatus.ready) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_NOT_READY'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_NOT_READY',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image is not ready yet.'
          : 'The imported media is not ready yet.',
    });
  }
  if (candidate.asset.moderationStatus === MediaAssetModerationStatus.blocked) {
    throw new BadRequestException({
      code:
        target === 'asset_spec'
          ? 'ASSET_SPEC_SOURCE_MEDIA_BLOCKED'
          : 'STORYBOARD_CLIP_SOURCE_MEDIA_BLOCKED',
      message:
        target === 'asset_spec'
          ? 'The imported Asset image was blocked by moderation and cannot be used.'
          : 'The imported media was blocked by moderation and cannot be used.',
    });
  }
  if (target === 'asset_spec') {
    assertAssetSpecImageKind(candidate.asset.kind);
  } else {
    assertStoryboardClipMediaKind(expectedKind, candidate.asset.kind);
  }
  const original = candidate.asset.variants[0] ?? null;
  const durationMs =
    original?.durationMs ??
    (original?.durationSeconds
      ? original.durationSeconds * 1_000
      : candidate.asset.durationSeconds
        ? candidate.asset.durationSeconds * 1_000
        : null);
  return {
    id: candidate.asset.id,
    kind: candidate.asset.kind,
    durationMs,
  };
}

export function assertAssetSpecImageKind(mediaKind: MediaAssetKind): void {
  if (String(mediaKind) === 'image') return;
  throw new BadRequestException({
    code: 'ASSET_SPEC_MEDIA_KIND_MISMATCH',
    message: 'An Asset Spec can only select image media.',
    mediaKind,
  });
}

export function assertStoryboardClipMediaKind(
  clipKind: StoryStoryboardClip['kind'],
  mediaKind: MediaAssetKind,
): void {
  if (String(clipKind) === String(mediaKind)) return;
  throw new BadRequestException({
    code: 'STORYBOARD_CLIP_MEDIA_KIND_MISMATCH',
    message: `A ${clipKind} Storyboard clip can only select ${clipKind} media.`,
    clipKind,
    mediaKind,
  });
}
