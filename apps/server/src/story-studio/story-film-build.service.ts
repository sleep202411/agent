import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MediaAssetKind,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  Prisma,
  StoryBuildKind,
  StoryBuildStatus,
  StoryFilmContinuityDecision,
  StoryFilmDependencyKind,
} from '@prisma/client';
import { EXPERIENCE_RUNTIME_SCHEMA_VERSION } from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaStorageAccessService,
  type MediaStorageReadRef,
} from '../infra/storage/media-storage-access.service';
import { requireModerationApproval } from '../media/media-moderation-policy';
import { canonicalJsonHash } from './canonical-json';
import {
  collectInteractiveFilmRuntimeLocales,
  createLockableInteractiveFilmDraftContentSchema,
  FilmBuildScopeSchema,
  FilmClipSpecSchema,
  FilmSpecSchema,
  type CancelFilmBuildInput,
  type CreateFilmBuildInput,
  type CursorPageDto,
  type FilmBuildAssetDto,
  type FilmBuildDiagnosticDto,
  type FilmBuildDto,
  type FilmBuildListQuery,
  type FilmBuildPathReportDto,
  type FilmBuildSummaryDto,
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
import { storyFilmTechnicalCheckDtos } from './story-film-production.service';
import { StoryPermissionService } from './story-permission.service';

const BUILD_INCLUDE = Prisma.validator<Prisma.StoryBuildInclude>()({
  project: { select: { workspaceId: true } },
  experiencePublication: {
    select: {
      status: true,
      gameId: true,
      contentVersion: true,
      manifestUrl: true,
      publishedAt: true,
      mediaAuthorizedAt: true,
      mediaAuthorizationRevokedAt: true,
      authorityIsCurrent: true,
      authorityGameExists: true,
      authorityCurrentVersion: true,
      authorityCheckedAt: true,
      lastErrorCode: true,
      lastErrorDetail: true,
    },
  },
  assets: {
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    include: {
      filmClip: { select: { clipId: true } },
      asset: {
        select: {
          id: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
        },
      },
      variant: {
        select: {
          id: true,
          assetId: true,
          status: true,
          checksumSha256: true,
          deletedAt: true,
        },
      },
    },
  },
});
type BuildRow = Prisma.StoryBuildGetPayload<{ include: typeof BUILD_INCLUDE }>;

const BUILD_DELIVERY_ASSET_INCLUDE =
  Prisma.validator<Prisma.StoryBuildAssetInclude>()({
    build: {
      select: {
        status: true,
        kind: true,
        scope: true,
        experiencePublication: {
          select: {
            mediaAuthorizedAt: true,
            mediaAuthorizationRevokedAt: true,
          },
        },
      },
    },
    asset: { include: { placements: true } },
    variant: { include: { placements: true } },
  });
type BuildDeliveryAssetRow = Prisma.StoryBuildAssetGetPayload<{
  include: typeof BUILD_DELIVERY_ASSET_INCLUDE;
}>;

const BUILD_MEDIA_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_USER_READ_URL_TTL_SECONDS,
  5 * 60,
);
// Bump this whenever identical authored inputs can compile to materially
// different Build output without an Experience runtime schema version bump.
// It is part of semantic Build identity, not transport idempotency: retries
// with the same Idempotency-Key still replay their original submission.
const STORY_FILM_BUILD_COMPILER_SEMANTIC_VERSION = 1;
const REQUIRED_CURRENT_VIDEO_TECHNICAL_CHECK_KEYS = [
  'kind',
  'dimensions',
  'duration',
  'checksum',
] as const;

const BUILD_CLIP_INCLUDE = Prisma.validator<Prisma.StoryFilmClipInclude>()({
  currentVideoAsset: {
    include: {
      placements: true,
    },
  },
  currentVideoVariant: { include: { placements: true } },
});
type BuildClipRow = Prisma.StoryFilmClipGetPayload<{
  include: typeof BUILD_CLIP_INCLUDE;
}>;

const BUILD_DEPENDENCY_INCLUDE =
  Prisma.validator<Prisma.StoryFilmClipDependencyInclude>()({
    continuityChecks: {
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        upstreamAssetId: true,
        upstreamVariantId: true,
        upstreamChecksumSha256: true,
        downstreamAssetId: true,
        downstreamVariantId: true,
        downstreamChecksumSha256: true,
        decision: true,
      },
    },
  });
type BuildDependencyRow = Prisma.StoryFilmClipDependencyGetPayload<{
  include: typeof BUILD_DEPENDENCY_INCLUDE;
}>;

interface BuildCursor {
  number: number;
  id: string;
}

interface CompilationSnapshot {
  project: {
    id: string;
    title: string;
    summary: string | null;
    defaultLocale: string;
  };
  revision: {
    id: string;
    number: number;
    content: Prisma.JsonValue;
    contentHash: string;
  };
  filmSpec: {
    specJson: Prisma.JsonValue;
    specHash: string;
    productionRevision: number;
  };
  clips: BuildClipRow[];
  dependencies: BuildDependencyRow[];
}

