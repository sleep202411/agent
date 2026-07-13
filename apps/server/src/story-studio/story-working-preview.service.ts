import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  Prisma,
  StoryFilmTakeStatus,
  StoryReviewDecision,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  createLockableInteractiveFilmDraftContentSchema,
  type FilmBuildDiagnosticDto,
  type StoryWorkingPreviewDto,
} from './dto';
import {
  compileStoryFilmBuild,
  type FrozenFilmClipAsset,
  type StoryFilmBuildClipInput,
} from './story-film-build-compiler';
import { storyFilmHasFailedTechnicalCheck } from './story-film-production.service';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { StoryPermissionService } from './story-permission.service';

const WORKING_PREVIEW_TAKE_INCLUDE =
  Prisma.validator<Prisma.StoryFilmTakeInclude>()({
    approval: { select: { takeId: true } },
    reviews: {
      orderBy: [{ sequence: 'desc' }, { id: 'desc' }],
      take: 1,
      select: { decision: true },
    },
    outputAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    outputVariant: { include: { placements: true } },
  });

const WORKING_PREVIEW_CLIP_INCLUDE =
  Prisma.validator<Prisma.StoryFilmClipInclude>()({
    masterTake: { include: WORKING_PREVIEW_TAKE_INCLUDE },
    takes: {
      where: {
        status: StoryFilmTakeStatus.ready,
        supersededAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: WORKING_PREVIEW_TAKE_INCLUDE,
    },
  });

type WorkingPreviewTake = Prisma.StoryFilmTakeGetPayload<{
  include: typeof WORKING_PREVIEW_TAKE_INCLUDE;
}>;

type WorkingPreviewClip = Prisma.StoryFilmClipGetPayload<{
  include: typeof WORKING_PREVIEW_CLIP_INCLUDE;
}>;

interface WorkingPreviewTakeSelection {
  take: WorkingPreviewTake;
  kind: 'master' | 'latest_ready';
}

@Injectable()
export class StoryWorkingPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
  ) {}

  async getWorkingPreview(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    expectedDraftRevision: number,
  ): Promise<StoryWorkingPreviewDto> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.read',
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }

    return this.prisma.$transaction(
      (tx) =>
        this.compileSavedDraft(
          tx,
          access.project,
          projectId,
          expectedDraftRevision,
        ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async compileSavedDraft(
    tx: Prisma.TransactionClient,
    project: {
      id: string;
      workspaceId: string;
      frameProfile: 'landscape_16_9' | 'portrait_9_16';
      defaultLocale: string;
    },
    projectId: string,
    expectedDraftRevision: number,
  ): Promise<StoryWorkingPreviewDto> {
    const draft = await tx.storyDraft.findUnique({
      where: { storyProjectId: projectId },
    });
    if (!draft) {
      throw new NotFoundException({
        code: 'STORY_DRAFT_NOT_FOUND',
        message: 'Story draft not found.',
      });
    }
    if (draft.revision !== expectedDraftRevision) {
      throw new ConflictException({
        code: 'DRAFT_REVISION_CONFLICT',
        message: 'The saved draft changed before the working preview compiled.',
        expectedRevision: expectedDraftRevision,
        actualRevision: draft.revision,
      });
    }
    const actualHash = canonicalJsonHash(draft.content);
    if (actualHash !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
        expectedHash: draft.contentHash,
        actualHash,
      });
    }

    const playableDraft = createLockableInteractiveFilmDraftContentSchema(
      project.defaultLocale,
    ).safeParse(draft.content);
    if (!playableDraft.success) {
      return {
        draftRevision: draft.revision,
        contentHash: draft.contentHash,
        runtime: null,
        diagnostics: playableDraft.error.issues.map((issue) =>
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_DRAFT_INCOMPLETE',
            `${issue.path.join('.') || 'draft'}: Complete this field before playtesting.`,
            'revision',
            projectId,
          ),
        ),
        pathReport: null,
        sources: [],
      };
    }

    const defaultCanonicalModelId = await resolvePreviewCanonicalModelId(
      tx,
      projectId,
    );
    if (!defaultCanonicalModelId) {
      return {
        draftRevision: draft.revision,
        contentHash: draft.contentHash,
        runtime: null,
        diagnostics: [
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_VIDEO_MODEL_UNAVAILABLE',
            'No active video model is available to evaluate the current story output contract.',
            'revision',
            projectId,
          ),
        ],
        pathReport: null,
        sources: [],
      };
    }

    let projection: ReturnType<typeof projectStoryFilmRevision>;
    try {
      projection = projectStoryFilmRevision({
        draft: playableDraft.data,
        frameProfile: project.frameProfile,
        defaultLocale: project.defaultLocale,
        defaultCanonicalModelId,
      });
    } catch (error) {
      return {
        draftRevision: draft.revision,
        contentHash: draft.contentHash,
        runtime: null,
        diagnostics: [
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_DRAFT_INVALID',
            error instanceof Error
              ? error.message
              : 'The current story graph cannot be compiled.',
            'revision',
            projectId,
          ),
        ],
        pathReport: null,
        sources: [],
      };
    }

    const currentClips = await tx.storyFilmClip.findMany({
      where: {
        storyProjectId: projectId,
        archivedAt: null,
        revision: {
          sourceDraftRevision: draft.revision,
        },
        graphNodeId: {
          in: projection.clipSpecs.map((clip) => clip.graphNodeId),
        },
      },
      include: WORKING_PREVIEW_CLIP_INCLUDE,
    });
    const currentClipByNodeId = new Map(
      currentClips.map((clip) => [clip.graphNodeId, clip]),
    );
    const selections = projection.clipSpecs.map((clip) => {
      const specHash = canonicalJsonHash(clip);
      const selection = selectWorkingPreviewTake(
        currentClipByNodeId.get(clip.graphNodeId) ?? null,
        specHash,
      );
      return {
        input: prepareWorkingPreviewClip(
          project.workspaceId,
          clip,
          specHash,
          selection,
        ),
        source: selection
          ? {
              graphNodeId: clip.graphNodeId,
              takeId: selection.take.id,
              selection: selection.kind,
            }
          : null,
      };
    });
    const compiled = compileStoryFilmBuild({
      projectId,
      revisionId: projectId,
      revisionNumber: draft.revision,
      buildId: projectId,
      profile: 'preview',
      scope: { kind: 'full' },
      draft: playableDraft.data,
      filmSpec: projection.filmSpec,
      clips: selections.map((selection) => selection.input),
    });
    return {
      draftRevision: draft.revision,
      contentHash: draft.contentHash,
      runtime: compiled.runtime
        ? (compiled.runtime as unknown as Record<string, unknown>)
        : null,
      diagnostics: compiled.diagnostics,
      pathReport: compiled.pathReport,
      sources: selections.flatMap((selection) =>
        selection.source ? [selection.source] : [],
      ),
    };
  }
}

