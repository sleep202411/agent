import {
  migrateStoredExperienceAppearance,
  GameUIProjectSchema,
  type GameUIProject,
  type ExperienceAppearance,
} from '@repo/shared/experience-runtime';
import { StoryCommunityAccessService } from './story-community-access.service';
import { readStoryPoster } from './story-build-poster';
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
  StoryProductionSpecStatus,
  MediaAssetModerationStatus,
  MediaAssetStatus,
  MediaAssetVariantStatus,
  MediaObjectPlacementRole,
  MediaObjectPlacementStatus,
  MediaStorageProvider,
  Prisma,
  StoryAssetRole,
  StoryBuildKind,
  StoryBuildStatus,
  StoryExperiencePublicationStatus,
  StoryRevisionSource,
} from '@prisma/client';
import {
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';
import type { StoryBuildAssetPlayback } from '@repo/shared/story-playback';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  HLS_VARIANT_KEY,
  ORIGINAL_VARIANT_KEY,
} from '../infra/storage/media-asset-placement';
import { resolveMediaPublicVariantUrl } from '../infra/storage/media-asset-url-resolver.service';
import {
  MediaStorageAccessService,
  type MediaStorageReadRef,
} from '../infra/storage/media-storage-access.service';
import { storyHlsPlayback } from '../media/hls-output';
import { requireModerationApproval } from '../media/media-moderation-policy';
import {
  isPlayableStoryBuild,
  storyManifestAccess,
} from './story-build-access';
import { canonicalJsonHash } from './canonical-json';
import {
  INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION,
  STORY_FRAME_PROFILE_CONTRACTS,
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
  type StoryFrameProfile,
  type InteractiveStoryDraftContent,
} from './dto';
import {
  assignStoryPlaybackSlots,
  compileStoryBuild,
  storyPlaybackSlotKey,
  type FrozenStoryVideoAsset,
  type StoryBuildNodeTimelineInput,
  type StoryBuildSegmentInput,
} from './story-build-compiler';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';
import {
  chooseStoryboardClipVariant,
  isBrowserSafeMp4Metadata,
  storyboardClipSnapshotEntry,
  storyVideoSnapshotHash,
  type StoryVideoSnapshotEntry,
} from './story-video-production.schema';

const BUILD_INCLUDE = Prisma.validator<Prisma.StoryBuildInclude>()({
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
        runtimeJson: true,
        experiencePublication: {
          select: {
            mediaAuthorizedAt: true,
            mediaAuthorizationRevokedAt: true,
          },
        },
        experienceDraftRelease: {
          select: { status: true },
        },
        gameReleaseChapters: {
          select: {
            release: {
              select: {
                status: true,
                mediaAuthorizationRevokedAt: true,
              },
            },
          },
        },
      },
    },
    // Asset-level (variant-less) placements only, like the URL resolver:
    // variant-scoped rows (the HLS master and its replicas, a poster) must
    // never become the read source of a frozen original.
    asset: { include: { placements: { where: { variantId: null } } } },
    variant: { include: { placements: true } },
  });
type BuildDeliveryAssetRow = Prisma.StoryBuildAssetGetPayload<{
  include: typeof BUILD_DELIVERY_ASSET_INCLUDE;
}>;

/**
 * A chapter's storyboard timeline with everything a Build freeze needs: the
 * ordered clips, each clip's selected creative media, and the media's
 * immutable storage placements. The storyboard — not any per-node video
 * selection — is the sole source of a node's playable content.
 */
const BUILD_TIMELINE_INCLUDE =
  Prisma.validator<Prisma.StoryStoryboardSequenceInclude>()({
    clips: {
      where: { status: { not: StoryProductionSpecStatus.archived } },
      orderBy: [
        { track: 'asc' as const },
        { startMs: 'asc' as const },
        { rank: 'asc' as const },
      ],
      include: {
        selectedMediaVersion: {
          include: {
            mediaAsset: {
              include: {
                placements: true,
                variants: { include: { placements: true } },
              },
            },
            preferredVariant: { include: { placements: true } },
          },
        },
      },
    },
  });
type BuildTimelineSequenceRow = Prisma.StoryStoryboardSequenceGetPayload<{
  include: typeof BUILD_TIMELINE_INCLUDE;
}>;
type BuildTimelineClipRow = BuildTimelineSequenceRow['clips'][number];

