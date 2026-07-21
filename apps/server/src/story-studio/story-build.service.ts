import { randomUUID } from 'node:crypto';
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
  StoryAssetRole,
  StoryBuildKind,
  StoryBuildStatus,
  StoryRevisionSource,
  StoryVideoTargetKind,
} from '@prisma/client';
import {
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  MediaStorageAccessService,
  type MediaStorageReadRef,
} from '../infra/storage/media-storage-access.service';
import { requireModerationApproval } from '../media/media-moderation-policy';
import { canonicalJsonHash } from './canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  StoryBuildScopeSchema,
  createLockableInteractiveStoryDraftContentSchema,
  type CancelStoryBuildInput,
  type CreateStoryBuildInput,
  type CursorPageDto,
  type StoryBuildAssetDto,
  type StoryBuildDiagnosticDto,
  type StoryBuildDto,
  type StoryBuildListQuery,
  type StoryBuildPathReportDto,
  type StoryBuildSummaryDto,
  type CreatableStoryFormat,
  type StoryFrameProfile,
  type InteractiveStoryDraftContent,
} from './dto';
import {
  compileStoryBuild,
  storyRuntimeAssetId,
  type FrozenStoryVideoAsset,
  type StoryBuildVideoInput,
} from './story-build-compiler';
import { resolveStoryMusicUrls } from './story-music-media';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import {
  StoryVideoSnapshotEntrySchema,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const BUILD_INCLUDE = Prisma.validator<Prisma.StoryBuildInclude>()({
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
      videoClip: { select: { graphNodeId: true } },
      asset: {
        select: {
          id: true,
          kind: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
          sizeBytes: true,
        },
      },
      variant: {
        select: {
          id: true,
          assetId: true,
          variantKey: true,
          status: true,
          checksumSha256: true,
          contentType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationMs: true,
          metadata: true,
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
        runtimeSchemaVersion: true,
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

const BUILD_SELECTION_INCLUDE =
  Prisma.validator<Prisma.StoryVideoSelectionInclude>()({
    currentAsset: { include: { placements: true } },
    currentVariant: { include: { placements: true } },
  });
type BuildSelectionRow = Prisma.StoryVideoSelectionGetPayload<{
  include: typeof BUILD_SELECTION_INCLUDE;
}>;

function isCreatableStoryFormat(
  format: string,
): format is CreatableStoryFormat {
  return format === 'interactive_film' || format === 'text_adventure';
}

const BUILD_MEDIA_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_USER_READ_URL_TTL_SECONDS,
  5 * 60,
);
const STORY_BUILD_COMPILER_SEMANTIC_VERSION = 4;

interface BuildCursor {
  number: number;
  id: string;
}

interface ValidatedBuildSnapshot {
  project: {
    id: string;
    workspaceId: string;
    title: string;
    summary: string | null;
    format: CreatableStoryFormat;
    defaultLocale: string;
    frameProfile: StoryFrameProfile | null;
  };
  draft: {
    revision: number;
    contentHash: string;
    content: InteractiveStoryDraftContent;
  };
  videoSnapshotHash: string;
  entries: StoryVideoSnapshotEntry[];
  videos: StoryBuildVideoInput[];
  /** Plain public URL per bound music asset; a missing entry is silence. */
  musicUrls: Map<string, string>;
}

@Injectable()
export class StoryBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly storageAccess: MediaStorageAccessService,
    private readonly writeGuard: StoryProjectWriteGuardService,
  ) {}

  async createBuild(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: CreateStoryBuildInput,
    idempotencyKey: string,
  ): Promise<StoryBuildDto> {
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
      return this.toBuildDto(replay);
    }

    const buildId = randomUUID();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const row = await this.prisma.$transaction(
          async (tx) => {
            await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
            const concurrent = await tx.storyBuild.findUnique({
              where: { submissionKey },
              include: BUILD_INCLUDE,
            });
            if (concurrent) {
              assertBuildReplay(concurrent, requestFingerprint);
              return concurrent;
            }

            const snapshot = await loadValidatedBuildSnapshot(
              tx,
              workspaceId,
              projectId,
              input,
              buildId,
            );
            const revision = await materializeStoryRevision(
              tx,
              snapshot,
              user.userId,
            );
            const numbered = await tx.storyProject.update({
              where: { id: projectId },
              data: { nextBuildNumber: { increment: 1 } },
              select: { nextBuildNumber: true },
            });
            const buildNumber = numbered.nextBuildNumber - 1;
            const kind =
              input.scope.kind === 'full'
                ? StoryBuildKind.production
                : StoryBuildKind.preview;
            const inputManifest = storyBuildInputManifest(
              input,
              snapshot,
              revision.id,
            );
            const inputManifestHash = canonicalJsonHash(inputManifest);
            const inputHash = canonicalJsonHash({
              compilerSemanticVersion: STORY_BUILD_COMPILER_SEMANTIC_VERSION,
              runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
              inputManifestHash,
            });
            const compilation = compileStoryBuild({
              projectId,
              format: snapshot.project.format,
              buildId,
              sourceDraftRevision: snapshot.draft.revision,
              channel:
                kind === StoryBuildKind.production ? 'production' : 'preview',
              scope: input.scope,
              frameProfile: snapshot.project.frameProfile,
              defaultLocale: snapshot.project.defaultLocale,
              metadata: {
                title: snapshot.project.title,
                summary: snapshot.project.summary,
              },
              draft: snapshot.draft.content,
              videos: snapshot.videos,
              musicUrls: snapshot.musicUrls,
            });
            if (
              !compilation.runtime &&
              !compilation.diagnostics.some(
                (diagnostic) => diagnostic.severity === 'error',
              )
            ) {
              compilation.diagnostics.push(
                buildDiagnostic(
                  'STORY_BUILD_RUNTIME_MISSING',
                  'The compiler produced no Runtime Manifest v2.',
                  'revision',
                  String(snapshot.draft.revision),
                ),
              );
            }
            const firstError = compilation.diagnostics.find(
              (diagnostic) => diagnostic.severity === 'error',
            );
            const ready = !firstError && compilation.runtime !== null;
            const now = new Date();
            await tx.storyBuild.create({
              data: {
                id: buildId,
                storyProjectId: projectId,
                sourceRevisionId: revision.id,
                buildNumber,
                submissionKey,
                requestFingerprint,
                kind,
                scope: input.scope as Prisma.InputJsonObject,
                sourceDraftRevision: snapshot.draft.revision,
                videoSnapshotHash: snapshot.videoSnapshotHash,
                // Frozen child rows are inserted only while the parent is
                // mutable. The database validates the complete freeze on the
                // final compiling -> ready transition.
                status: StoryBuildStatus.compiling,
                inputHash,
                inputManifestHash,
                runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
                runtimeJson: ready
                  ? (compilation.runtime as unknown as Prisma.InputJsonObject)
                  : Prisma.JsonNull,
                runtimeHash: ready
                  ? canonicalJsonHash(compilation.runtime)
                  : null,
                diagnostics:
                  compilation.diagnostics as unknown as Prisma.InputJsonArray,
                pathReport:
                  compilation.pathReport as unknown as Prisma.InputJsonObject,
                errorCode: firstError?.code.slice(0, 96) ?? null,
                errorDetail: firstError
                  ? compilation.diagnostics
                      .filter((diagnostic) => diagnostic.severity === 'error')
                      .map((diagnostic) => diagnostic.message)
                      .join('\n')
                      .slice(0, 20_000)
                  : null,
                createdByUserId: user.userId,
                startedAt: now,
              },
            });

            if (ready) {
              const videoByNodeId = new Map(
                snapshot.videos.map((video) => [video.graphNodeId, video]),
              );
              const clipByNodeId = new Map(
                snapshot.draft.content.graph.nodes.flatMap((node, index) =>
                  node.kind === 'clip'
                    ? [[node.nodeId, { node, rank: index }] as const]
                    : [],
                ),
              );
              for (const graphNodeId of compilation.includedGraphNodeIds) {
                const source = videoByNodeId.get(graphNodeId);
                const clip = clipByNodeId.get(graphNodeId);
                if (!source?.asset || !clip) {
                  throw new Error(
                    `Compiler included unfrozen graph video ${graphNodeId}.`,
                  );
                }
                const buildAsset = await tx.storyBuildAsset.create({
                  data: {
                    buildId,
                    storyProjectId: projectId,
                    logicalKey: storyRuntimeAssetId(clip.node.clipKey),
                    role: StoryAssetRole.video,
                    assetId: source.asset.assetId,
                    variantId: source.asset.variantId,
                    checksumSha256: source.asset.checksumSha256,
                    contentType: source.asset.contentType,
                    sizeBytes: source.asset.sizeBytes,
                    width: source.asset.width,
                    height: source.asset.height,
                    durationMs: source.asset.durationMs,
                    browserSafeMp4: source.asset.browserSafeMp4,
                    rank: clip.rank,
                  },
                });
                await tx.storyVideoBuildClip.create({
                  data: {
                    buildId,
                    storyProjectId: projectId,
                    graphNodeId,
                    sourceGenerationAttemptId: source.sourceGenerationId,
                    buildAssetId: buildAsset.id,
                    logicalKey: buildAsset.logicalKey,
                    checksumSha256: source.asset.checksumSha256,
                    contentType: source.asset.contentType,
                    durationMs: source.asset.durationMs,
                    width: source.asset.width,
                    height: source.asset.height,
                    browserSafeMp4: source.asset.browserSafeMp4,
                    rank: clip.rank,
                  },
                });
              }
            }

            await tx.storyBuild.update({
              where: { id: buildId },
              data: {
                status: ready
                  ? StoryBuildStatus.ready
                  : StoryBuildStatus.failed,
                completedAt: now,
                version: { increment: 1 },
              },
            });

            const created = await tx.storyBuild.findUnique({
              where: { id: buildId },
              include: BUILD_INCLUDE,
            });
            if (!created) throw new Error('Created Build disappeared.');
            return created;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return this.toBuildDto(row);
      } catch (error) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        if (isUniqueConstraintError(error)) {
          const winner = await this.prisma.storyBuild.findUnique({
            where: { submissionKey },
            include: BUILD_INCLUDE,
          });
          if (winner) {
            assertBuildReplay(winner, requestFingerprint);
            return this.toBuildDto(winner);
          }
          if (attempt < 2) continue;
        }
        throw error;
      }
    }
    throw new ConflictException({
      code: 'STORY_BUILD_SERIALIZATION_CONFLICT',
      message: 'The story changed while creating the Build. Retry the request.',
    });
  }

  async listBuilds(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    query: StoryBuildListQuery,
  ): Promise<CursorPageDto<StoryBuildSummaryDto>> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.read');
    const cursor = query.cursor ? decodeBuildCursor(query.cursor) : null;
    const rows = await this.prisma.storyBuild.findMany({
      where: {
        storyProjectId: projectId,
        runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
        ...(query.kind ? { kind: query.kind } : {}),
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
  ): Promise<StoryBuildDto> {
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
    const frozen = await this.prisma.storyBuildAsset.findFirst({
      where: { storyProjectId: projectId, buildId, assetId, variantId },
      include: BUILD_DELIVERY_ASSET_INCLUDE,
    });
    if (
      !frozen ||
      frozen.build.status !== StoryBuildStatus.ready ||
      frozen.build.runtimeSchemaVersion !== EXPERIENCE_RUNTIME_SCHEMA_VERSION
    ) {
      throw buildAssetNotFound();
    }
    const scope = StoryBuildScopeSchema.safeParse(frozen.build.scope);
    const publiclyAuthorized =
      frozen.build.kind === StoryBuildKind.production &&
      scope.success &&
      scope.data.kind === 'full' &&
      frozen.build.experiencePublication?.mediaAuthorizedAt != null &&
      frozen.build.experiencePublication.mediaAuthorizationRevokedAt === null;
    if (!publiclyAuthorized) {
      if (!user) {
        throw new UnauthorizedException({
          code: 'STORY_BUILD_ASSET_AUTH_REQUIRED',
          message: 'Authentication is required for unpublished Build media.',
        });
      }
      await this.permissions.requireProject(
        user.userId,
        projectId,
        'story.read',
      );
    }
    const unavailable = currentMediaDiagnostics(
      [frozen],
      requireModerationApproval(),
    )[0];
    if (unavailable) {
      if (unavailable.code === 'STORY_BUILD_ASSET_MODERATION_PENDING') {
        throw new ForbiddenException({
          code: unavailable.code,
          message: unavailable.message,
        });
      }
      throw new GoneException({
        code: unavailable.code,
        message: unavailable.message,
      });
    }
    const source = selectStoryBuildReadSource(frozen.asset, frozen.variant);
    if (!source) {
      throw new GoneException({
        code: 'STORY_BUILD_ASSET_STORAGE_UNAVAILABLE',
        message: 'Build media storage is no longer available.',
      });
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
    input: CancelStoryBuildInput,
  ): Promise<StoryBuildDto> {
    await this.requireProjectScope(user, workspaceId, projectId, 'story.build');
    const current = await this.loadBuild(projectId, buildId);
    assertCurrentBuildContract(current);
    if (current.version !== input.expectedBuildVersion) {
      throw buildVersionConflict(input.expectedBuildVersion, current.version);
    }
    if (current.status === StoryBuildStatus.cancelled) {
      return this.toBuildDto(current);
    }
    if (isTerminalBuildStatus(current.status)) {
      throw new ConflictException({
        code: 'STORY_BUILD_NOT_CANCELLABLE',
        message: 'A terminal Build cannot be cancelled.',
      });
    }
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, projectId);
      return tx.storyBuild.updateMany({
        where: {
          id: buildId,
          storyProjectId: projectId,
          version: input.expectedBuildVersion,
          runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
          status: { in: nonTerminalBuildStatuses() },
        },
        data: {
          status: StoryBuildStatus.cancelled,
          completedAt: new Date(),
          version: { increment: 1 },
        },
      });
    });
    if (changed.count !== 1) {
      const refreshed = await this.loadBuild(projectId, buildId);
      if (refreshed.version !== input.expectedBuildVersion) {
        throw buildVersionConflict(
          input.expectedBuildVersion,
          refreshed.version,
        );
      }
      throw new ConflictException({
        code: 'STORY_BUILD_NOT_CANCELLABLE',
        message: 'The Build can no longer be cancelled.',
      });
    }
    return this.toBuildDto(await this.loadBuild(projectId, buildId));
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

  private toBuildDto(row: BuildRow): StoryBuildDto {
    assertCurrentBuildContract(row);
    const scope = StoryBuildScopeSchema.safeParse(row.scope);
    if (!scope.success) throw corruptBuild('scope');
    const persistedDiagnostics = parseBuildDiagnostics(row.diagnostics);
    const mediaDiagnostics = currentMediaDiagnostics(
      row.assets,
      requireModerationApproval(),
    );
    const deliveryDiagnostics = runtimeDeliveryDiagnostics(row);
    const diagnostics = mergeDiagnostics(
      persistedDiagnostics,
      mediaDiagnostics,
      deliveryDiagnostics,
    );
    const runtime = jsonRecordOrNull(row.runtimeJson);
    if (runtime) {
      const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
      if (!parsed.success) throw corruptBuild('Runtime Manifest v2');
      if (row.runtimeHash !== canonicalJsonHash(parsed.data)) {
        throw corruptBuild('runtime hash');
      }
    }
    return {
      id: row.id,
      projectId: row.storyProjectId,
      number: row.buildNumber,
      version: row.version,
      kind: row.kind,
      scope: scope.data,
      status: row.status,
      sourceDraftRevision: row.sourceDraftRevision,
      videoSnapshotHash: row.videoSnapshotHash,
      inputHash: row.inputHash,
      inputManifestHash: row.inputManifestHash,
      runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
      runtimeJson:
        mediaDiagnostics.length > 0 || deliveryDiagnostics.length > 0
          ? null
          : runtime,
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

  private toBuildSummaryDto(row: BuildRow): StoryBuildSummaryDto {
    const dto = this.toBuildDto(row);
    return {
      id: dto.id,
      number: dto.number,
      kind: dto.kind,
      scope: dto.scope,
      status: dto.status,
      sourceDraftRevision: dto.sourceDraftRevision,
      videoSnapshotHash: dto.videoSnapshotHash,
      diagnostics: dto.diagnostics,
      publication: dto.publication,
      createdAt: dto.createdAt,
      completedAt: dto.completedAt,
    };
  }
}

async function loadValidatedBuildSnapshot(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  input: CreateStoryBuildInput,
  buildId: string,
): Promise<ValidatedBuildSnapshot> {
  const project = await tx.storyProject.findFirst({
    where: { id: projectId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      summary: true,
      format: true,
      defaultLocale: true,
      frameProfile: true,
    },
  });
  if (!project) throw projectNotFound();
  const format = project.format;
  if (!isCreatableStoryFormat(format)) {
    throw new GoneException({
      code: 'STORY_BUILD_PROJECT_FORMAT_UNSUPPORTED',
      message: `Story format ${project.format} is not supported by the unified story compiler.`,
    });
  }
  const draft = await tx.storyDraft.findUnique({
    where: { storyProjectId: projectId },
  });
  if (!draft) {
    throw new UnprocessableEntityException({
      code: 'STORY_BUILD_DRAFT_REQUIRED',
      message: 'The project has no saved story draft to build.',
    });
  }
  if (draft.revision !== input.expectedDraftRevision) {
    throw new ConflictException({
      code: 'STORY_BUILD_DRAFT_REVISION_CONFLICT',
      message: 'The story draft changed. Refresh before creating the Build.',
      expectedRevision: input.expectedDraftRevision,
      actualRevision: draft.revision,
    });
  }
  if (draft.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION) {
    throw new GoneException({
      code: 'STORY_BUILD_DRAFT_SCHEMA_UNSUPPORTED',
      message:
        'This saved draft uses a retired schema and cannot be built. Save the story again in the current creator.',
      actualSchemaVersion: draft.schemaVersion,
      requiredSchemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
    });
  }
  const actualDraftHash = canonicalJsonHash(draft.content);
  if (actualDraftHash !== draft.contentHash) {
    throw new ConflictException({
      code: 'STORY_BUILD_DRAFT_INTEGRITY_ERROR',
      message: 'The saved story content does not match its recorded hash.',
      expectedHash: draft.contentHash,
      actualHash: actualDraftHash,
    });
  }
  const lockable = createLockableInteractiveStoryDraftContentSchema(
    project.defaultLocale,
  ).safeParse(draft.content);
  if (!lockable.success) {
    throw new UnprocessableEntityException({
      code: 'STORY_BUILD_DRAFT_NOT_BUILDABLE',
      message: 'Complete and connect the saved story before building it.',
      issues: lockable.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
    });
  }
  const clipNodes = lockable.data.graph.nodes.filter(
    (node): node is Extract<typeof node, { kind: 'clip' }> =>
      node.kind === 'clip',
  );
  const selections =
    clipNodes.length === 0
      ? []
      : await tx.storyVideoSelection.findMany({
          where: {
            storyProjectId: projectId,
            targetKind: StoryVideoTargetKind.clip,
            targetKey: { in: clipNodes.map((node) => node.nodeId) },
          },
          include: BUILD_SELECTION_INCLUDE,
        });
  const selectionByNodeId = new Map(
    selections.map((selection) => [selection.targetKey, selection]),
  );
  const entries = clipNodes.map((node) =>
    videoSnapshotEntry(node.nodeId, selectionByNodeId.get(node.nodeId) ?? null),
  );
  const videoSnapshotHash = storyVideoSnapshotHash(entries);
  if (videoSnapshotHash !== input.expectedVideoSnapshotHash) {
    throw new ConflictException({
      code: 'STORY_BUILD_VIDEO_SNAPSHOT_CONFLICT',
      message:
        'Current video selections changed. Refresh before creating the Build.',
      expectedVideoSnapshotHash: input.expectedVideoSnapshotHash,
      actualVideoSnapshotHash: videoSnapshotHash,
    });
  }
  const videos = clipNodes.map((node) =>
    prepareBuildVideo(
      project,
      buildId,
      node.nodeId,
      selectionByNodeId.get(node.nodeId) ?? null,
    ),
  );
  return {
    project: {
      ...project,
      format,
      frameProfile: project.frameProfile,
    },
    draft: {
      revision: draft.revision,
      contentHash: canonicalJsonHash(lockable.data),
      content: lockable.data,
    },
    videoSnapshotHash,
    entries,
    videos,
    musicUrls: await resolveStoryMusicUrls(
      tx,
      project.workspaceId,
      format,
      lockable.data,
    ),
  };
}

function videoSnapshotEntry(
  graphNodeId: string,
  selection: BuildSelectionRow | null,
): StoryVideoSnapshotEntry {
  if (!selection) return emptyVideoSnapshotEntry(graphNodeId, 0);
  const mediaValues = [
    selection.currentAssetId,
    selection.currentVariantId,
    selection.currentChecksumSha256,
    selection.currentContentType,
    selection.currentDurationMs,
    selection.currentWidth,
    selection.currentHeight,
    selection.currentBrowserSafeMp4,
  ];
  const populated = mediaValues.filter((value) => value !== null).length;
  if (populated === 0) {
    if (selection.currentSourceGenerationAttemptId !== null) {
      throw corruptSelection(graphNodeId);
    }
    return emptyVideoSnapshotEntry(graphNodeId, selection.version);
  }
  if (populated !== mediaValues.length) throw corruptSelection(graphNodeId);
  const candidate = {
    graphNodeId,
    selectionVersion: selection.version,
    assetId: selection.currentAssetId,
    variantId: selection.currentVariantId,
    sourceGenerationAttemptId: selection.currentSourceGenerationAttemptId,
    checksumSha256: selection.currentChecksumSha256,
    contentType: selection.currentContentType,
    durationMs: selection.currentDurationMs,
    width: selection.currentWidth,
    height: selection.currentHeight,
    browserSafeMp4: selection.currentBrowserSafeMp4,
  };
  const parsed = StoryVideoSnapshotEntrySchema.safeParse(candidate);
  if (!parsed.success) throw corruptSelection(graphNodeId);
  return parsed.data;
}

function emptyVideoSnapshotEntry(
  graphNodeId: string,
  selectionVersion: number,
): StoryVideoSnapshotEntry {
  return StoryVideoSnapshotEntrySchema.parse({
    graphNodeId,
    selectionVersion,
    assetId: null,
    variantId: null,
    sourceGenerationAttemptId: null,
    checksumSha256: null,
    contentType: null,
    durationMs: null,
    width: null,
    height: null,
    browserSafeMp4: null,
  });
}

function prepareBuildVideo(
  project: {
    id: string;
    workspaceId: string;
    frameProfile: StoryFrameProfile | null;
  },
  buildId: string,
  graphNodeId: string,
  selection: BuildSelectionRow | null,
): StoryBuildVideoInput {
  const entry = videoSnapshotEntry(graphNodeId, selection);
  if (!entry.assetId || !entry.variantId || !selection) {
    return {
      graphNodeId,
      sourceGenerationId: null,
      selectionVersion: entry.selectionVersion,
      asset: null,
      eligibilityDiagnostics: [],
    };
  }
  const diagnostics: StoryBuildDiagnosticDto[] = [];
  const asset = selection.currentAsset;
  const variant = selection.currentVariant;
  if (!asset || !variant || variant.assetId !== entry.assetId) {
    diagnostics.push(
      buildDiagnostic(
        'STORY_BUILD_VIDEO_VARIANT_NOT_FOUND',
        `Current video ${graphNodeId} does not resolve to its exact media variant.`,
        'asset',
        entry.assetId,
      ),
    );
  } else {
    if (
      asset.workspaceId !== project.workspaceId ||
      asset.kind !== MediaAssetKind.video
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_VIDEO_SCOPE_INVALID',
          `Current video ${graphNodeId} is not a project-scoped video asset.`,
          'asset',
          asset.id,
        ),
      );
    }
    if (
      asset.status !== MediaAssetStatus.ready ||
      asset.deletedAt !== null ||
      variant.status !== MediaAssetVariantStatus.ready ||
      variant.deletedAt !== null
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_VIDEO_NOT_READY',
          `Current video ${graphNodeId} is not an exact ready media variant.`,
          'asset',
          asset.id,
        ),
      );
    }
    diagnostics.push(
      ...moderationDiagnostics(
        asset,
        variant,
        requireModerationApproval(),
        `Current video ${graphNodeId}`,
      ),
    );
    const durationMs = variant.durationMs;
    if (
      !variant.checksumSha256 ||
      !variant.contentType.toLowerCase().startsWith('video/') ||
      variant.width === null ||
      variant.height === null ||
      durationMs === null ||
      durationMs <= 0
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_VIDEO_METADATA_REQUIRED',
          `Current video ${graphNodeId} is missing a checksum, video content type, dimensions, or an exact millisecond duration.`,
          'asset',
          asset.id,
        ),
      );
    } else if (
      entry.checksumSha256 !== variant.checksumSha256 ||
      entry.contentType !== variant.contentType ||
      entry.width !== variant.width ||
      entry.height !== variant.height ||
      entry.durationMs !== durationMs
    ) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_VIDEO_SELECTION_STALE',
          `Current video ${graphNodeId} metadata no longer matches its selected variant.`,
          'asset',
          asset.id,
        ),
      );
    }
    // A text-first (null-profile) project accepts the video's native
    // dimensions; only a film project pins clips to a fixed picture contract.
    // The frame profile is an authoring intent, not a delivery contract: a
    // 1280×720 clip is the same 16:9 picture as 1920×1080 and plays correctly.
    // Blocking Build on exact pixel dimensions only forced creators to
    // regenerate perfectly good footage, so the profile no longer gates
    // publication (same call as the browser-safe-MP4 gate).
    if (!selectStoryBuildReadSource(asset, variant)) {
      diagnostics.push(
        buildDiagnostic(
          'STORY_BUILD_VIDEO_STORAGE_UNAVAILABLE',
          `Current video ${graphNodeId} has no readable immutable storage placement.`,
          'asset',
          asset.id,
        ),
      );
    }
  }
  const frozen: FrozenStoryVideoAsset | null =
    diagnostics.length === 0 && asset && variant
      ? {
          assetId: asset.id,
          variantId: variant.id,
          checksumSha256: entry.checksumSha256 as string,
          contentType: entry.contentType as string,
          sizeBytes:
            variant.sizeBytes ??
            (variant.variantKey === 'original' ? asset.sizeBytes : null),
          width: entry.width as number,
          height: entry.height as number,
          durationMs: entry.durationMs as number,
          browserSafeMp4: isBrowserSafeMp4Metadata(variant.metadata),
          url: storyBuildAssetDeliveryPath(
            project.id,
            buildId,
            asset.id,
            variant.id,
          ),
        }
      : null;
  return {
    graphNodeId,
    sourceGenerationId: selection.currentSourceGenerationAttemptId,
    selectionVersion: selection.version,
    asset: frozen,
    eligibilityDiagnostics: diagnostics,
  };
}