@Injectable()
export class StoryFilmBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly storageAccess: MediaStorageAccessService,
  ) {}

  async createBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: CreateFilmBuildInput,
    idempotencyKey: string,
  ): Promise<FilmBuildDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.build');
    const submissionKey = storyBuildSubmissionKey(
      user.userId,
      projectId,
      idempotencyKey,
    );
    const requestFingerprint = storyBuildRequestFingerprint(input);
    const replay = await this.prisma.storyBuild.findUnique({
      where: { submissionKey },
      include: BUILD_INCLUDE,
    });
    if (replay) {
      assertBuildReplay(replay, requestFingerprint);
      return this.toBuildDto(await this.processBuild(replay));
    }

    let created: BuildRow;
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-build-submission:${submissionKey}`})::bigint
          )
        `;
          const concurrent = await tx.storyBuild.findUnique({
            where: { submissionKey },
            include: BUILD_INCLUDE,
          });
          if (concurrent) {
            assertBuildReplay(concurrent, requestFingerprint);
            return concurrent;
          }
          const snapshot = await loadCompilationSnapshot(
            tx,
            projectId,
            input.revisionId,
          );
          if (
            snapshot.filmSpec.productionRevision !==
            input.expectedProductionRevision
          ) {
            throw productionRevisionConflict(
              input.expectedProductionRevision,
              snapshot.filmSpec.productionRevision,
            );
          }
          const inputManifest = storyFilmBuildInputManifest(input, snapshot);
          const inputManifestHash = canonicalJsonHash(inputManifest);
          const inputHash = storyFilmBuildSemanticInputHash(
            input,
            snapshot,
            inputManifestHash,
          );
          // Idempotency-Key protects one transport submission. This second lock
          // protects the immutable Build meaning itself, so independent tabs
          // with different random keys converge on one exact artifact. The
          // post-lock lookup is deliberately exhaustive: a hash collision may
          // serialize unrelated work but can never cause an incorrect replay.
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-build-input:${projectId}:${inputHash}`})::bigint
          )
        `;
          const semanticReplay = await tx.storyBuild.findFirst({
            where: {
              storyProjectId: projectId,
              sourceRevisionId: input.revisionId,
              requestFingerprint,
              kind: input.profile,
              scope: { equals: input.scope },
              sourceProductionRevision: input.expectedProductionRevision,
              status: { in: semanticReplayBuildStatuses() },
              inputHash,
              inputManifestHash,
              runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
              NOT: {
                experiencePublication: { is: { status: 'rejected' } },
              },
            },
            orderBy: [{ buildNumber: 'asc' }, { id: 'asc' }],
            include: BUILD_INCLUDE,
          });
          if (semanticReplay) return semanticReplay;

          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`story-film-build-number:${projectId}`})::bigint
          )
        `;
          const project = await tx.storyProject.findFirst({
            where: { id: projectId, workspaceId },
            select: { nextBuildNumber: true },
          });
          if (!project) throw projectNotFound();
          await tx.storyProject.update({
            where: { id: projectId },
            data: { nextBuildNumber: { increment: 1 } },
          });
          return tx.storyBuild.create({
            data: {
              storyProjectId: projectId,
              sourceRevisionId: input.revisionId,
              buildNumber: project.nextBuildNumber,
              submissionKey,
              requestFingerprint,
              kind: input.profile,
              scope: input.scope,
              sourceProductionRevision: input.expectedProductionRevision,
              status: StoryBuildStatus.queued,
              inputHash,
              inputManifestHash,
              runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
              createdByUserId: user.userId,
            },
            include: BUILD_INCLUDE,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.prisma.storyBuild.findUnique({
        where: { submissionKey },
        include: BUILD_INCLUDE,
      });
      if (!winner) throw error;
      assertBuildReplay(winner, requestFingerprint);
      created = winner;
    }
    return this.toBuildDto(await this.processBuild(created));
  }

  async listBuilds(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    query: FilmBuildListQuery,
  ): Promise<CursorPageDto<FilmBuildSummaryDto>> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const cursor = query.cursor ? decodeBuildCursor(query.cursor) : null;
    const rows = await this.prisma.storyBuild.findMany({
      where: {
        storyProjectId: projectId,
        ...(query.profile ? { kind: query.profile } : {}),
        ...(cursor
          ? {
              OR: [
                { buildNumber: { lt: cursor.number } },
                { buildNumber: cursor.number, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ buildNumber: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: BUILD_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toBuildSummaryDto(row)),
      nextCursor:
        hasMore && last
          ? encodeBuildCursor({ number: last.buildNumber, id: last.id })
          : null,
    };
  }

  async getBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    buildId: string,
  ): Promise<FilmBuildDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    return this.toBuildDto(await this.loadBuild(projectId, buildId));
  }

  async issueBuildAssetReadUrl(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
  ): Promise<{ url: string; expiresAt: string | null }> {
    // The stable URI frozen into a Build is an identity, not an authorization
    // capability. Java publication is the only event that makes its exact
    // full-production Build anonymously deliverable. Every other Build is
    // authorized against current story membership on every URL exchange.
    const frozen = await this.prisma.storyBuildAsset.findFirst({
      where: {
        storyProjectId: projectId,
        buildId,
        assetId,
        variantId,
      },
      include: BUILD_DELIVERY_ASSET_INCLUDE,
    });
    if (!frozen || frozen.build.status !== StoryBuildStatus.ready) {
      throw new NotFoundException({
        code: 'STORY_BUILD_ASSET_NOT_FOUND',
        message: 'Build media asset not found.',
      });
    }
    const scope = FilmBuildScopeSchema.safeParse(frozen.build.scope);
    const isPubliclyPublished =
      frozen.build.kind === StoryBuildKind.production &&
      scope.success &&
      scope.data.kind === 'full' &&
      frozen.build.experiencePublication?.mediaAuthorizedAt != null &&
      frozen.build.experiencePublication.mediaAuthorizationRevokedAt === null;
    if (!isPubliclyPublished) {
      if (!user) {
        throw new UnauthorizedException({
          code: 'STORY_BUILD_ASSET_AUTH_REQUIRED',
          message:
            'Authentication is required to access unpublished Build media.',
        });
      }
      await this.permissions.requireProject(
        user.userId,
        projectId,
        'story.read',
      );
    }
    const currentDiagnostics = storyBuildCurrentMediaDiagnostics(
      [frozen],
      requireModerationApproval(),
    );
    const unavailable = currentDiagnostics[0];
    if (unavailable) {
      const payload = {
        code: unavailable.code,
        message: unavailable.message,
      };
      if (unavailable.code === 'STORY_BUILD_ASSET_MODERATION_PENDING') {
        throw new ForbiddenException(payload);
      }
      throw new GoneException(payload);
    }
    const source = selectStoryBuildReadSource(frozen.asset, frozen.variant);
    if (!source) {
      throw new GoneException({
        code: 'STORY_BUILD_ASSET_STORAGE_UNAVAILABLE',
        message: 'Build media storage is no longer available.',
      });
    }
    if (source.storageProvider === MediaStorageProvider.external_url) {
      // External media is delivered by its own URL — there is nothing to
      // sign, so access neither expires nor can be revoked. The synthetic
      // expiry only satisfies the delivery contract shape.
      return {
        url: source.externalUrl as string,
        expiresAt: new Date(
          Date.now() + BUILD_MEDIA_READ_URL_TTL_SECONDS * 1_000,
        ).toISOString(),
      };
    }
    const signed = await this.storageAccess.createReadUrl(source, {
      cacheControl: 'private, no-store',
      expiresInSeconds: BUILD_MEDIA_READ_URL_TTL_SECONDS,
    });
    return { url: signed.url, expiresAt: signed.expiresAt };
  }

  async cancelBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    buildId: string,
    input: CancelFilmBuildInput,
  ): Promise<FilmBuildDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.build');
    const current = await this.loadBuild(projectId, buildId);
    if (current.version !== input.expectedBuildVersion) {
      throw buildVersionConflict(input.expectedBuildVersion, current.version);
    }
    if (current.status === StoryBuildStatus.cancelled) {
      return this.toBuildDto(current);
    }
    if (isTerminalBuildStatus(current.status)) {
      throw new ConflictException({
        code: 'STORY_FILM_BUILD_NOT_CANCELLABLE',
        message: 'A terminal Build cannot be cancelled.',
      });
    }
    const updated = await this.prisma.storyBuild.updateMany({
      where: {
        id: buildId,
        storyProjectId: projectId,
        version: input.expectedBuildVersion,
        status: { in: nonTerminalBuildStatuses() },
      },
      data: {
        status: StoryBuildStatus.cancelled,
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const refreshed = await this.loadBuild(projectId, buildId);
      if (refreshed.version !== input.expectedBuildVersion) {
        throw buildVersionConflict(
          input.expectedBuildVersion,
          refreshed.version,
        );
      }
      throw new ConflictException({
        code: 'STORY_FILM_BUILD_NOT_CANCELLABLE',
        message: 'The Build can no longer be cancelled.',
      });
    }
    return this.toBuildDto(await this.loadBuild(projectId, buildId));
  }

  private async processBuild(initial: BuildRow): Promise<BuildRow> {
    if (isTerminalBuildStatus(initial.status)) return initial;
    let build = initial;
    try {
      if (build.status === StoryBuildStatus.queued) {
        build = await this.transitionBuild(build, StoryBuildStatus.validating, {
          startedAt: build.startedAt ?? new Date(),
        });
      }
      if (build.status === StoryBuildStatus.validating) {
        build = await this.transitionBuild(build, StoryBuildStatus.compiling);
      }
      if (build.status !== StoryBuildStatus.compiling) return build;

      const snapshot = await loadCompilationSnapshot(
        this.prisma,
        build.storyProjectId,
        build.sourceRevisionId,
      );
      const currentManifestHash = canonicalJsonHash(
        storyFilmBuildInputManifest(
          {
            revisionId: build.sourceRevisionId,
            expectedProductionRevision: build.sourceProductionRevision,
            profile: build.kind,
            scope: FilmBuildScopeSchema.parse(build.scope),
          },
          snapshot,
        ),
      );
      if (
        snapshot.filmSpec.productionRevision !==
          build.sourceProductionRevision ||
        currentManifestHash !== build.inputManifestHash
      ) {
        return this.failBuild(
          build,
          [
            buildDiagnostic(
              'STORY_BUILD_SOURCE_CHANGED',
              'The production snapshot changed after this Build was submitted. Create a new Build from the current revision.',
              'revision',
              build.sourceRevisionId,
            ),
          ],
          emptyPathReport(),
          'STORY_BUILD_SOURCE_CHANGED',
        );
      }
      const currentInputHash = storyFilmBuildSemanticInputHash(
        {
          revisionId: build.sourceRevisionId,
          expectedProductionRevision: build.sourceProductionRevision,
          profile: build.kind,
          scope: FilmBuildScopeSchema.parse(build.scope),
        },
        snapshot,
        currentManifestHash,
      );
      if (
        build.runtimeSchemaVersion !== EXPERIENCE_RUNTIME_SCHEMA_VERSION ||
        currentInputHash !== build.inputHash
      ) {
        return this.failBuild(
          build,
          [
            buildDiagnostic(
              'STORY_BUILD_COMPILER_CHANGED',
              'The Build compiler changed after this Build was submitted. Create a new Build.',
              'revision',
              build.sourceRevisionId,
            ),
          ],
          emptyPathReport(),
          'STORY_BUILD_COMPILER_CHANGED',
        );
      }

      const filmSpec = FilmSpecSchema.safeParse(snapshot.filmSpec.specJson);
      const draft = createLockableInteractiveFilmDraftContentSchema(
        filmSpec.success ? filmSpec.data.locales.defaultLocale : undefined,
      ).safeParse(snapshot.revision.content);
      const parsingDiagnostics: FilmBuildDiagnosticDto[] = [];
      if (!draft.success) {
        parsingDiagnostics.push(
          ...draft.error.issues.map((issue) =>
            buildDiagnostic(
              'STORY_BUILD_REVISION_CORRUPT',
              `${issue.path.join('.') || 'revision'}: ${issue.message}`,
              'revision',
              build.sourceRevisionId,
            ),
          ),
        );
      }
      if (!filmSpec.success) {
        parsingDiagnostics.push(
          ...filmSpec.error.issues.map((issue) =>
            buildDiagnostic(
              'STORY_BUILD_FILM_SPEC_CORRUPT',
              `${issue.path.join('.') || 'filmSpec'}: ${issue.message}`,
              'revision',
              build.sourceRevisionId,
            ),
          ),
        );
      }
      if (draft.success && filmSpec.success) {
        const authoredLocales = collectInteractiveFilmRuntimeLocales(
          draft.data,
          filmSpec.data.locales.defaultLocale,
        );
        if (
          authoredLocales.length !==
            filmSpec.data.locales.enabledLocales.length ||
          authoredLocales.some(
            (locale, index) =>
              locale !== filmSpec.data.locales.enabledLocales[index],
          )
        ) {
          parsingDiagnostics.push(
            buildDiagnostic(
              'STORY_BUILD_LOCALE_CONTRACT_MISMATCH',
              `Revision runtime locales (${authoredLocales.join(', ')}) do not match the immutable FilmSpec (${filmSpec.data.locales.enabledLocales.join(', ')}).`,
              'revision',
              build.sourceRevisionId,
            ),
          );
        }
      }
      if (
        !draft.success ||
        !filmSpec.success ||
        parsingDiagnostics.length > 0
      ) {
        return this.failBuild(
          build,
          parsingDiagnostics,
          emptyPathReport(),
          'STORY_BUILD_INPUT_CORRUPT',
        );
      }

      const preparedClips = snapshot.clips.map((clip) =>
        this.prepareClip(build, clip),
      );
      let compiled = compileStoryFilmBuild({
        projectId: build.storyProjectId,
        revisionId: build.sourceRevisionId,
        revisionNumber: snapshot.revision.number,
        buildId: build.id,
        profile: build.kind,
        scope: FilmBuildScopeSchema.parse(build.scope),
        draft: draft.data,
        filmSpec: filmSpec.data,
        clips: preparedClips,
      });
      const continuityDiagnostics = storyFilmBuildContinuityDiagnostics(
        snapshot.dependencies,
        preparedClips,
        new Set(compiled.includedClipIds),
      );
      if (continuityDiagnostics.length > 0) {
        compiled = compileStoryFilmBuild({
          projectId: build.storyProjectId,
          revisionId: build.sourceRevisionId,
          revisionNumber: snapshot.revision.number,
          buildId: build.id,
          profile: build.kind,
          scope: FilmBuildScopeSchema.parse(build.scope),
          draft: draft.data,
          filmSpec: filmSpec.data,
          clips: preparedClips,
          diagnostics: continuityDiagnostics,
        });
      }
      if (!compiled.runtime) {
        return this.failBuild(
          build,
          compiled.diagnostics,
          compiled.pathReport,
          compiled.diagnostics[0]?.code ?? 'STORY_BUILD_VALIDATION_FAILED',
        );
      }

      const includedById = new Map(
        preparedClips.map((clip) => [clip.id, clip]),
      );
      const mediaIdentities = compiled.includedClipIds.flatMap((clipId) => {
        const clip = includedById.get(clipId);
        if (!clip?.asset) return [];
        return [
          {
            runtimeAssetId: storyFilmRuntimeAssetId(clip),
            variantId: clip.asset.variantId,
            mediaType: clip.asset.contentType,
          } satisfies StoryExperienceMediaIdentity,
        ];
      });
      const experience = compileStoryExperienceManifest({
        release: compiled.runtime,
        metadata: {
          title: snapshot.project.title,
          summary:
            snapshot.project.summary?.trim() || draft.data.storyBible.logline,
        },
        stateVariables: draft.data.storyBible.stateVariables,
        mediaIdentities,
      });
      if (!experience.manifest) {
        return this.failBuild(
          build,
          [
            ...compiled.diagnostics,
            ...experience.diagnostics.map((item) =>
              buildDiagnostic(
                item.code,
                item.message,
                'revision',
                build.sourceRevisionId,
              ),
            ),
          ],
          compiled.pathReport,
          experience.diagnostics[0]?.code ??
            'STORY_EXPERIENCE_MANIFEST_COMPILATION_FAILED',
        );
      }
      const runtimeHash = canonicalJsonHash(experience.manifest);
      await this.prisma.$transaction(async (tx) => {
        await lockCompilationSnapshot(
          tx,
          build.storyProjectId,
          build.sourceRevisionId,
        );
        const lockedSnapshot = await loadCompilationSnapshot(
          tx,
          build.storyProjectId,
          build.sourceRevisionId,
        );
        const lockedManifestHash = canonicalJsonHash(
          storyFilmBuildInputManifest(
            {
              revisionId: build.sourceRevisionId,
              expectedProductionRevision: build.sourceProductionRevision,
              profile: build.kind,
              scope: FilmBuildScopeSchema.parse(build.scope),
            },
            lockedSnapshot,
          ),
        );
        if (lockedManifestHash !== build.inputManifestHash) {
          throw new BuildSourceChangedError();
        }
        for (const [rank, clipId] of compiled.includedClipIds.entries()) {
          const clip = includedById.get(clipId);
          if (!clip?.spec || !clip.asset) {
            throw new Error(`Compiler admitted an ineligible Clip ${clipId}.`);
          }
          const logicalKey = `clip:${clip.key}:video`;
          const buildAsset = await tx.storyBuildAsset.create({
            data: {
              buildId: build.id,
              storyProjectId: build.storyProjectId,
              logicalKey,
              role: 'video',
              assetId: clip.asset.assetId,
              variantId: clip.asset.variantId,
              checksumSha256: clip.asset.checksumSha256,
              contentType: clip.asset.contentType,
              sizeBytes: clip.asset.sizeBytes,
              width: clip.asset.width,
              height: clip.asset.height,
              durationMs: clip.asset.durationMs,
              rank,
            },
          });
          await tx.storyFilmBuildClip.create({
            data: {
              buildId: build.id,
              storyProjectId: build.storyProjectId,
              revisionId: build.sourceRevisionId,
              clipId: clip.id,
              sourceGenerationAttemptId: clip.sourceGenerationId,
              buildAssetId: buildAsset.id,
              logicalKey,
              clipSpecHash: clip.specHash,
              productionInputHash: clip.productionInputHash,
              checksumSha256: clip.asset.checksumSha256,
              durationMs: clip.asset.durationMs,
              rank,
            },
          });
        }
        const terminal = await tx.storyBuild.updateMany({
          where: {
            id: build.id,
            storyProjectId: build.storyProjectId,
            status: StoryBuildStatus.compiling,
            version: build.version,
          },
          data: {
            status: StoryBuildStatus.ready,
            runtimeJson: experience.manifest as Prisma.InputJsonObject,
            runtimeHash,
            diagnostics:
              compiled.diagnostics as unknown as Prisma.InputJsonArray,
            pathReport:
              compiled.pathReport as unknown as Prisma.InputJsonObject,
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (terminal.count !== 1) {
          throw new ConflictException({
            code: 'STORY_FILM_BUILD_STATE_CONFLICT',
            message: 'The Build state changed while it was compiling.',
          });
        }
      });
      return this.loadBuild(build.storyProjectId, build.id);
    } catch (error) {
      const latest = await this.loadBuild(build.storyProjectId, build.id);
      if (isTerminalBuildStatus(latest.status)) return latest;
      if (error instanceof BuildSourceChangedError) {
        return this.failBuild(
          latest,
          [
            buildDiagnostic(
              'STORY_BUILD_SOURCE_CHANGED',
              'The production snapshot changed while this Build was compiling. Create a new Build from the current revision.',
              'revision',
              latest.sourceRevisionId,
            ),
          ],
          emptyPathReport(),
          'STORY_BUILD_SOURCE_CHANGED',
        );
      }
      return this.failBuild(
        latest,
        [
          buildDiagnostic(
            'STORY_BUILD_COMPILATION_FAILED',
            safeErrorMessage(error),
            'revision',
            latest.sourceRevisionId,
          ),
        ],
        emptyPathReport(),
        'STORY_BUILD_COMPILATION_FAILED',
      );
    }
  }

  private prepareClip(
    build: BuildRow,
    clip: BuildClipRow,
  ): StoryFilmBuildClipInput {
    const diagnostics: FilmBuildDiagnosticDto[] = [];
    const spec = FilmClipSpecSchema.safeParse(clip.specJson);
    if (!spec.success) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CLIP_SPEC_CORRUPT',
          `Clip ${clip.key} has an invalid immutable specification.`,
          'clip',
          clip.id,
        ),
      );
    }
    const hasCurrentAssetId = clip.currentVideoAssetId !== null;
    const hasCurrentVariantId = clip.currentVideoVariantId !== null;
    if (!hasCurrentAssetId && !hasCurrentVariantId) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_MISSING',
          `Clip ${clip.key} has no current video.`,
          'clip',
          clip.id,
        ),
      );
    } else if (!hasCurrentAssetId || !hasCurrentVariantId) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_POINTER_INVALID',
          `Clip ${clip.key} current video asset and variant pointers are incomplete.`,
          'clip',
          clip.id,
        ),
      );
    }
    if (
      (hasCurrentAssetId || hasCurrentVariantId) &&
      (clip.currentVideoRevision < 1 || clip.currentVideoSetAt === null)
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_POINTER_INVALID',
          `Clip ${clip.key} current video selection metadata is incomplete.`,
          'clip',
          clip.id,
        ),
      );
    }
    if (
      hasCurrentAssetId &&
      hasCurrentVariantId &&
      (clip.currentVideoSpecHash !== clip.specHash ||
        clip.currentVideoInputHash !== clip.productionInputHash)
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_OUTDATED',
          `Clip ${clip.key} current video does not match the current production snapshot.`,
          'asset',
          clip.currentVideoAssetId,
        ),
      );
    }

    const rawTechnicalChecks = clip.currentVideoTechnicalChecks;
    const technicalChecks = storyFilmTechnicalCheckDtos(
      rawTechnicalChecks ?? [],
    );
    const technicalCheckKeys = new Set(
      technicalChecks.map((check) => check.key),
    );
    if (
      (hasCurrentAssetId || hasCurrentVariantId) &&
      (!Array.isArray(rawTechnicalChecks) ||
        rawTechnicalChecks.length === 0 ||
        technicalChecks.length !== rawTechnicalChecks.length ||
        REQUIRED_CURRENT_VIDEO_TECHNICAL_CHECK_KEYS.some(
          (key) => !technicalCheckKeys.has(key),
        ) ||
        technicalChecks.some((check) => check.status !== 'passed'))
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_TECHNICAL_CHECKS_FAILED',
          `Clip ${clip.key} current video has incomplete or failed technical checks.`,
          'asset',
          clip.currentVideoAssetId,
        ),
      );
    }

    const asset = clip.currentVideoAsset;
    const variant = clip.currentVideoVariant;
    let frozenAsset: FrozenFilmClipAsset | null = null;
    if ((hasCurrentAssetId || hasCurrentVariantId) && (!asset || !variant)) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_CURRENT_VIDEO_OUTPUT_MISSING',
          `Clip ${clip.key} current video asset or variant is missing.`,
          'asset',
          clip.currentVideoAssetId,
        ),
      );
    } else if (asset && variant) {
      if (
        asset.workspaceId !== build.project.workspaceId ||
        asset.id !== clip.currentVideoAssetId ||
        variant.id !== clip.currentVideoVariantId ||
        variant.assetId !== asset.id
      ) {
        diagnostics.push(
          buildDiagnostic(
            'STORY_BUILD_ASSET_SCOPE_INVALID',
            `Clip ${clip.key} current video does not belong to this Workspace or selected asset.`,
            'asset',
            asset.id,
          ),
        );
      }
      if (
        asset.kind !== MediaAssetKind.video ||
        asset.status !== MediaAssetStatus.ready ||
        asset.deletedAt ||
        variant.status !== MediaAssetVariantStatus.ready ||
        variant.deletedAt
      ) {
        diagnostics.push(
          buildDiagnostic(
            'STORY_BUILD_ASSET_NOT_READY',
            `Clip ${clip.key} current video asset and variant must both be ready video media.`,
            'asset',
            asset.id,
          ),
        );
      }
      diagnostics.push(
        ...storyBuildModerationDiagnostics(
          asset,
          variant,
          requireModerationApproval(),
          `Clip ${clip.key} current video`,
        ),
      );
      const checksum = clip.currentVideoChecksumSha256;
      if (!checksum || variant.checksumSha256 !== checksum) {
        diagnostics.push(
          buildDiagnostic(
            'STORY_BUILD_ASSET_CHECKSUM_INVALID',
            `Clip ${clip.key} current video checksum does not match its selected variant.`,
            'asset',
            asset.id,
          ),
        );
      }
      const width = variant.width ?? asset.width;
      const height = variant.height ?? asset.height;
      const durationSeconds = variant.durationSeconds ?? asset.durationSeconds;
      if (
        !spec.success ||
        width !== spec.data.outputContract.width ||
        height !== spec.data.outputContract.height ||
        durationSeconds === null ||
        Math.abs(
          durationSeconds * 1_000 - spec.data.outputContract.durationMs,
        ) > spec.data.outputContract.durationToleranceMs
      ) {
        diagnostics.push(
          buildDiagnostic(
            'STORY_BUILD_ASSET_OUTPUT_CONTRACT_MISMATCH',
            `Clip ${clip.key} current video dimensions or duration do not satisfy the immutable output contract.`,
            'asset',
            asset.id,
          ),
        );
      }
      const deliverySource = selectStoryBuildReadSource(asset, variant);
      if (!deliverySource) {
        diagnostics.push(
          buildDiagnostic(
            'STORY_BUILD_ASSET_STORAGE_UNAVAILABLE',
            `Clip ${clip.key} current video variant has no active delivery source.`,
            'asset',
            asset.id,
          ),
        );
      }
      // external_url delivery sources are allowed: the delivery endpoint
      // hands back the external URL as-is instead of a signed read URL.
      // Trade-off accepted 2026-07-17: such media is immutable-by-promise
      // only — no expiring access, no takedown lever, and the bytes served
      // can drift from what moderation reviewed.
      const url = storyBuildAssetDeliveryPath(
        build.storyProjectId,
        build.id,
        asset.id,
        variant.id,
      );
      if (
        checksum &&
        width !== null &&
        height !== null &&
        durationSeconds !== null
      ) {
        frozenAsset = {
          assetId: asset.id,
          variantId: variant.id,
          checksumSha256: checksum,
          contentType: variant.contentType || asset.contentType,
          sizeBytes: variant.sizeBytes ?? asset.sizeBytes,
          width,
          height,
          durationMs: durationSeconds * 1_000,
          url,
        };
      }
    }
    return {
      id: clip.id,
      key: clip.key,
      graphNodeId: clip.graphNodeId,
      rank: clip.rank,
      specHash: clip.specHash,
      productionInputHash: clip.productionInputHash,
      spec: spec.success ? spec.data : null,
      sourceGenerationId: clip.currentVideoSourceAttemptId,
      asset: frozenAsset,
      eligibilityDiagnostics: diagnostics,
    };
  }

  private async transitionBuild(
    build: BuildRow,
    status: 'validating' | 'compiling',
    extra: { startedAt?: Date } = {},
  ): Promise<BuildRow> {
    const updated = await this.prisma.storyBuild.updateMany({
      where: { id: build.id, status: build.status, version: build.version },
      data: {
        status,
        ...extra,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      return this.loadBuild(build.storyProjectId, build.id);
    return this.loadBuild(build.storyProjectId, build.id);
  }

  private async failBuild(
    build: BuildRow,
    diagnostics: FilmBuildDiagnosticDto[],
    pathReport: FilmBuildPathReportDto,
    errorCode: string,
  ): Promise<BuildRow> {
    if (isTerminalBuildStatus(build.status)) return build;
    const updated = await this.prisma.storyBuild.updateMany({
      where: {
        id: build.id,
        storyProjectId: build.storyProjectId,
        status: { in: nonTerminalBuildStatuses() },
        version: build.version,
      },
      data: {
        status: StoryBuildStatus.failed,
        diagnostics: diagnostics as unknown as Prisma.InputJsonArray,
        pathReport: pathReport as unknown as Prisma.InputJsonObject,
        errorCode: errorCode.slice(0, 96),
        errorDetail: diagnostics.map((item) => item.message).join('\n'),
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      return this.loadBuild(build.storyProjectId, build.id);
    return this.loadBuild(build.storyProjectId, build.id);
  }

  private async loadBuild(
    projectId: string,
    buildId: string,
  ): Promise<BuildRow> {
    const build = await this.prisma.storyBuild.findFirst({
      where: { id: buildId, storyProjectId: projectId },
      include: BUILD_INCLUDE,
    });
    if (!build) throw buildNotFound();
    return build;
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
    if (scope.project.workspaceId !== workspaceId) throw projectNotFound();
    return scope;
  }

  private toBuildDto(row: BuildRow): FilmBuildDto {
    const scope = FilmBuildScopeSchema.safeParse(row.scope);
    if (!scope.success) {
      throw new ConflictException({
        code: 'STORY_FILM_BUILD_CORRUPT',
        message: 'The stored Build scope is invalid.',
      });
    }
    if (
      row.runtimeSchemaVersion !== 1 &&
      row.runtimeSchemaVersion !== EXPERIENCE_RUNTIME_SCHEMA_VERSION
    ) {
      throw new ConflictException({
        code: 'STORY_FILM_BUILD_CORRUPT',
        message: `The stored Build runtime schema version ${row.runtimeSchemaVersion} is unsupported.`,
      });
    }
    const persistedDiagnostics = parseBuildDiagnostics(row.diagnostics);
    const currentMediaDiagnostics = storyBuildCurrentMediaDiagnostics(
      row.assets,
      requireModerationApproval(),
    );
    const runtimeDeliveryDiagnostics =
      storyBuildRuntimeDeliveryDiagnostics(row);
    const diagnostics = mergeBuildDiagnostics(
      persistedDiagnostics,
      currentMediaDiagnostics,
      runtimeDeliveryDiagnostics,
    );
    return {
      id: row.id,
      projectId: row.storyProjectId,
      revisionId: row.sourceRevisionId,
      number: row.buildNumber,
      version: row.version,
      profile: row.kind,
      scope: scope.data,
      status: row.status,
      sourceProductionRevision: row.sourceProductionRevision,
      inputHash: row.inputHash,
      inputManifestHash: row.inputManifestHash,
      runtimeSchemaVersion: row.runtimeSchemaVersion,
      // The immutable Build remains ready and retains its frozen manifest, but
      // a read must never disclose permanent media URLs after moderation or
      // lifecycle policy makes one of its assets unavailable. This projection
      // is deliberately non-persistent so terminal Build immutability remains
      // intact while takedowns take effect immediately.
      runtimeJson:
        currentMediaDiagnostics.length > 0 ||
        runtimeDeliveryDiagnostics.length > 0
          ? null
          : jsonRecordOrNull(row.runtimeJson),
      runtimeHash: row.runtimeHash,
      assets: row.assets.map(toBuildAssetDto),
      diagnostics,
      pathReport: parsePathReport(row.pathReport),
      publication: row.experiencePublication
        ? {
            status: row.experiencePublication.status,
            gameId: row.experiencePublication.gameId,
            contentVersion: row.experiencePublication.contentVersion,
            manifestUrl: row.experiencePublication.manifestUrl,
            publishedAt:
              row.experiencePublication.publishedAt?.toISOString() ?? null,
            mediaAuthorizedAt:
              row.experiencePublication.mediaAuthorizedAt.toISOString(),
            mediaAuthorizationRevokedAt:
              row.experiencePublication.mediaAuthorizationRevokedAt?.toISOString() ??
              null,
            authorityIsCurrent: row.experiencePublication.authorityIsCurrent,
            authorityGameExists: row.experiencePublication.authorityGameExists,
            authorityCurrentVersion:
              row.experiencePublication.authorityCurrentVersion,
            authorityCheckedAt:
              row.experiencePublication.authorityCheckedAt?.toISOString() ??
              null,
            lastErrorCode: row.experiencePublication.lastErrorCode,
            lastErrorDetail: row.experiencePublication.lastErrorDetail,
          }
        : null,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private toBuildSummaryDto(row: BuildRow): FilmBuildSummaryDto {
    const dto = this.toBuildDto(row);
    return {
      id: dto.id,
      number: dto.number,
      profile: dto.profile,
      scope: dto.scope,
      status: dto.status,
      sourceProductionRevision: dto.sourceProductionRevision,
      diagnostics: dto.diagnostics,
      publication: dto.publication,
      createdAt: dto.createdAt,
      completedAt: dto.completedAt,
    };
  }
}

async function loadCompilationSnapshot(
  prisma: PrismaService | Prisma.TransactionClient,
  projectId: string,
  revisionId: string,
): Promise<CompilationSnapshot> {
  const [project, revision, filmSpec, clips, dependencies] = await Promise.all([
    prisma.storyProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        summary: true,
        defaultLocale: true,
      },
    }),
    prisma.storyRevision.findFirst({
      where: { id: revisionId, storyProjectId: projectId },
      select: { id: true, number: true, content: true, contentHash: true },
    }),
    prisma.storyFilmSpec.findFirst({
      where: { revisionId, storyProjectId: projectId },
      select: {
        specJson: true,
        specHash: true,
        productionRevision: true,
      },
    }),
    prisma.storyFilmClip.findMany({
      where: { revisionId, storyProjectId: projectId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      include: BUILD_CLIP_INCLUDE,
    }),
    prisma.storyFilmClipDependency.findMany({
      where: { revisionId, storyProjectId: projectId },
      orderBy: [{ id: 'asc' }],
      include: BUILD_DEPENDENCY_INCLUDE,
    }),
  ]);
  if (!project) {
    throw new NotFoundException({
      code: 'STORY_PROJECT_NOT_FOUND',
      message: 'Story project not found.',
    });
  }
  if (!revision) {
    throw new NotFoundException({
      code: 'STORY_REVISION_NOT_FOUND',
      message: 'Story revision not found.',
    });
  }
  if (!filmSpec) {
    throw new UnprocessableEntityException({
      code: 'STORY_REVISION_NOT_PRODUCTION_READY',
      message: 'This revision has no immutable interactive-film specification.',
    });
  }
  return { project, revision, filmSpec, clips, dependencies };
}

/** Lock every mutable row class that contributes to eligibility or runtime
 * media identity. The final manifest hash is checked only after these locks
 * are held, and the frozen asset rows plus ready transition commit in the same
 * transaction. */
async function lockCompilationSnapshot(
  tx: Prisma.TransactionClient,
  projectId: string,
  revisionId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "story_projects"
    WHERE "id" = ${projectId}::uuid
    FOR SHARE
  `;
  await tx.$queryRaw`
    SELECT "id" FROM "story_revisions"
    WHERE "story_project_id" = ${projectId}::uuid
      AND "id" = ${revisionId}::uuid
    FOR SHARE
  `;
  await tx.$queryRaw`
    SELECT "revision_id" FROM "story_film_specs"
    WHERE "story_project_id" = ${projectId}::uuid
      AND "revision_id" = ${revisionId}::uuid
    FOR SHARE
  `;
  await tx.$queryRaw`
    SELECT "id" FROM "story_film_clips"
    WHERE "story_project_id" = ${projectId}::uuid
      AND "revision_id" = ${revisionId}::uuid
      AND "archived_at" IS NULL
    FOR SHARE
  `;
  await tx.$queryRaw`
    SELECT a."id"
    FROM "media_assets" a
    JOIN "story_film_clips" c ON c."current_video_asset_id" = a."id"
    WHERE c."story_project_id" = ${projectId}::uuid
      AND c."revision_id" = ${revisionId}::uuid
      AND c."archived_at" IS NULL
    FOR SHARE OF a
  `;
  await tx.$queryRaw`
    SELECT v."id"
    FROM "media_asset_variants" v
    JOIN "story_film_clips" c ON c."current_video_variant_id" = v."id"
    WHERE c."story_project_id" = ${projectId}::uuid
      AND c."revision_id" = ${revisionId}::uuid
      AND c."archived_at" IS NULL
    FOR SHARE OF v
  `;
  await tx.$queryRaw`
    SELECT p."id"
    FROM "media_object_placements" p
    JOIN "story_film_clips" c
      ON p."asset_id" = c."current_video_asset_id"
     AND (
       p."variant_id" IS NULL
       OR p."variant_id" = c."current_video_variant_id"
     )
    WHERE c."story_project_id" = ${projectId}::uuid
      AND c."revision_id" = ${revisionId}::uuid
      AND c."archived_at" IS NULL
    FOR SHARE OF p
  `;
  await tx.$queryRaw`
    SELECT d."id"
    FROM "story_film_clip_dependencies" d
    WHERE d."story_project_id" = ${projectId}::uuid
      AND d."revision_id" = ${revisionId}::uuid
    FOR SHARE OF d
  `;
  await tx.$queryRaw`
    SELECT cc."id"
    FROM "story_film_continuity_checks" cc
    WHERE cc."story_project_id" = ${projectId}::uuid
      AND cc."revision_id" = ${revisionId}::uuid
    FOR SHARE OF cc
  `;
}

