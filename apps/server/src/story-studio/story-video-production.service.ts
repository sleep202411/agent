import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  InteractiveStoryDraftContentSchema,
  type MediaAssetSummaryDto,
  type StoryClipVideoSummaryDto,
  type StoryCurrentVideoDto,
} from './dto';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import type { PutStoryClipVideoSelectionInput } from './story-video-production.schema';

const MEDIA_ASSET_INCLUDE = Prisma.validator<Prisma.MediaAssetInclude>()({
  placements: true,
  variants: {
    include: { placements: true },
    orderBy: [{ variantKey: 'asc' }, { id: 'asc' }],
  },
});

type MediaAssetRow = Prisma.MediaAssetGetPayload<{
  include: typeof MEDIA_ASSET_INCLUDE;
}>;

interface UsableVideoVariant {
  asset: MediaAssetRow;
  variantId: string;
  checksumSha256: string | null;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: bigint | null;
  browserSafeMp4: boolean;
}

@Injectable()
export class StoryVideoProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async putClipCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
    input: PutStoryClipVideoSelectionInput,
  ): Promise<StoryClipVideoSummaryDto> {
    await this.requireProjectScope(
      user,
      workspaceId,
      projectId,
      'story.generate',
    );
    await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      await this.assertCurrentDraftClip(
        tx,
        projectId,
        graphNodeId,
        input.expectedDraftRevision,
      );
      const media =
        input.assetId && input.variantId
          ? await requireUsableVideoVariant(
              tx,
              workspaceId,
              input.assetId,
              input.variantId,
            )
          : null;

      await lockSelection(tx, projectId, graphNodeId);
      const existing = await tx.storyVideoSelection.findFirst({
        where: { storyProjectId: projectId, graphNodeId },
      });
      const actualVersion = existing?.version ?? 0;
      if (
        input.expectedSelectionVersion !== undefined &&
        actualVersion !== input.expectedSelectionVersion
      ) {
        throw selectionVersionConflict(
          input.expectedSelectionVersion,
          actualVersion,
        );
      }
      const data = selectionMediaData(media, user.userId, actualVersion + 1);
      if (!existing) {
        await tx.storyVideoSelection.create({
          data: { storyProjectId: projectId, graphNodeId, ...data },
        });
        return;
      }
      const updated = await tx.storyVideoSelection.updateMany({
        where: { id: existing.id, version: actualVersion },
        data,
      });
      if (updated.count !== 1) {
        // Lost a concurrent write on the same row. This is not the caller's
        // token being stale — it is two writers at once — so it reports the
        // version it read either way.
        throw selectionVersionConflict(actualVersion, actualVersion + 1);
      }
    });
    return this.getClipSummary(user, workspaceId, projectId, graphNodeId);
  }

  async getClipSummary(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    graphNodeId: string,
  ): Promise<StoryClipVideoSummaryDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const selection = await this.prisma.storyVideoSelection.findFirst({
      where: { storyProjectId: projectId, graphNodeId },
      include: { currentAsset: { include: MEDIA_ASSET_INCLUDE } },
    });
    return {
      graphNodeId,
      selectionVersion: selection?.version ?? 0,
      currentVideo: selection
        ? currentVideoDto(selection, selection.currentAsset)
        : null,
    };
  }

  private async assertCurrentDraftClip(
    tx: Prisma.TransactionClient,
    projectId: string,
    graphNodeId: string,
    expectedDraftRevision: number | undefined,
  ): Promise<void> {
    const draft = await tx.storyDraft.findUnique({
      where: { storyProjectId: projectId },
      select: { revision: true, content: true, contentHash: true },
    });
    if (!draft) {
      throw new NotFoundException({
        code: 'STORY_DRAFT_NOT_FOUND',
        message: 'Story draft not found.',
      });
    }
    if (
      expectedDraftRevision !== undefined &&
      draft.revision !== expectedDraftRevision
    ) {
      throw draftRevisionConflict(expectedDraftRevision, draft.revision);
    }
    if (canonicalJsonHash(draft.content) !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
      });
    }
    const parsed = InteractiveStoryDraftContentSchema.safeParse(draft.content);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        code: 'STORY_DRAFT_INVALID',
        message: 'The saved story draft does not match the current schema.',
      });
    }
    const node = parsed.data.graph.nodes.find(
      (candidate) => candidate.nodeId === graphNodeId,
    );
    if (!node || node.kind !== 'clip') {
      throw new NotFoundException({
        code: 'STORY_CLIP_NOT_FOUND',
        message: 'Story clip node not found in the current draft.',
      });
    }
  }

  private async requireProjectScope(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    capability: Parameters<StoryPermissionService['requireProject']>[2],
  ) {
    const scope = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
    if (scope.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    return scope;
  }
}