async function materializeStoryRevision(
  tx: Prisma.TransactionClient,
  snapshot: ValidatedBuildSnapshot,
  userId: string,
) {
  const existing = await tx.storyRevision.findUnique({
    where: {
      storyProjectId_sourceDraftRevision: {
        storyProjectId: snapshot.project.id,
        sourceDraftRevision: snapshot.draft.revision,
      },
    },
  });
  if (existing) {
    if (
      existing.schemaVersion !== INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION ||
      existing.contentHash !== snapshot.draft.contentHash ||
      canonicalJsonHash(existing.content) !== existing.contentHash
    ) {
      throw new ConflictException({
        code: 'STORY_BUILD_REVISION_INTEGRITY_ERROR',
        message:
          'The immutable story revision does not match its source draft.',
      });
    }
    return existing;
  }
  const latest = await tx.storyRevision.aggregate({
    where: { storyProjectId: snapshot.project.id },
    _max: { number: true },
  });
  return tx.storyRevision.create({
    data: {
      storyProjectId: snapshot.project.id,
      number: (latest._max.number ?? 0) + 1,
      sourceDraftRevision: snapshot.draft.revision,
      schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
      content: snapshot.draft.content as Prisma.InputJsonObject,
      contentHash: snapshot.draft.contentHash,
      label: null,
      source: StoryRevisionSource.creator,
      createdByUserId: userId,
    },
  });
}