export function storyFilmBuildInputManifest(
  input: CreateFilmBuildInput,
  snapshot: CompilationSnapshot,
): Record<string, unknown> {
  return {
    schemaVersion: 2,
    profile: input.profile,
    scope: input.scope,
    project: {
      id: snapshot.project.id,
      title: snapshot.project.title,
      summary: snapshot.project.summary,
      defaultLocale: snapshot.project.defaultLocale,
    },
    revision: {
      id: snapshot.revision.id,
      number: snapshot.revision.number,
      contentHash: snapshot.revision.contentHash,
    },
    filmSpec: {
      specHash: snapshot.filmSpec.specHash,
      productionRevision: snapshot.filmSpec.productionRevision,
    },
    clips: snapshot.clips.map((clip) => ({
      id: clip.id,
      key: clip.key,
      graphNodeId: clip.graphNodeId,
      rank: clip.rank,
      specHash: clip.specHash,
      productionInputHash: clip.productionInputHash,
      currentVideo: {
        revision: clip.currentVideoRevision,
        assetId: clip.currentVideoAssetId,
        variantId: clip.currentVideoVariantId,
        sourceGenerationAttemptId: clip.currentVideoSourceAttemptId,
        specHash: clip.currentVideoSpecHash,
        inputHash: clip.currentVideoInputHash,
        checksumSha256: clip.currentVideoChecksumSha256,
        technicalChecks: clip.currentVideoTechnicalChecks,
        setByUserId: clip.currentVideoSetByUserId,
        setAt: clip.currentVideoSetAt?.toISOString() ?? null,
        asset: clip.currentVideoAsset
          ? mediaAssetManifest(clip.currentVideoAsset)
          : null,
        variant: clip.currentVideoVariant
          ? mediaVariantManifest(clip.currentVideoVariant)
          : null,
      },
    })),
    dependencies: snapshot.dependencies.map((dependency) => ({
      id: dependency.id,
      kind: dependency.kind,
      predecessorClipId: dependency.predecessorClipId,
      successorClipId: dependency.successorClipId,
      continuityChecks: dependency.continuityChecks.map((check) => ({
        id: check.id,
        upstreamAssetId: check.upstreamAssetId,
        upstreamVariantId: check.upstreamVariantId,
        upstreamChecksumSha256: check.upstreamChecksumSha256,
        downstreamAssetId: check.downstreamAssetId,
        downstreamVariantId: check.downstreamVariantId,
        downstreamChecksumSha256: check.downstreamChecksumSha256,
        decision: check.decision,
      })),
    })),
  };
}