const BUILD_MEDIA_READ_URL_TTL_SECONDS = positiveInt(
  process.env.MEDIA_USER_READ_URL_TTL_SECONDS,
  5 * 60,
);
export const STORY_BUILD_COMPILER_SEMANTIC_VERSION = 9;

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
    defaultLocale: string;
    frameProfile: StoryFrameProfile;
    appearance: ExperienceAppearance | null;
    gameUi: GameUIProject | null;
  };
  draft: {
    revision: number;
    contentHash: string;
    content: InteractiveStoryDraftContent;
  };
  videoSnapshotHash: string;
  entries: StoryVideoSnapshotEntry[];
  timelines: StoryBuildNodeTimelineInput[];
}

@Injectable()
export class StoryBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly storageAccess: MediaStorageAccessService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly communityAccess: StoryCommunityAccessService,
  ) {}

  async createBuild(
    user: AuthUser,
    projectId: string,
    input: CreateStoryBuildInput,
    idempotencyKey: string,
  ): Promise<StoryBuildDto> {
    const access = await this.requireProjectScope(
      user,
      projectId,
      'story.build',
    );
    const workspaceId = access.project.workspaceId;
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
            const kind = await resolveBuildKind(tx, projectId, input);
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
              buildId,
              sourceDraftRevision: snapshot.draft.revision,
              channel:
                kind === StoryBuildKind.production ? 'production' : 'preview',
              scope: input.scope,
              frameProfile: snapshot.project.frameProfile,
              appearance: snapshot.project.appearance ?? undefined,
              gameUi: snapshot.project.gameUi?.artifact,
              defaultLocale: snapshot.project.defaultLocale,
              metadata: {
                title: snapshot.project.title,
                summary: snapshot.project.summary,
              },
              draft: snapshot.draft.content,
              timelines: snapshot.timelines,
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
              const timelineByNodeId = new Map(
                snapshot.timelines.map((timeline) => [
                  timeline.graphNodeId,
                  timeline,
                ]),
              );
              const nodeRankById = new Map(
                snapshot.draft.content.graph.nodes.flatMap((node, index) =>
                  node.kind === 'clip' ? [[node.nodeId, index] as const] : [],
                ),
              );
              const playbackSlots = assignStoryPlaybackSlots(
                compilation.includedGraphNodeIds.flatMap((graphNodeId) => {
                  const timeline = timelineByNodeId.get(graphNodeId);
                  if (!timeline) return [];
                  return [
                    {
                      graphNodeId,
                      segments: timeline.segments.filter(
                        (segment) => segment.asset !== null,
                      ),
                    },
                  ];
                }),
              );
              for (const graphNodeId of compilation.includedGraphNodeIds) {
                const timeline = timelineByNodeId.get(graphNodeId);
                const nodeRank = nodeRankById.get(graphNodeId);
                if (!timeline || nodeRank === undefined) {
                  throw new Error(
                    `Compiler included unknown graph node ${graphNodeId}.`,
                  );
                }
                const frozenSegments = timeline.segments.filter(
                  (segment) => segment.asset !== null,
                );
                if (frozenSegments.length === 0) {
                  throw new Error(
                    `Compiler included unfrozen timeline ${graphNodeId}.`,
                  );
                }
                for (const [segmentRank, segment] of frozenSegments.entries()) {
                  const asset = segment.asset as FrozenStoryVideoAsset;
                  const rank = nodeRank * 1_000 + segmentRank;
                  const buildAsset = await tx.storyBuildAsset.create({
                    data: {
                      buildId,
                      storyProjectId: projectId,
                      logicalKey:
                        playbackSlots.get(
                          storyPlaybackSlotKey(graphNodeId, segmentRank),
                        )?.assetId ?? `video:${segment.clipId}`,
                      role: StoryAssetRole.video,
                      assetId: asset.assetId,
                      variantId: asset.variantId,
                      checksumSha256: asset.checksumSha256,
                      contentType: asset.contentType,
                      sizeBytes: asset.sizeBytes,
                      width: asset.width,
                      height: asset.height,
                      durationMs: asset.durationMs,
                      browserSafeMp4: asset.browserSafeMp4,
                      rank,
                    },
                  });
                  await tx.storyVideoBuildClip.create({
                    data: {
                      buildId,
                      storyProjectId: projectId,
                      graphNodeId,
                      buildAssetId: buildAsset.id,
                      logicalKey: buildAsset.logicalKey,
                      checksumSha256: asset.checksumSha256,
                      contentType: asset.contentType,
                      durationMs: asset.durationMs,
                      width: asset.width,
                      height: asset.height,
                      browserSafeMp4: asset.browserSafeMp4,
                      rank,
                    },
                  });
                }
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
    projectId: string,
    query: StoryBuildListQuery,
  ): Promise<CursorPageDto<StoryBuildSummaryDto>> {
    await this.requireProjectScope(user, projectId, 'story.read');
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
    projectId: string,
    buildId: string,
  ): Promise<StoryBuildDto> {
    await this.requireProjectScope(user, projectId, 'story.read');
    return this.toBuildDto(await this.loadBuild(projectId, buildId));
  }

  async issueBuildAssetReadUrl(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
    posterOnly = false,
  ): Promise<{ url: string; expiresAt: string | null; stream?: boolean }> {
    const { frozen, publiclyAuthorized } = await this.loadDeliverableBuildAsset(
      user,
      projectId,
      buildId,
      assetId,
      variantId,
    );
    const paidContent =
      storyManifestAccess(frozen.build.runtimeJson) === 'paid';
    if (
      posterOnly &&
      (frozen.asset.kind !== MediaAssetKind.video ||
        !frozen.variant.contentType.startsWith('video/'))
    ) {
      throw buildAssetNotFound();
    }
    if (publiclyAuthorized && paidContent && !posterOnly) {
      let authoringAccess = false;
      if (user) {
        try {
          await this.permissions.requireProject(
            user.userId,
            projectId,
            'story.read',
          );
          authoringAccess = true;
        } catch (error) {
          if (
            !(error instanceof NotFoundException) &&
            !(error instanceof ForbiddenException)
          )
            throw error;
        }
      }
      if (!authoringAccess)
        await this.communityAccess.requireAssetAccess(
          user,
          projectId,
          buildId,
          assetId,
          variantId,
        );
    }
    throwIfBuildMediaUnavailable(frozen);
    const source = selectStoryBuildReadSource(frozen.asset, frozen.variant);
    if (!source) {
      throw new GoneException({
        code: 'STORY_BUILD_ASSET_STORAGE_UNAVAILABLE',
        message: 'Build media storage is no longer available.',
      });
    }
    // Published anonymous play uses the same public CDN host as covers
    // (media.fizzspace.cn / r2.fizzdragon.com). Signing that object against
    // oss.fizzspace.cn put response-content-type on a CNAME that rejects it
    // (400), and a 5-minute private URL is the wrong contract for a
    // catalogue film. Revoking publication still stops NEW /aurora
    // redirects; already-known CDN URLs stay reachable — same trade as
    // cover/music. Preview / unpublished Builds keep a signed URL.
    if (publiclyAuthorized && !paidContent && !posterOnly) {
      const publicUrl = resolveMediaPublicVariantUrl(
        {
          ...frozen.asset,
          variants: [frozen.variant],
        },
        frozen.variant.variantKey,
      );
      if (publicUrl) {
        return { url: publicUrl, expiresAt: null };
      }
    }
    if (
      (paidContent || posterOnly) &&
      source.storageProvider === MediaStorageProvider.external_url
    ) {
      throw new UnprocessableEntityException(
        'Paid story media must be stored in managed storage.',
      );
    }
    const signed = await this.storageAccess.createReadUrl(source, {
      cacheControl: 'private, no-store',
      expiresInSeconds: BUILD_MEDIA_READ_URL_TTL_SECONDS,
    });
    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      ...(paidContent ? { stream: true } : {}),
    };
  }

  /**
   * Adaptive playback a client may switch to for one frozen clip, or null to
   * keep progressive `/content`. Offered only where the HLS URL is safe to hand
   * out unsigned: a publicly authorized, FREE Build (a manifest that no longer
   * parses is not free), its original video variant, and a ready HLS output.
   * Paid Builds return null before any entitlement work — their media stays on
   * the entitlement-checked `/content` stream.
   */
  async resolveBuildAssetPlayback(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
  ): Promise<StoryBuildAssetPlayback | null> {
    const { frozen, publiclyAuthorized } = await this.loadDeliverableBuildAsset(
      user,
      projectId,
      buildId,
      assetId,
      variantId,
    );
    if (!publiclyAuthorized) return null;
    if (storyManifestAccess(frozen.build.runtimeJson) !== 'free') return null;
    throwIfBuildMediaUnavailable(frozen);
    if (
      frozen.asset.kind !== MediaAssetKind.video ||
      frozen.variant.variantKey !== ORIGINAL_VARIANT_KEY
    ) {
      return null;
    }
    const hls = await this.prisma.mediaAssetVariant.findFirst({
      where: {
        assetId,
        variantKey: HLS_VARIANT_KEY,
        status: MediaAssetVariantStatus.ready,
        deletedAt: null,
      },
      include: {
        placements: {
          where: {
            role: MediaObjectPlacementRole.primary,
            status: MediaObjectPlacementStatus.active,
            deletedAt: null,
          },
        },
      },
    });
    return storyHlsPlayback(frozen.asset, hls);
  }

  /**
   * The gate every Build media read shares: the frozen row of a ready,
   * current-schema Build, then the publication check — anonymous delivery
   * needs a durable publication or release grant; anything else requires a
   * signed-in project reader (401 anonymous, `story.read` otherwise).
   */
  private async loadDeliverableBuildAsset(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
  ): Promise<{ frozen: BuildDeliveryAssetRow; publiclyAuthorized: boolean }> {
    const frozen = await this.prisma.storyBuildAsset.findFirst({
      where: { storyProjectId: projectId, buildId, assetId, variantId },
      include: BUILD_DELIVERY_ASSET_INCLUDE,
    });
    if (!frozen || !isPlayableStoryBuild(frozen.build)) {
      throw buildAssetNotFound();
    }
    const scope = StoryBuildScopeSchema.safeParse(frozen.build.scope);
    const authorizedAsWholeWork =
      frozen.build.kind === StoryBuildKind.production &&
      scope.success &&
      scope.data.kind === 'full' &&
      ((frozen.build.experiencePublication?.mediaAuthorizedAt != null &&
        frozen.build.experiencePublication.mediaAuthorizationRevokedAt ===
          null) ||
        (frozen.build.experienceDraftRelease != null &&
          frozen.build.experienceDraftRelease.status !==
            StoryExperiencePublicationStatus.rejected));
    // A chapter Build is a subgraph and never carries a Build publication, so
    // its anonymous grant comes from the game release that listed it. Same
    // rule, different release kind: a durable row authorized the media before
    // Java could serve the manifest, and only a definitive rejection revokes.
    const authorizedAsChapter = frozen.build.gameReleaseChapters.some(
      (chapter) =>
        chapter.release.mediaAuthorizationRevokedAt === null &&
        chapter.release.status !== StoryExperiencePublicationStatus.rejected,
    );
    const publiclyAuthorized = authorizedAsWholeWork || authorizedAsChapter;
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
    return { frozen, publiclyAuthorized };
  }

  async readBuildAssetPoster(
    user: AuthUser | undefined,
    projectId: string,
    buildId: string,
    assetId: string,
    variantId: string,
  ): Promise<Buffer> {
    // Recheck release, story.read, moderation and storage before every cache read.
    const source = await this.issueBuildAssetReadUrl(
      user,
      projectId,
      buildId,
      assetId,
      variantId,
      true,
    );
    return readStoryPoster(`${buildId}:${assetId}:${variantId}`, source.url);
  }

  async cancelBuild(
    user: AuthUser,
    projectId: string,
    buildId: string,
    input: CancelStoryBuildInput,
  ): Promise<StoryBuildDto> {
    await this.requireProjectScope(user, projectId, 'story.build');
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
    projectId: string,
    capability: Parameters<StoryPermissionService['requireProject']>[2],
  ) {
    const scope = await this.permissions.requireProject(
      user.userId,
      projectId,
      capability,
    );
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
        mediaDiagnostics.some(
          (diagnostic) => diagnostic.severity === 'error',
        ) ||
        deliveryDiagnostics.some(
          (diagnostic) => diagnostic.severity === 'error',
        )
          ? null
          : runtime,
      runtimeHash: row.runtimeHash,
      assets: row.assets.map(toBuildAssetDto),
      diagnostics,
      pathReport: parsePathReport(row.pathReport),
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
    where: { id: projectId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      summary: true,
      defaultLocale: true,
      frameProfile: true,
      appearance: true,
      gameUi: true,
    },
  });
  if (!project) throw projectNotFound();
  const draft = await tx.storyDraft.findUnique({
    where: { storyProjectId: projectId },
  });
  if (!draft) {
    throw new UnprocessableEntityException({
      code: 'STORY_BUILD_DRAFT_REQUIRED',
      message: 'The project has no saved story draft to build.',
    });
  }
  if (
    input.expectedDraftRevision !== undefined &&
    draft.revision !== input.expectedDraftRevision
  ) {
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
    (node) => node.kind === 'clip',
  );
  const sequences =
    clipNodes.length === 0
      ? []
      : await tx.storyStoryboardSequence.findMany({
          where: {
            storyProjectId: projectId,
            plotNodeId: { in: clipNodes.map((node) => node.nodeId) },
            status: { not: StoryProductionSpecStatus.archived },
          },
          include: BUILD_TIMELINE_INCLUDE,
        });
  const sequenceByNodeId = new Map(
    sequences.map((sequence) => [sequence.plotNodeId, sequence]),
  );
  const timelines: StoryBuildNodeTimelineInput[] = clipNodes.map((node) => {
    const sequence = sequenceByNodeId.get(node.nodeId) ?? null;
    return {
      graphNodeId: node.nodeId,
      sequenceId: sequence?.id ?? null,
      segments: (sequence?.clips ?? []).map((clip) =>
        prepareBuildSegment(project, buildId, node.nodeId, clip),
      ),
    };
  });
  const entries = timelines.flatMap((timeline) => {
    const sequence = sequenceByNodeId.get(timeline.graphNodeId) ?? null;
    return (sequence?.clips ?? []).map((clip) => clipSnapshotEntry(clip));
  });
  const videoSnapshotHash = storyVideoSnapshotHash(entries);
  if (
    input.expectedVideoSnapshotHash !== undefined &&
    videoSnapshotHash !== input.expectedVideoSnapshotHash
  ) {
    throw new ConflictException({
      code: 'STORY_BUILD_VIDEO_SNAPSHOT_CONFLICT',
      message:
        'Current video selections changed. Refresh before creating the Build.',
      expectedVideoSnapshotHash: input.expectedVideoSnapshotHash,
      actualVideoSnapshotHash: videoSnapshotHash,
    });
  }

  return {
    project: {
      ...project,
      appearance:
        project.appearance == null
          ? null
          : migrateStoredExperienceAppearance(project.appearance),
      gameUi:
        project.gameUi == null
          ? null
          : GameUIProjectSchema.parse(project.gameUi),
      frameProfile: project.frameProfile,
    },
    draft: {
      revision: draft.revision,
      contentHash: canonicalJsonHash(lockable.data),
      content: lockable.data,
    },
    videoSnapshotHash,
    entries,
    timelines,
  };
}