export function storyBuildInputManifest(
  input: CreateStoryBuildInput,
  snapshot: ValidatedBuildSnapshot,
  sourceRevisionId: string,
): Record<string, unknown> {
  return {
    schemaVersion: 4,
    compilerSemanticVersion: STORY_BUILD_COMPILER_SEMANTIC_VERSION,
    runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
    scope: input.scope,
    project: {
      id: snapshot.project.id,
      format: snapshot.project.format,
      frameProfile: snapshot.project.frameProfile,
      defaultLocale: snapshot.project.defaultLocale,
      title: snapshot.project.title,
      summary: snapshot.project.summary,
    },
    story: {
      sourceRevisionId,
      sourceDraftRevision: snapshot.draft.revision,
      contentHash: snapshot.draft.contentHash,
    },
    video: {
      snapshotHash: snapshot.videoSnapshotHash,
      selections: snapshot.entries,
    },
  };
}

export function storyBuildRequestFingerprint(
  input: CreateStoryBuildInput,
): string {
  return canonicalJsonHash(input);
}

export function storyBuildSubmissionKey(
  userId: string,
  projectId: string,
  idempotencyKey: string,
): string {
  return canonicalJsonHash({ userId, projectId, idempotencyKey });
}

function assertBuildReplay(
  build: { requestFingerprint: string },
  requestFingerprint: string,
): void {
  if (build.requestFingerprint === requestFingerprint) return;
  throw new ConflictException({
    code: 'STORY_BUILD_IDEMPOTENCY_CONFLICT',
    message: 'Idempotency-Key was already used with another Build request.',
  });
}