function storyFilmBuildSemanticInputHash(
  input: CreateFilmBuildInput,
  snapshot: CompilationSnapshot,
  inputManifestHash: string,
): string {
  return canonicalJsonHash({
    compilerSemanticVersion: STORY_FILM_BUILD_COMPILER_SEMANTIC_VERSION,
    runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
    request: input,
    revisionContentHash: snapshot.revision.contentHash,
    filmSpecHash: snapshot.filmSpec.specHash,
    productionRevision: snapshot.filmSpec.productionRevision,
    inputManifestHash,
  });
}

function mediaAssetManifest(
  asset: NonNullable<BuildClipRow['currentVideoAsset']>,
): Record<string, unknown> {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    kind: asset.kind,
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes?.toString() ?? null,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    checksumSha256: asset.checksumSha256,
    visibility: asset.visibility,
    status: asset.status,
    moderationStatus: asset.moderationStatus,
    deletedAt: asset.deletedAt?.toISOString() ?? null,
    placements: placementManifest(asset.placements),
  };
}

function mediaVariantManifest(
  variant: NonNullable<BuildClipRow['currentVideoVariant']>,
): Record<string, unknown> {
  return {
    id: variant.id,
    assetId: variant.assetId,
    variantKey: variant.variantKey,
    kind: variant.kind,
    status: variant.status,
    contentType: variant.contentType,
    sizeBytes: variant.sizeBytes?.toString() ?? null,
    width: variant.width,
    height: variant.height,
    durationSeconds: variant.durationSeconds,
    checksumSha256: variant.checksumSha256,
    deletedAt: variant.deletedAt?.toISOString() ?? null,
    placements: placementManifest(variant.placements),
  };
}