async function lockSelection(
  tx: Prisma.TransactionClient,
  projectId: string,
  graphNodeId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`story-video-selection:${projectId}:${graphNodeId}`})::bigint
    )
  `;
}

async function requireUsableVideoVariant(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  assetId: string,
  variantId: string,
): Promise<UsableVideoVariant> {
  // Not scoped by workspaceId — see addCandidateAsset. Uploaded video carries
  // no workspace, so this was the one condition a finished cut could never
  // satisfy, reported as "not a ready, accessible video in this workspace".
  const asset = await tx.mediaAsset.findFirst({
    where: { id: assetId },
    include: MEDIA_ASSET_INCLUDE,
  });
  const variant = asset?.variants.find(
    (candidate) => candidate.id === variantId,
  );
  const usable = asset && variant ? usableVideoVariant(asset, variant) : null;
  if (!usable) {
    throw new UnprocessableEntityException({
      code: 'STORY_VIDEO_VARIANT_NOT_USABLE',
      message:
        'The selected video variant is not a ready, accessible video in this workspace.',
    });
  }
  return usable;
}

function usableVideoVariant(
  asset: MediaAssetRow,
  variant: MediaAssetRow['variants'][number],
): UsableVideoVariant | null {
  if (
    asset.kind !== MediaAssetKind.video ||
    asset.status !== MediaAssetStatus.ready ||
    asset.moderationStatus === MediaAssetModerationStatus.blocked ||
    asset.deletedAt ||
    variant.assetId !== asset.id ||
    variant.status !== MediaAssetVariantStatus.ready ||
    variant.deletedAt ||
    !variant.contentType.toLowerCase().startsWith('video/')
  ) {
    return null;
  }
  return {
    asset,
    variantId: variant.id,
    checksumSha256: variant.checksumSha256,
    contentType: variant.contentType,
    durationMs: variant.durationMs,
    width: variant.width,
    height: variant.height,
    sizeBytes: variant.sizeBytes ?? asset.sizeBytes,
    browserSafeMp4: isBrowserSafeMp4Metadata(variant.metadata),
  };
}

function isBrowserSafeMp4Metadata(value: unknown): boolean {
  const metadata = jsonRecord(value);
  return (
    metadata?.browserSafeMp4 === true ||
    jsonRecord(metadata?.videoProbe)?.browserSafeMp4 === true
  );
}

function selectionMediaData(
  media: UsableVideoVariant | null,
  userId: string,
  version: number,
) {
  return {
    currentAssetId: media?.asset.id ?? null,
    currentVariantId: media?.variantId ?? null,
    currentChecksumSha256: media?.checksumSha256 ?? null,
    currentContentType: media?.contentType ?? null,
    currentDurationMs: media?.durationMs ?? null,
    currentWidth: media?.width ?? null,
    currentHeight: media?.height ?? null,
    currentBrowserSafeMp4: media?.browserSafeMp4 ?? null,
    version,
    setByUserId: userId,
    setAt: new Date(),
  };
}

function currentVideoDto(
  selection: {
    currentAssetId: string | null;
    currentVariantId: string | null;
    currentContentType: string | null;
    version: number;
    setByUserId: string | null;
    setAt: Date | null;
  },
  asset: MediaAssetRow | null,
): StoryCurrentVideoDto | null {
  const variant = asset?.variants.find(
    (candidate) => candidate.id === selection.currentVariantId,
  );
  const usable = asset && variant ? usableVideoVariant(asset, variant) : null;
  if (
    !usable ||
    !selection.currentAssetId ||
    !selection.currentVariantId ||
    !selection.currentContentType ||
    !selection.setAt ||
    selection.currentAssetId !== usable.asset.id ||
    selection.currentVariantId !== usable.variantId ||
    selection.currentContentType !== usable.contentType
  ) {
    return null;
  }
  return {
    asset: mediaAssetSummary(usable.asset),
    variantId: usable.variantId,
    checksumSha256: usable.checksumSha256,
    contentType: usable.contentType,
    durationMs: usable.durationMs,
    width: usable.width,
    height: usable.height,
    sizeBytes: usable.sizeBytes?.toString() ?? null,
    browserSafeMp4: usable.browserSafeMp4,
    selectionVersion: selection.version,
    setByUserId: selection.setByUserId,
    setAt: selection.setAt.toISOString(),
  };
}

function mediaAssetSummary(asset: MediaAssetRow): MediaAssetSummaryDto {
  return {
    id: asset.id,
    kind: asset.kind,
    status: asset.status,
    moderationStatus: asset.moderationStatus,
    contentType: asset.contentType,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    checksumSha256: asset.checksumSha256,
    previewUrl: resolveMediaPublicUrl(asset),
  };
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function selectionVersionConflict(
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_VIDEO_SELECTION_VERSION_CONFLICT',
    message: 'The current video selection changed. Refresh and try again.',
    expectedVersion: expected,
    actualVersion: actual,
  });
}

function draftRevisionConflict(
  expected: number,
  actual: number,
): ConflictException {
  return new ConflictException({
    code: 'DRAFT_REVISION_CONFLICT',
    message: 'The story draft changed. Refresh and try again.',
    expectedRevision: expected,
    actualRevision: actual,
  });
}