function toBuildAssetDto(row: BuildRow['assets'][number]): StoryBuildAssetDto {
  return {
    id: row.id,
    buildId: row.buildId,
    graphNodeId: row.videoClip?.graphNodeId ?? null,
    logicalKey: row.logicalKey,
    role: row.role,
    assetId: row.assetId,
    variantId: row.variantId,
    checksumSha256: row.checksumSha256,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    browserSafeMp4: row.browserSafeMp4,
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
  const source: MediaStorageReadRef = {
    storageProvider: asset.storageProvider,
    bucket: asset.bucket,
    region: asset.region,
    objectKey: asset.objectKey,
    externalUrl: asset.externalUrl,
    contentType: variant.contentType || asset.contentType,
  };
  return isCompleteBuildReadRef(source) ? source : null;
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

function isBrowserSafeMp4Metadata(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.browserSafeMp4 === true) return true;
  const probe = value.videoProbe;
  return (
    probe !== null &&
    probe !== undefined &&
    typeof probe === 'object' &&
    !Array.isArray(probe) &&
    probe.browserSafeMp4 === true
  );
}

function moderationDiagnostics(
  asset: { id: string; moderationStatus: MediaAssetModerationStatus },
  variant: { status: MediaAssetVariantStatus },
  approvalRequired: boolean,
  label: string,
): StoryBuildDiagnosticDto[] {
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
  if (
    approvalRequired &&
    asset.moderationStatus !== MediaAssetModerationStatus.approved
  ) {
    return [
      buildDiagnostic(
        'STORY_BUILD_ASSET_MODERATION_PENDING',
        `${label} is awaiting moderation approval for shared playback.`,
        'asset',
        asset.id,
      ),
    ];
  }
  return [];
}

interface CurrentBuildMediaRow {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  browserSafeMp4: boolean | null;
  sizeBytes: bigint | null;
  asset: {
    id: string;
    kind: MediaAssetKind;
    status: MediaAssetStatus;
    moderationStatus: MediaAssetModerationStatus;
    deletedAt: Date | null;
    sizeBytes: bigint | null;
  };
  variant: {
    id: string;
    assetId: string;
    status: MediaAssetVariantStatus;
    checksumSha256: string | null;
    variantKey: string;
    contentType: string;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    sizeBytes: bigint | null;
    metadata: Prisma.JsonValue;
    deletedAt: Date | null;
  };
}

function currentMediaDiagnostics(
  assets: CurrentBuildMediaRow[],
  approvalRequired: boolean,
): StoryBuildDiagnosticDto[] {
  return assets.flatMap((frozen) => {
    const label = `Build asset ${frozen.logicalKey}`;
    const moderation = moderationDiagnostics(
      frozen.asset,
      frozen.variant,
      approvalRequired,
      label,
    );
    if (moderation.length > 0) return moderation;
    if (
      frozen.asset.status === MediaAssetStatus.deleted ||
      frozen.asset.deletedAt !== null ||
      frozen.variant.status === MediaAssetVariantStatus.deleted ||
      frozen.variant.deletedAt !== null
    ) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_UNAVAILABLE',
          `${label} was deleted and is unavailable for playback.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    if (
      frozen.asset.status !== MediaAssetStatus.ready ||
      frozen.asset.kind !== MediaAssetKind.video ||
      frozen.variant.status !== MediaAssetVariantStatus.ready ||
      frozen.asset.id !== frozen.assetId ||
      frozen.variant.id !== frozen.variantId ||
      frozen.variant.assetId !== frozen.assetId
    ) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_NOT_READY',
          `${label} is no longer a ready exact media variant.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    if (frozen.variant.checksumSha256 !== frozen.checksumSha256) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_INTEGRITY_CHANGED',
          `${label} no longer matches its frozen checksum.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    const currentSizeBytes =
      frozen.variant.sizeBytes ??
      (frozen.variant.variantKey === 'original'
        ? frozen.asset.sizeBytes
        : null);
    if (
      !frozen.contentType.toLowerCase().startsWith('video/') ||
      frozen.durationMs === null ||
      frozen.durationMs <= 0 ||
      frozen.width === null ||
      frozen.width <= 0 ||
      frozen.height === null ||
      frozen.height <= 0 ||
      frozen.variant.contentType !== frozen.contentType ||
      frozen.variant.durationMs !== frozen.durationMs ||
      frozen.variant.width !== frozen.width ||
      frozen.variant.height !== frozen.height ||
      (frozen.sizeBytes !== null && currentSizeBytes !== frozen.sizeBytes)
    ) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_METADATA_CHANGED',
          `${label} no longer matches its frozen playback metadata.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    return [];
  });
}

function runtimeDeliveryDiagnostics(row: BuildRow): StoryBuildDiagnosticDto[] {
  const runtime = jsonRecordOrNull(row.runtimeJson);
  if (!runtime) return [];
  const parsed = ExperienceRuntimeManifestSchema.safeParse(runtime);
  if (!parsed.success) return [];
  const allowed = new Set(
    row.assets.map((asset) =>
      storyBuildAssetDeliveryPath(
        row.storyProjectId,
        row.id,
        asset.assetId,
        asset.variantId,
      ),
    ),
  );
  const videoUris = parsed.data.assets.flatMap((asset) =>
    asset.kind === 'video' ? asset.variants.map((variant) => variant.uri) : [],
  );
  if (
    videoUris.length === row.assets.length &&
    videoUris.every((uri) => allowed.has(uri))
  ) {
    return [];
  }
  return [
    buildDiagnostic(
      'STORY_BUILD_RUNTIME_DELIVERY_UNSAFE',
      'The Runtime Manifest does not reference exactly its frozen Build media.',
      'revision',
      String(row.sourceDraftRevision),
    ),
  ];
}

function mergeDiagnostics(
  ...groups: StoryBuildDiagnosticDto[][]
): StoryBuildDiagnosticDto[] {
  const unique = new Map<string, StoryBuildDiagnosticDto>();
  groups.flat().forEach((item) => {
    unique.set(
      [
        item.severity,
        item.code,
        item.entityType,
        item.entityId,
        item.message,
      ].join('\u0000'),
      item,
    );
  });
  return [...unique.values()];
}

function parseBuildDiagnostics(
  value: Prisma.JsonValue,
): StoryBuildDiagnosticDto[] {
  if (!Array.isArray(value) || !value.every(isBuildDiagnostic)) {
    throw corruptBuild('diagnostics');
  }
  return value as unknown as StoryBuildDiagnosticDto[];
}

function isBuildDiagnostic(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value;
  return (
    (item.severity === 'error' || item.severity === 'warning') &&
    typeof item.code === 'string' &&
    typeof item.message === 'string' &&
    (item.entityType === null || typeof item.entityType === 'string') &&
    (item.entityId === null || typeof item.entityId === 'string')
  );
}

function parsePathReport(
  value: Prisma.JsonValue,
): StoryBuildPathReportDto | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value;
  if (
    !Number.isInteger(row.enumeratedPathCount) ||
    !Array.isArray(row.reachableEndingIds) ||
    !row.reachableEndingIds.every((item) => typeof item === 'string') ||
    !Array.isArray(row.unreachableNodeIds) ||
    !row.unreachableNodeIds.every((item) => typeof item === 'string') ||
    !Number.isInteger(row.ambiguousPathCount) ||
    !Number.isInteger(row.durationMinMs) ||
    !Number.isInteger(row.durationMaxMs)
  ) {
    throw corruptBuild('path report');
  }
  return row as unknown as StoryBuildPathReportDto;
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
  entityType: StoryBuildDiagnosticDto['entityType'],
  entityId: string | null,
): StoryBuildDiagnosticDto {
  return { severity: 'error', code, message, entityType, entityId };
}