function placementManifest(
  placements: Array<{
    id: string;
    role: string;
    status: string;
    storageProvider: string;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
    publicBaseUrl: string | null;
    priority: number;
    deletedAt: Date | null;
  }>,
): Record<string, unknown>[] {
  return [...placements]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((placement) => ({
      id: placement.id,
      role: placement.role,
      status: placement.status,
      storageProvider: placement.storageProvider,
      bucket: placement.bucket,
      region: placement.region,
      objectKey: placement.objectKey,
      externalUrl: placement.externalUrl,
      publicBaseUrl: placement.publicBaseUrl,
      priority: placement.priority,
      deletedAt: placement.deletedAt?.toISOString() ?? null,
    }));
}

export function storyFilmBuildContinuityDiagnostics(
  dependencies: BuildDependencyRow[],
  clips: StoryFilmBuildClipInput[],
  includedClipIds: Set<string>,
): FilmBuildDiagnosticDto[] {
  const currentVideoByClipId = new Map(
    clips.map((clip) => [clip.id, clip.asset]),
  );
  return dependencies.flatMap((dependency) => {
    if (
      !includedClipIds.has(dependency.predecessorClipId) ||
      !includedClipIds.has(dependency.successorClipId) ||
      (dependency.kind !== StoryFilmDependencyKind.continuity &&
        dependency.kind !== StoryFilmDependencyKind.convergence)
    ) {
      return [];
    }
    const upstream = currentVideoByClipId.get(dependency.predecessorClipId);
    const downstream = currentVideoByClipId.get(dependency.successorClipId);
    // Missing or ineligible current videos already carry actionable Clip-level
    // diagnostics. Reporting continuity before both concrete media identities
    // exist would only multiply secondary errors.
    if (!upstream || !downstream) return [];
    const passed = dependency.continuityChecks.some(
      (check) =>
        check.upstreamAssetId === upstream.assetId &&
        check.upstreamVariantId === upstream.variantId &&
        check.upstreamChecksumSha256 === upstream.checksumSha256 &&
        check.downstreamAssetId === downstream.assetId &&
        check.downstreamVariantId === downstream.variantId &&
        check.downstreamChecksumSha256 === downstream.checksumSha256 &&
        (check.decision === StoryFilmContinuityDecision.pass ||
          check.decision === StoryFilmContinuityDecision.waived),
    );
    return passed
      ? []
      : [
          buildDiagnostic(
            'STORY_BUILD_CONTINUITY_CHECK_MISSING',
            'The selected current videos do not have a passing continuity check for a required transition.',
            'clip',
            dependency.successorClipId,
          ),
        ];
  });
}