const clipSnapshotEntry = storyboardClipSnapshotEntry;
const chooseClipVariant = chooseStoryboardClipVariant;

function prepareBuildSegment(
  project: {
    id: string;
    workspaceId: string;
    frameProfile: StoryFrameProfile;
  },
  buildId: string,
  graphNodeId: string,
  clip: BuildTimelineClipRow,
): StoryBuildSegmentInput {
  const shot = clip.title?.trim() || clip.stableKey;
  const base = {
    clipId: clip.id,
    clipKey: clip.stableKey,
    title: shot,
    kind: clip.kind as 'image' | 'video',
    durationMs: clip.durationMs,
    clipVersion: clip.version,
  };
  const media = clip.selectedMediaVersion;
  if (!media || media.archivedAt !== null) {
    return { ...base, asset: null, eligibilityDiagnostics: [] };
  }
  const diagnostics: StoryBuildDiagnosticDto[] = [];
  const asset = media.mediaAsset;
  const variant = chooseClipVariant(media);
  const label = `"${shot}"`;
  if (!variant) {
    diagnostics.push(
      buildDiagnostic(
        'STORY_BUILD_VIDEO_VARIANT_NOT_FOUND',
        `${label} does not resolve to a playable media variant.`,
        'asset',
        media.mediaAssetId,
      ),
    );
    return { ...base, asset: null, eligibilityDiagnostics: diagnostics };
  }
  const expectedKind =
    clip.kind === 'video' ? MediaAssetKind.video : MediaAssetKind.image;
  if (asset.kind !== expectedKind) {
    diagnostics.push(
      buildDiagnostic(
        'STORY_BUILD_VIDEO_SCOPE_INVALID',
        `${label} is a ${asset.kind} asset, not ${clip.kind}.`,
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
        `${label} is not a ready media variant.`,
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
      label,
    ),
  );
  const expectedPrefix = clip.kind === 'video' ? 'video/' : 'image/';
  if (!variant.contentType.toLowerCase().startsWith(expectedPrefix)) {
    diagnostics.push(
      buildDiagnostic(
        'STORY_BUILD_VIDEO_CONTENT_TYPE_INVALID',
        `${label} does not resolve to a ${clip.kind} media type.`,
        'asset',
        asset.id,
      ),
    );
  }
  if (
    clip.kind === 'video' &&
    (!variant.checksumSha256 ||
      variant.width === null ||
      variant.height === null ||
      variant.durationMs === null ||
      variant.durationMs <= 0 ||
      !isBrowserSafeMp4Metadata(variant.metadata))
  ) {
    diagnostics.push(
      buildWarning(
        'STORY_BUILD_VIDEO_METADATA_INCOMPLETE',
        `${label} has incomplete technical metadata; the original video remains publishable.`,
        'asset',
        asset.id,
      ),
    );
  }
  if (clip.kind === 'video' && variant.width && variant.height) {
    const expected = STORY_FRAME_PROFILE_CONTRACTS[project.frameProfile];
    if (
      variant.width !== expected.width ||
      variant.height !== expected.height
    ) {
      diagnostics.push(
        buildWarning(
          'STORY_BUILD_VIDEO_FRAME_PROFILE_MISMATCH',
          `${label} is ${variant.width}×${variant.height}; project settings recommend ${expected.width}×${expected.height}. It will still be published.`,
          'asset',
          asset.id,
        ),
      );
    }
  }
  // story_build_ready_guard admits a frozen variant only through its own
  // active placement; the asset-level read fallback would pass here and then
  // fail the whole Build at the database.
  if (!pickActiveBuildPlacement(variant.placements)) {
    diagnostics.push(
      buildDiagnostic(
        'STORY_BUILD_VIDEO_STORAGE_UNAVAILABLE',
        `${label} has no stored file the published work can play. Regenerate or re-upload this shot.`,
        'asset',
        asset.id,
      ),
    );
  }
  const frozen: FrozenStoryVideoAsset | null = !diagnostics.some(
    (item) => item.severity === 'error',
  )
    ? {
        assetId: asset.id,
        variantId: variant.id,
        checksumSha256: variant.checksumSha256,
        contentType: variant.contentType,
        sizeBytes:
          variant.sizeBytes ??
          (variant.variantKey === 'original' ? asset.sizeBytes : null),
        width: variant.width,
        height: variant.height,
        durationMs: variant.durationMs,
        browserSafeMp4: isBrowserSafeMp4Metadata(variant.metadata),
        url: storyBuildAssetDeliveryPath(
          project.id,
          buildId,
          asset.id,
          variant.id,
        ),
      }
    : null;
  return { ...base, asset: frozen, eligibilityDiagnostics: diagnostics };
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
  // Revisions are append-only, one per draft revision. A later compile rule
  // may project the same saved draft differently; the Build compiles the
  // draft itself, so the stored row remains its valid provenance.
  if (existing) return existing;
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
    schemaVersion: 8,
    compilerSemanticVersion: STORY_BUILD_COMPILER_SEMANTIC_VERSION,
    runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
    scope: input.scope,
    project: {
      id: snapshot.project.id,
      frameProfile: snapshot.project.frameProfile,
      defaultLocale: snapshot.project.defaultLocale,
      title: snapshot.project.title,
      summary: snapshot.project.summary,
      appearance: snapshot.project.appearance,
      gameUi: snapshot.project.gameUi,
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
  checksumSha256: string | null;
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
    // A segment freezes either footage or a still, and its frozen contentType
    // was checked against the storyboard clip's kind when the Build was made.
    // That makes it the authority for what this row is allowed to read back as.
    const frozenKind = frozen.contentType.toLowerCase().startsWith('image/')
      ? MediaAssetKind.image
      : MediaAssetKind.video;
    const expectedPrefix =
      frozenKind === MediaAssetKind.image ? 'image/' : 'video/';
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
      frozen.asset.kind !== frozenKind ||
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
    const currentSizeBytes =
      frozen.variant.sizeBytes ??
      (frozen.variant.variantKey === 'original'
        ? frozen.asset.sizeBytes
        : null);
    if (!frozen.variant.contentType.toLowerCase().startsWith(expectedPrefix)) {
      return [
        buildDiagnostic(
          'STORY_BUILD_ASSET_METADATA_CHANGED',
          `${label} no longer matches its frozen playback metadata.`,
          'asset',
          frozen.assetId,
        ),
      ];
    }
    if (
      frozen.variant.checksumSha256 !== frozen.checksumSha256 ||
      frozen.variant.durationMs !== frozen.durationMs ||
      frozen.variant.width !== frozen.width ||
      frozen.variant.height !== frozen.height ||
      frozen.variant.contentType !== frozen.contentType ||
      (frozen.sizeBytes !== null && currentSizeBytes !== frozen.sizeBytes)
    ) {
      return [
        buildWarning(
          'STORY_BUILD_ASSET_METADATA_CHANGED',
          `${label} technical metadata changed after the Build was created; playback identity is unchanged.`,
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
  const referenced = new Set(videoUris);
  if (
    referenced.size === allowed.size &&
    [...referenced].every((uri) => allowed.has(uri))
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
    !Array.isArray(row.reachableTerminalNodeIds) ||
    !row.reachableTerminalNodeIds.every((item) => typeof item === 'string') ||
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

function buildWarning(
  code: string,
  message: string,
  entityType: StoryBuildDiagnosticDto['entityType'],
  entityId: string | null,
): StoryBuildDiagnosticDto {
  return { severity: 'warning', code, message, entityType, entityId };
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

/**
 * Publishability is declared, then verified against the graph.
 *
 * A subgraph Build may be production only when its entry IS a chapter's entry —
 * that is what makes it a whole shippable unit rather than an arbitrary slice
 * of someone's draft. Dropping the old shape-based rule without this check
 * would let any mid-graph node become public content.
 */
async function resolveBuildKind(
  tx: Prisma.TransactionClient,
  projectId: string,
  input: CreateStoryBuildInput,
): Promise<StoryBuildKind> {
  const requested =
    input.kind ??
    (input.scope.kind === 'full'
      ? StoryBuildKind.production
      : StoryBuildKind.preview);
  if (requested === StoryBuildKind.production && input.scope.kind === 'full') {
    // A serial work has no publishable whole-work Build: every chapter reaches
    // its own terminal clip, so composing them into one manifest leaves each later chapter
    // an unreachable scene and compilation fails. Without this the failure
    // surfaces as an unreachable-scene diagnostic, which names a symptom of the
    // graph rather than the reason — that this work publishes one manifest per
    // chapter, via the project release endpoint.
    const chapterCount = await tx.storyChapter.count({
      where: { storyProjectId: projectId, archivedAt: null },
    });
    if (chapterCount > 1) {
      throw new BadRequestException({
        code: 'STORY_BUILD_FULL_SCOPE_MULTI_CHAPTER',
        message: `This work has ${chapterCount} chapters and does not publish as one Build. Build each chapter from its own entry scene, then publish the project.`,
      });
    }
  }
  if (
    requested !== StoryBuildKind.production ||
    input.scope.kind !== 'subgraph'
  ) {
    return requested;
  }
  const chapter = await tx.storyChapter.findFirst({
    where: { storyProjectId: projectId, entryNodeId: input.scope.entryNodeId },
    select: { id: true },
  });
  if (!chapter) {
    throw new BadRequestException({
      code: 'STORY_BUILD_PRODUCTION_SCOPE_NOT_A_CHAPTER',
      message:
        'A production subgraph Build must start at a chapter entry scene. Use a preview Build for any other subgraph.',
    });
  }
  return StoryBuildKind.production;
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

/**
 * 403 for media awaiting the approval policy, 410 for blocked, deleted or no
 * longer exact media — the same answer every Build media read gives.
 */
function throwIfBuildMediaUnavailable(frozen: CurrentBuildMediaRow): void {
  const unavailable = currentMediaDiagnostics(
    [frozen],
    requireModerationApproval(),
  ).find((diagnostic) => diagnostic.severity === 'error');
  if (!unavailable) return;
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