function assertCurrentBuildContract(row: {
  runtimeSchemaVersion: number;
}): void {
  if (row.runtimeSchemaVersion === EXPERIENCE_RUNTIME_SCHEMA_VERSION) return;
  throw new GoneException({
    code: 'STORY_BUILD_SCHEMA_RETIRED',
    message:
      'This Build uses a retired runtime contract. Create a new Build from the current story.',
  });
}

function corruptSelection(graphNodeId: string): ConflictException {
  return new ConflictException({
    code: 'STORY_VIDEO_SELECTION_CORRUPT',
    message: `Current video selection ${graphNodeId} is partially populated.`,
  });
}

function corruptBuild(part: string): ConflictException {
  return new ConflictException({
    code: 'STORY_BUILD_CORRUPT',
    message: `The immutable Build ${part} is invalid.`,
  });
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

function projectNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_PROJECT_NOT_FOUND',
    message: 'Story project not found.',
  });
}

function buildNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_BUILD_NOT_FOUND',
    message: 'Story Build not found.',
  });
}

function buildAssetNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'STORY_BUILD_ASSET_NOT_FOUND',
    message: 'Build media asset not found.',
  });
}

function buildVersionConflict(
  expectedVersion: number,
  actualVersion: number,
): ConflictException {
  return new ConflictException({
    code: 'STORY_BUILD_VERSION_CONFLICT',
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

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
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
    // Stable API error below.
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