export function storyBuildRequestFingerprint(
  input: CreateFilmBuildInput,
): string {
  return canonicalJsonHash(input);
}

function storyBuildSubmissionKey(
  userId: string,
  projectId: string,
  idempotencyKey: string,
): string {
  return `${userId}:${projectId}:${canonicalJsonHash(idempotencyKey)}`;
}

function assertBuildReplay(
  build: { requestFingerprint: string },
  requestFingerprint: string,
): void {
  if (build.requestFingerprint === requestFingerprint) return;
  throw new ConflictException({
    code: 'STORY_FILM_BUILD_IDEMPOTENCY_CONFLICT',
    message: 'Idempotency-Key was already used with another Build request.',
  });
}

function toBuildAssetDto(row: BuildRow['assets'][number]): FilmBuildAssetDto {
  return {
    id: row.id,
    buildId: row.buildId,
    clipId: row.filmClip?.clipId ?? null,
    logicalKey: row.logicalKey,
    role: row.role,
    assetId: row.assetId,
    variantId: row.variantId,
    checksumSha256: row.checksumSha256,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sizeBytes: row.sizeBytes?.toString() ?? null,
  };
}

export function storyBuildAssetDeliveryPath(
  projectId: string,
  buildId: string,
  assetId: string,
  variantId: string,
): string {
  return `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}/assets/${encodeURIComponent(assetId)}/variants/${encodeURIComponent(variantId)}/content`;
}