async function resolvePreviewCanonicalModelId(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<string | null> {
  const projected = await tx.storyFilmSpec.findFirst({
    where: { storyProjectId: projectId },
    orderBy: [{ updatedAt: 'desc' }, { revisionId: 'desc' }],
    select: { defaultCanonicalModelId: true },
  });
  if (projected) return projected.defaultCanonicalModelId;
  const configuredSlug =
    process.env.STORY_STUDIO_DEFAULT_VIDEO_MODEL_SLUG?.trim();
  const active = await tx.aiCanonicalModel.findFirst({
    where: {
      ...(configuredSlug ? { slug: configuredSlug } : {}),
      modality: 'video',
      status: 'active',
      archivedAt: null,
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return active?.id ?? null;
}

function prepareWorkingPreviewClip(
  workspaceId: string,
  spec: ReturnType<typeof projectStoryFilmRevision>['clipSpecs'][number],
  specHash: string,
  selection: WorkingPreviewTakeSelection | null,
): StoryFilmBuildClipInput {
  const diagnostics: FilmBuildDiagnosticDto[] = [];
  let asset: FrozenFilmClipAsset | null = null;
  const take = selection?.take ?? null;
  if (!take) {
    diagnostics.push(
      previewDiagnostic(
        'error',
        'STORY_WORKING_PREVIEW_TAKE_MISSING',
        `Shot ${spec.key} has no ready video Take matching its current director design.`,
        'clip',
        spec.graphNodeId,
      ),
    );
  } else {
    if (selection?.kind === 'latest_ready') {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_READY_TAKE_FALLBACK',
          `Shot ${spec.key} has no current Master, so preview is using its latest compatible ready Take.`,
          'take',
          take.id,
        ),
      );
    }
    if (storyFilmHasFailedTechnicalCheck(take.technicalChecks)) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_TECHNICAL_CHECK_FAILED',
          `Shot ${spec.key} latest ready Take has a failed technical check.`,
          'take',
          take.id,
        ),
      );
    }
    const source = take.outputAsset;
    const variant = take.outputVariant;
    if (!source || !variant) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
          `Shot ${spec.key} latest ready Take has no playable output.`,
          'take',
          take.id,
        ),
      );
    } else {
      const width = variant.width ?? source.width;
      const height = variant.height ?? source.height;
      const durationSeconds = variant.durationSeconds ?? source.durationSeconds;
      const checksum = take.outputChecksumSha256;
      const url = resolveMediaPublicUrl(source);
      if (
        source.workspaceId !== workspaceId ||
        source.kind !== MediaAssetKind.video ||
        source.status !== MediaAssetStatus.ready ||
        source.deletedAt ||
        variant.assetId !== source.id ||
        variant.status !== MediaAssetVariantStatus.ready ||
        variant.deletedAt ||
        source.moderationStatus === MediaAssetModerationStatus.blocked ||
        !checksum ||
        source.checksumSha256 !== checksum ||
        variant.checksumSha256 !== checksum ||
        width !== spec.outputContract.width ||
        height !== spec.outputContract.height ||
        durationSeconds === null ||
        Math.abs(durationSeconds * 1_000 - spec.outputContract.durationMs) >
          spec.outputContract.durationToleranceMs ||
        !url
      ) {
        diagnostics.push(
          previewDiagnostic(
            'error',
            'STORY_WORKING_PREVIEW_OUTPUT_INELIGIBLE',
            `Shot ${spec.key} latest ready Take does not satisfy the current video output contract.`,
            'asset',
            source.id,
          ),
        );
      } else {
        if (source.moderationStatus !== MediaAssetModerationStatus.approved) {
          diagnostics.push(
            previewDiagnostic(
              'warning',
              'STORY_WORKING_PREVIEW_MODERATION_PENDING',
              `Shot ${spec.key} output has not completed moderation review.`,
              'asset',
              source.id,
            ),
          );
        }
        asset = {
          assetId: source.id,
          variantId: variant.id,
          checksumSha256: checksum,
          contentType: variant.contentType || source.contentType,
          sizeBytes: variant.sizeBytes ?? source.sizeBytes,
          width,
          height,
          durationMs: durationSeconds * 1_000,
          url,
        };
      }
    }
  }
  return {
    id: spec.graphNodeId,
    key: spec.key,
    graphNodeId: spec.graphNodeId,
    rank: spec.rank,
    specHash,
    productionInputHash: take?.productionInputHash ?? null,
    spec,
    takeId: take?.id ?? null,
    asset,
    eligibilityDiagnostics: diagnostics,
  };
}

