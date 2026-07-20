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
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { resolveMediaPublicUrl } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash } from './canonical-json';
import {
  createPlayableInteractiveFilmDraftContentSchema,
  type FilmBuildDiagnosticDto,
  type StoryWorkingPreviewDto,
} from './dto';
import {
  compileStoryExperienceManifest,
  type StoryExperienceMediaIdentity,
} from './story-experience-manifest-compiler';
import {
  compileStoryFilmBuild,
  storyFilmRuntimeAssetId,
  type FrozenFilmClipAsset,
  type StoryFilmBuildClipInput,
} from './story-film-build-compiler';
import { storyFilmHasFailedTechnicalCheck } from './story-film-production.service';
import { projectStoryFilmRevision } from './story-film-revision-projector';
import { StoryPermissionService } from './story-permission.service';

const WORKING_PREVIEW_CLIP_INCLUDE =
  Prisma.validator<Prisma.StoryFilmClipInclude>()({
    revision: { select: { number: true } },
    currentVideoAsset: {
      include: {
        placements: true,
        variants: { include: { placements: true } },
      },
    },
    currentVideoVariant: { include: { placements: true } },
  });

type WorkingPreviewClip = Prisma.StoryFilmClipGetPayload<{
  include: typeof WORKING_PREVIEW_CLIP_INCLUDE;
}>;

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
      (tx) => this.compileLatestSavedDraft(tx, access.project, projectId),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async compileLatestSavedDraft(
    tx: Prisma.TransactionClient,
    project: {
      id: string;
      workspaceId: string;
      frameProfile: 'landscape_16_9' | 'portrait_9_16';
      defaultLocale: string;
      title: string;
      summary: string | null;
    },
    projectId: string,
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
    const actualHash = canonicalJsonHash(draft.content);
    if (actualHash !== draft.contentHash) {
      throw new ConflictException({
        code: 'DRAFT_INTEGRITY_ERROR',
        message: 'The saved draft content does not match its hash.',
        expectedHash: draft.contentHash,
        actualHash,
      });
    }

    const playableDraft = createPlayableInteractiveFilmDraftContentSchema(
      project.defaultLocale,
    ).safeParse(draft.content);
    if (!playableDraft.success) {
      return {
        draftRevision: draft.revision,
        contentHash: draft.contentHash,
        runtimeSchemaVersion: 2,
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
        runtimeSchemaVersion: 2,
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
        includeTrailer: false,
      });
    } catch (error) {
      return {
        draftRevision: draft.revision,
        contentHash: draft.contentHash,
        runtimeSchemaVersion: 2,
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

    const projectedClips = projection.clipSpecs.map((spec) => ({
      spec,
      specHash: canonicalJsonHash(spec),
    }));
    const expectedSpecHashByNodeId = new Map(
      projectedClips.map(({ spec, specHash }) => [spec.graphNodeId, specHash]),
    );
    const currentClips = await tx.storyFilmClip.findMany({
      where: {
        storyProjectId: projectId,
        archivedAt: null,
        graphNodeId: {
          in: projectedClips.map(({ spec }) => spec.graphNodeId),
        },
        specHash: {
          in: [...new Set(projectedClips.map(({ specHash }) => specHash))],
        },
        currentVideoAssetId: { not: null },
        currentVideoVariantId: { not: null },
      },
      orderBy: [
        { revision: { number: 'desc' } },
        { currentVideoRevision: 'desc' },
        { currentVideoSetAt: 'desc' },
        { updatedAt: 'desc' },
        { id: 'desc' },
      ],
      include: WORKING_PREVIEW_CLIP_INCLUDE,
    });
    const currentClipByNodeId = selectNewestWorkingPreviewVideos(
      currentClips,
      expectedSpecHashByNodeId,
    );
    const selections = projectedClips.map(({ spec, specHash }) => {
      const currentVideo = currentClipByNodeId.get(spec.graphNodeId) ?? null;
      return {
        input: prepareWorkingPreviewClip(
          project.workspaceId,
          spec,
          specHash,
          currentVideo,
        ),
        source:
          currentVideo?.currentVideoAssetId &&
          currentVideo.currentVideoVariantId
            ? {
                graphNodeId: spec.graphNodeId,
                assetId: currentVideo.currentVideoAssetId,
                variantId: currentVideo.currentVideoVariantId,
                sourceGenerationId: currentVideo.currentVideoSourceAttemptId,
                currentVideoRevision: currentVideo.currentVideoRevision,
                selection: 'current' as const,
              }
            : null,
      };
    });
    const compiled = compileStoryFilmBuild({
      projectId,
      revisionId: projectId,
      revisionNumber: draft.revision,
      buildId: `preview:${projectId}:draft:${draft.revision}`,
      profile: 'preview',
      scope: { kind: 'full' },
      draft: playableDraft.data,
      filmSpec: projection.filmSpec,
      clips: selections.map((selection) => selection.input),
    });
    const mediaIdentities = selections.flatMap((selection) => {
      const asset = selection.input.asset;
      if (!asset) return [];
      return [
        {
          runtimeAssetId: storyFilmRuntimeAssetId(selection.input),
          variantId: asset.variantId,
          mediaType: asset.contentType,
        } satisfies StoryExperienceMediaIdentity,
      ];
    });
    const experience = compiled.runtime
      ? compileStoryExperienceManifest({
          release: compiled.runtime,
          metadata: {
            title: project.title,
            summary:
              project.summary?.trim() || playableDraft.data.storyBible.logline,
          },
          stateVariables: playableDraft.data.storyBible.stateVariables,
          mediaIdentities,
        })
      : null;
    return {
      draftRevision: draft.revision,
      contentHash: draft.contentHash,
      runtimeSchemaVersion: 2,
      runtime: experience?.manifest
        ? (experience.manifest as Record<string, unknown>)
        : null,
      diagnostics: [
        ...compiled.diagnostics,
        ...(experience?.diagnostics.map((diagnostic) =>
          previewDiagnostic(
            'error',
            diagnostic.code,
            diagnostic.message,
            'revision',
            projectId,
          ),
        ) ?? []),
      ],
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
  currentVideo: WorkingPreviewClip | null,
): StoryFilmBuildClipInput {
  const diagnostics: FilmBuildDiagnosticDto[] = [];
  let asset: FrozenFilmClipAsset | null = null;
  if (!currentVideo) {
    diagnostics.push(
      previewDiagnostic(
        'error',
        'STORY_WORKING_PREVIEW_CURRENT_VIDEO_MISSING',
        `Shot ${spec.key} has no current video.`,
        'clip',
        spec.graphNodeId,
      ),
    );
  } else {
    if (currentVideo.currentVideoSpecHash === null) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_CURRENT_VIDEO_PROVENANCE_MISSING',
          `Shot ${spec.key} current video is missing the design snapshot required for playtesting.`,
          'asset',
          currentVideo.currentVideoAssetId,
        ),
      );
    } else if (
      currentVideo.currentVideoSpecHash !== specHash ||
      currentVideo.currentVideoInputHash !== currentVideo.productionInputHash
    ) {
      diagnostics.push(
        previewDiagnostic(
          'warning',
          'STORY_WORKING_PREVIEW_CURRENT_VIDEO_OUTDATED',
          `Shot ${spec.key} is using its previous current video while a newer design is pending.`,
          'asset',
          currentVideo.currentVideoAssetId,
        ),
      );
    }
    if (
      storyFilmHasFailedTechnicalCheck(
        currentVideo.currentVideoTechnicalChecks ?? [],
      )
    ) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_TECHNICAL_CHECK_FAILED',
          `Shot ${spec.key} current video has a failed technical check.`,
          'asset',
          currentVideo.currentVideoAssetId,
        ),
      );
    }
    const source = currentVideo.currentVideoAsset;
    const variant = currentVideo.currentVideoVariant;
    if (!source || !variant) {
      diagnostics.push(
        previewDiagnostic(
          'error',
          'STORY_WORKING_PREVIEW_OUTPUT_MISSING',
          `Shot ${spec.key} current video has no playable output.`,
          'clip',
          currentVideo.id,
        ),
      );
    } else {
      const width = variant.width ?? source.width;
      const height = variant.height ?? source.height;
      const durationSeconds = variant.durationSeconds ?? source.durationSeconds;
      const checksum = currentVideo.currentVideoChecksumSha256;
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
            `Shot ${spec.key} current video does not satisfy the current video output contract.`,
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
    productionInputHash: currentVideo?.currentVideoInputHash ?? null,
    spec,
    sourceGenerationId: currentVideo?.currentVideoSourceAttemptId ?? null,
    asset,
    eligibilityDiagnostics: diagnostics,
  };
}

export function selectWorkingPreviewVideo(
  clip: WorkingPreviewClip | null,
  specHash: string,
): WorkingPreviewClip | null {
  return clip &&
    clip.specHash === specHash &&
    clip.currentVideoAssetId !== null &&
    clip.currentVideoVariantId !== null
    ? clip
    : null;
}

/**
 * The database query is newest-first. Keep the first exact (node, spec)
 * current pointer and never let a newer incompatible production projection
 * hide an older reusable video whose immutable ClipSpec is still current.
 */
function selectNewestWorkingPreviewVideos(
  clips: readonly WorkingPreviewClip[],
  expectedSpecHashByNodeId: ReadonlyMap<string, string>,
): Map<string, WorkingPreviewClip> {
  const selected = new Map<string, WorkingPreviewClip>();
  clips.forEach((clip) => {
    if (selected.has(clip.graphNodeId)) return;
    const expectedSpecHash = expectedSpecHashByNodeId.get(clip.graphNodeId);
    if (!expectedSpecHash) return;
    const current = selectWorkingPreviewVideo(clip, expectedSpecHash);
    if (current) selected.set(clip.graphNodeId, current);
  });
  return selected;
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