interface CurrentBuildMediaRow {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string;
  asset: {
    id: string;
    status: MediaAssetStatus;
    moderationStatus: MediaAssetModerationStatus;
    deletedAt: Date | null;
  };
  variant: {
    id: string;
    assetId: string;
    status: MediaAssetVariantStatus;
    checksumSha256: string | null;
    deletedAt: Date | null;
  };
}

type StoryBuildStorageAsset = Pick<
  BuildDeliveryAssetRow['asset'],
  | 'storageProvider'
  | 'bucket'
  | 'region'
  | 'objectKey'
  | 'externalUrl'
  | 'contentType'
  | 'placements'
>;
type StoryBuildStorageVariant = Pick<
  BuildDeliveryAssetRow['variant'],
  'variantKey' | 'contentType' | 'placements'
>;

function selectStoryBuildReadSource(
  asset: StoryBuildStorageAsset,
  variant: StoryBuildStorageVariant,
): MediaStorageReadRef | null {
  const variantPlacement = pickActiveBuildPlacement(variant.placements);
  if (variantPlacement) {
    return buildPlacementReadRef(
      variantPlacement,
      variant.contentType || asset.contentType,
    );
  }
  if (variant.variantKey !== 'original') return null;
  const assetPlacement = pickActiveBuildPlacement(asset.placements);
  if (assetPlacement) {
    return buildPlacementReadRef(assetPlacement, asset.contentType);
  }
  const base: MediaStorageReadRef = {
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: variant.contentType || asset.contentType,
  };
  return isCompleteBuildReadRef(base) ? base : null;
}

function pickActiveBuildPlacement<
  T extends {
    id: string;
    status: MediaObjectPlacementStatus;
    priority: number;
    deletedAt: Date | null;
    storageProvider: MediaStorageProvider;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
  },