export function selectWorkingPreviewTake(
  clip: WorkingPreviewClip | null,
  specHash: string,
): WorkingPreviewTakeSelection | null {
  if (!clip || clip.specHash !== specHash || !clip.productionInputHash) {
    return null;
  }
  const isCurrent = (
    take: WorkingPreviewTake | null,
  ): take is WorkingPreviewTake => {
    if (
      !take ||
      take.status !== StoryFilmTakeStatus.ready ||
      take.supersededAt ||
      take.clipSpecHash !== specHash ||
      take.productionInputHash !== clip.productionInputHash
    ) {
      return false;
    }
    const latestDecision = take.reviews[0]?.decision;
    return (
      latestDecision !== StoryReviewDecision.reject &&
      latestDecision !== StoryReviewDecision.request_changes
    );
  };
  if (
    clip.masterTakeId &&
    clip.masterTake?.id === clip.masterTakeId &&
    clip.masterTake.approval &&
    isCurrent(clip.masterTake)
  ) {
    return { take: clip.masterTake, kind: 'master' };
  }
  const fallback = clip.takes.find((take) => isCurrent(take));
  return fallback ? { take: fallback, kind: 'latest_ready' } : null;
}

function previewDiagnostic(
  severity: FilmBuildDiagnosticDto['severity'],
  code: string,
  message: string,
  entityType: FilmBuildDiagnosticDto['entityType'],
  entityId: string | null,
): FilmBuildDiagnosticDto {
  return { severity, code, message, entityType, entityId };
}