>(placements: T[]): T | null {
  return (
    [...placements]
      .filter(
        (placement) =>
          placement.status === MediaObjectPlacementStatus.active &&
          placement.deletedAt === null &&
          isCompleteBuildReadRef(placement),
      )
      .sort(
        (left, right) =>
          left.priority - right.priority || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

function buildPlacementReadRef(
  placement: {
    storageProvider: MediaStorageProvider;
    bucket: string | null;
    region: string | null;
    objectKey: string | null;
    externalUrl: string | null;
  },
  contentType: string,
): MediaStorageReadRef {
  return { ...placement, contentType };
}

function isCompleteBuildReadRef(ref: {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  objectKey: string | null;
  externalUrl: string | null;
}): boolean {
  return ref.storageProvider === MediaStorageProvider.external_url
    ? Boolean(ref.externalUrl)
    : Boolean(ref.bucket && ref.objectKey);
}

export function storyBuildModerationDiagnostics(
  asset: {
    id: string;
    moderationStatus: MediaAssetModerationStatus;
  },
  variant: { status: MediaAssetVariantStatus },
  moderationApprovalRequired: boolean,
  label: string,
): FilmBuildDiagnosticDto[] {
  if (
    asset.moderationStatus === MediaAssetModerationStatus.blocked ||
    variant.status === MediaAssetVariantStatus.blocked
  ) {
    return [
      buildDiagnostic(
        'STORY_BUILD_ASSET_MODERATION_BLOCKED',
        `${label} is moderation-blocked.`,
        'asset',
        asset.id,
      ),
    ];
  }
  // A Build runtime is a shared project artifact. Even when the person
  // submitting it owns the media, its permanent URLs would immediately become
  // visible to every story reader; therefore Build compilation deliberately
  // applies the policy's peer/broadcast side rather than its owner exception.
  if (
    moderationApprovalRequired &&
    asset.moderationStatus !== MediaAssetModerationStatus.approved
  ) {
    return [
      buildDiagnostic(
        'STORY_BUILD_ASSET_MODERATION_PENDING',
        `${label} is awaiting moderation approval required for shared playback.`,
        'asset',
        asset.id,
      ),
    ];
  }
  return [];
}

function storyBuildCurrentMediaDiagnostics(
  assets: CurrentBuildMediaRow[],
  moderationApprovalRequired: boolean,
): FilmBuildDiagnosticDto[] {
  return assets.flatMap((frozen) => {
    const label = `Build asset ${frozen.logicalKey}`;
    const moderation = storyBuildModerationDiagnostics(
      frozen.asset,
      frozen.variant,
      moderationApprovalRequired,
      label,
    );
    if (
      moderation.some(
        (item) => item.code === 'STORY_BUILD_ASSET_MODERATION_BLOCKED',
      )
    ) {
      return moderation;
    }
    if (
      frozen.asset.status === MediaAssetStatus.deleted ||
      frozen.asset.deletedAt !== null ||
      frozen.variant.status === MediaAssetVariantStatus.deleted ||
      frozen.variant.deletedAt !== null
    ) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_UNAVAILABLE',
          `${label} has been deleted and is no longer available for playback.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    if (
      frozen.asset.status !== MediaAssetStatus.ready ||
      frozen.variant.status !== MediaAssetVariantStatus.ready ||
      frozen.variant.assetId !== frozen.assetId
    ) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_NOT_READY',
          `${label} is no longer a ready media asset and variant.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    if (moderation.length > 0) return moderation;
    if (frozen.variant.checksumSha256 !== frozen.checksumSha256) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_INTEGRITY_CHANGED',
          `${label} no longer matches the checksum frozen by this Build.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    return [];
  });
}

function storyBuildRuntimeDeliveryDiagnostics(
  build: BuildRow,
): FilmBuildDiagnosticDto[] {
  const runtime = jsonRecordOrNull(build.runtimeJson);
  if (!runtime) return [];
  const allowedSources = new Set(
    build.assets.map((asset) =>
      storyBuildAssetDeliveryPath(
        build.storyProjectId,
        build.id,
        asset.assetId,
        asset.variantId,
      ),
    ),
  );
  const sources = runtimeDeliverySources(runtime, build.runtimeSchemaVersion);
  if (
    sources.length === build.assets.length &&
    sources.every((source) => allowedSources.has(source))
  ) {
    return [];
  }
  return [
    buildDiagnostic(
      'STORY_BUILD_RUNTIME_DELIVERY_UNSAFE',
      'This Build runtime predates authenticated Build media delivery and cannot be exposed. Create a new Build.',
      'revision',
      build.sourceRevisionId,
    ),
  ];
}

function runtimeDeliverySources(
  runtime: Record<string, unknown>,
  schemaVersion: number,
): string[] {
  if (schemaVersion === EXPERIENCE_RUNTIME_SCHEMA_VERSION) {
    const assets = Array.isArray(runtime.assets) ? runtime.assets : [];
    return assets.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return [];
      const asset = entry as Record<string, unknown>;
      if (asset.kind !== 'video' && asset.kind !== 'image') return [];
      if (!Array.isArray(asset.variants)) return [];
      return asset.variants.flatMap((variant) => {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
          return [];
        }
        const uri = (variant as Record<string, unknown>).uri;
        return typeof uri === 'string' ? [uri] : [];
      });
    });
  }
  const media = Array.isArray(runtime.media) ? runtime.media : [];
  return media.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const variants = (entry as Record<string, unknown>).variants;
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
      return [];
    }
    return Object.values(variants as Record<string, unknown>).flatMap(
      (variant) => {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
          return [];
        }
        const src = (variant as Record<string, unknown>).src;
        return typeof src === 'string' ? [src] : [];
      },
    );
  });
}

function mergeBuildDiagnostics(
  ...groups: FilmBuildDiagnosticDto[][]
): FilmBuildDiagnosticDto[] {
  const merged = new Map<string, FilmBuildDiagnosticDto>();
  groups.flat().forEach((diagnostic) => {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.entityType ?? '',
      diagnostic.entityId ?? '',
      diagnostic.message,
    ].join('\u0000');
    if (!merged.has(key)) merged.set(key, diagnostic);
  });
  return [...merged.values()];
}

function parseBuildDiagnostics(
  value: Prisma.JsonValue,
): FilmBuildDiagnosticDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      return [];
    const row = candidate as Record<string, unknown>;
    if (
      (row.severity !== 'error' && row.severity !== 'warning') ||
      typeof row.code !== 'string' ||
      typeof row.message !== 'string'
    ) {
      return [];
    }
    return [
      {
        severity: row.severity,
        code: row.code,
        message: row.message,
        entityType:
          row.entityType === null || typeof row.entityType === 'string'
            ? (row.entityType as FilmBuildDiagnosticDto['entityType'])
            : null,
        entityId:
          row.entityId === null || typeof row.entityId === 'string'
            ? row.entityId
            : null,
      },
    ];
  });
}

function parsePathReport(
  value: Prisma.JsonValue,
): FilmBuildPathReportDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.enumeratedPathCount !== 'number' ||
    !Array.isArray(row.reachableEndingIds) ||
    !Array.isArray(row.unreachableNodeIds) ||
    typeof row.ambiguousPathCount !== 'number' ||
    typeof row.durationMinMs !== 'number' ||
    typeof row.durationMaxMs !== 'number'
  ) {
    return null;
  }
  return {
    enumeratedPathCount: row.enumeratedPathCount,
    reachableEndingIds: row.reachableEndingIds.filter(
      (item): item is string => typeof item === 'string',
    ),
    unreachableNodeIds: row.unreachableNodeIds.filter(
      (item): item is string => typeof item === 'string',
    ),
    ambiguousPathCount: row.ambiguousPathCount,
    durationMinMs: row.durationMinMs,
    durationMaxMs: row.durationMaxMs,
  };
}

function jsonRecordOrNull(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildDiagnostic(
  code: string,
  message: string,
  entityType: FilmBuildDiagnosticDto['entityType'],
  entityId: string | null,
): FilmBuildDiagnosticDto {
  return { severity: 'error', code, message, entityType, entityId };
}

function emptyPathReport(): FilmBuildPathReportDto {
  return {
    enumeratedPathCount: 0,
    reachableEndingIds: [],
    unreachableNodeIds: [],
    ambiguousPathCount: 0,
    durationMinMs: 0,
    durationMaxMs: 0,
  };
}

function isTerminalBuildStatus(status: StoryBuildStatus): boolean {
  return (
    status === StoryBuildStatus.ready ||
    status === StoryBuildStatus.failed ||
    status === StoryBuildStatus.cancelled
  );
}

function nonTerminalBuildStatuses(): StoryBuildStatus[] {
  return [
    StoryBuildStatus.queued,
    StoryBuildStatus.validating,
    StoryBuildStatus.compiling,
  ];
}

function semanticReplayBuildStatuses(): StoryBuildStatus[] {
  return [...nonTerminalBuildStatuses(), StoryBuildStatus.ready];
}

function projectNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PROJECT_NOT_FOUND',
    message: 'Story project not found.',
  });
}

function buildNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_FILM_BUILD_NOT_FOUND',
    message: 'Story film Build not found.',
  });
}

function productionRevisionConflict(
  expectedRevision: number,
  actualRevision: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_FILM_PRODUCTION_REVISION_CONFLICT',
    message: 'The film production plan changed. Refresh and try again.',
    expectedRevision,
    actualRevision,
  });
}

function buildVersionConflict(
  expectedVersion: number,
  actualVersion: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_FILM_BUILD_VERSION_CONFLICT',
    message: 'The Build changed. Refresh and try again.',
    expectedVersion,
    actualVersion,
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 4_000);
  }
  return 'The Build compiler failed unexpectedly.';
}

class BuildSourceChangedError extends Error {
  constructor() {
    super('The Build source snapshot changed during compilation.');
    this.name = 'BuildSourceChangedError';
  }
}

function encodeBuildCursor(value: BuildCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeBuildCursor(value: string): BuildCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      parsed &&
      typeof parsed === 'object' &&
      Number.isInteger((parsed as BuildCursor).number) &&
      typeof (parsed as BuildCursor).id === 'string'
    ) {
      return parsed as BuildCursor;
    }
  } catch {
    // Converted into the stable API error below.
  }
  throw new BadRequestException({
    code: 'STORY_CURSOR_INVALID',
    message: 'The pagination cursor is invalid or expired.',
  });
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
