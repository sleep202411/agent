import {
  ConflictException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StoryBuildStatus } from '@prisma/client';
import {
  EXPERIENCE_GAME_MANIFEST_SCHEMA_VERSION,
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  ExperienceRuntimeManifestSchema,
  type ExperienceGameChapter,
  type ExperienceReleaseResponse,
  type ExperienceRuntimeManifest,
} from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { JAVA_REQUEST_TIMEOUT_MS } from '../integrations/java/java-config';
import { canonicalJsonHash } from './canonical-json';
import type { PublishStoryProjectInput } from './dto';
import {
  createExperienceGameReleaseRequest,
  experienceReleaseCoverUrl,
  type VerifiedExperienceGameReleaseRequest,
} from './experience-release-request';
import { StoryBuildScopeSchema } from './interactive-film.schema';
import {
  planStoryChapterRelease,
  StoryChapterReleasePlanError,
  type StoryChapterReleaseCandidate,
} from './story-chapter-release-plan';
import {
  StoryChapterManifestStorageService,
  type StoryChapterManifestPlacement,
} from './story-chapter-manifest-storage.service';
import { storyExperiencePublicationClock } from './story-experience-publication-clock';
import {
  isStoryExperienceReleaseOutcomeUnknown,
  StoryExperienceReleaseGateway,
} from './story-experience-release.gateway';
import { StoryExperienceReleaseService } from './story-experience-release.service';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectWriteGuardService } from './story-project-write-guard.service';

const GAME_RELEASE_LEASE_TTL_MS = JAVA_REQUEST_TIMEOUT_MS + 20_000;

type GameReleaseStatus = 'pending' | 'confirmed' | 'uncertain' | 'rejected';

interface GameReleaseSnapshot {
  id: string;
  storyProjectId: string;
  gameId: string;
  contentVersion: string;
  requestHash: string;
  status: GameReleaseStatus;
  requestedSetCurrent: boolean;
  manifestUrl: string | null;
  publishedAt: Date | null;
  attemptCount: number;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

type GameReleaseClaim =
  | { kind: 'claimed'; row: GameReleaseSnapshot; leaseOwner: string }
  | { kind: 'confirmed'; row: GameReleaseSnapshot }
  | { kind: 'rejected'; row: GameReleaseSnapshot }
  | { kind: 'busy'; row: GameReleaseSnapshot; retryAfter: Date };

/** One chapter, resolved from its newest shippable Build. */
interface ChapterRelease {
  chapterId: string;
  rank: number;
  buildId: string;
  runtimeHash: string;
  manifest: ExperienceRuntimeManifest;
}

/**
 * Publishing a whole work rather than one Build.
 *
 * A single-chapter work is still one manifest and is delegated, unchanged, to
 * the Build publication lifecycle. A multi-chapter work publishes each chapter
 * manifest as its own object and hands Java the Game Manifest listing them,
 * because chapters end in endings and cannot be composed into one manifest.
 *
 * ## Where this lifecycle is deliberately weaker than the Build one
 *
 * A lost Java response leaves a row `uncertain`, and re-publishing the same
 * chapter set replays the identical immutable request and settles it. What this
 * service does NOT do is what `StoryExperienceReleaseService` does: refuse a
 * new publish while an earlier one is unsettled, and reconcile it by asking
 * Java for the authoritative state (`authorityCheckedAt` /
 * `nextReconciliationAt`, neither of which exists here). So a creator can
 * publish a different chapter set — a new `contentVersion`, hence a new row —
 * while an earlier one stays unknown indefinitely.
 *
 * That is a choice, not an oversight. Copying the Build path's fence would soft
 * lock publishing: an `uncertain` row is settled only by reproducing its exact
 * `contentVersion`, and once any chapter is rebuilt that content version can
 * never be produced again, so an old ambiguous release would block every future
 * one with no operator remedy.
 *
 * What is accepted instead: a stale `uncertain` row is a bookkeeping gap, not a
 * live actor. Nothing here ever re-sends it on its own — it is replayed only
 * when an operator publishes that same chapter set again — so our side does not
 * push an old release at players. Whether Java itself still serves an earlier
 * version is Java's decision about `setCurrent`, which this codebase treats as
 * an external API and does not model. Closing this properly means reconciling
 * against Java's authority rather than fencing on ours.
 */
@Injectable()
export class StoryGameReleaseService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly releases: StoryExperienceReleaseService,
    private readonly gateway: StoryExperienceReleaseGateway,
    private readonly prisma: PrismaService,
    private readonly writeGuard: StoryProjectWriteGuardService,
    private readonly manifests: StoryChapterManifestStorageService,
  ) {}

  async publishProject(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PublishStoryProjectInput,
    viewerCookie: string,
  ): Promise<ExperienceReleaseResponse> {
    const access = await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    if (access.project.workspaceId !== workspaceId) throw scopeMismatch();

    const chapters = await this.resolveChapters(projectId);
    const plan = planRelease(chapters.candidates, chapters.locales, (buildId) =>
      this.manifests.publicUrl({
        projectId,
        buildId,
        runtimeHash: chapters.byBuildId.get(buildId)!.runtimeHash,
      }),
    );

    if (plan.chapters.length === 0) {
      // One shippable chapter is one manifest, which is exactly what the Build
      // publication lifecycle already releases. Delegating keeps a
      // single-chapter work byte-identical to how it publishes today.
      return this.releases.publishBuild(
        user,
        workspaceId,
        projectId,
        plan.opening.buildId,
        { status: 'published', setCurrent: input.setCurrent },
        viewerCookie,
      );
    }

    const opening = chapters.byBuildId.get(plan.opening.buildId)!;
    const toc: ExperienceGameChapter[] = plan.chapters.map((entry) => {
      const chapter = chapters.byChapterId.get(entry.chapterId)!;
      return {
        chapterId: entry.chapterId,
        rank: entry.rank,
        title: entry.title,
        manifestUrl: entry.manifestUrl,
        contentVersion: chapter.manifest.contentVersion,
        manifestHash: chapter.runtimeHash,
      };
    });
    // The chapter set IS the release identity: a rebuilt or newly finished
    // chapter changes this hash, so Java's immutable
    // (gameId, contentVersion) pair lands on a new release rather than
    // silently re-serving the previous table of contents.
    const contentVersion = canonicalJsonHash({
      gameId: projectId,
      chapters: toc,
    });
    const subtitle = opening.manifest.metadata.summary
      ? localizedText(
          opening.manifest.metadata.summary,
          opening.manifest.localization.defaultLocale,
        )
      : undefined;
    const coverUrl = experienceReleaseCoverUrl(opening.manifest);
    const request = createExperienceGameReleaseRequest(
      {
        gameId: projectId,
        contentVersion,
        title: localizedText(
          opening.manifest.metadata.title,
          opening.manifest.localization.defaultLocale,
        ),
        ...(subtitle ? { subtitle } : {}),
        ...(coverUrl ? { coverUrl } : {}),
        status: 'published',
        setCurrent: input.setCurrent,
      },
      {
        manifestType: 'fizzdragon.experience-game',
        schemaVersion: EXPERIENCE_GAME_MANIFEST_SCHEMA_VERSION,
        gameId: projectId,
        contentVersion,
        defaultLocale: opening.manifest.localization.defaultLocale,
        chapters: toc,
      },
    );

    return this.publishGameRelease(
      request,
      projectId,
      user.userId,
      plan.chapters.map((entry) => chapters.byChapterId.get(entry.chapterId)!),
      viewerCookie,
    );
  }

  private async publishGameRelease(
    request: VerifiedExperienceGameReleaseRequest,
    projectId: string,
    userId: string,
    chapters: readonly ChapterRelease[],
    viewerCookie: string,
  ): Promise<ExperienceReleaseResponse> {
    const placements = chapters.map((chapter) => ({
      chapter,
      key: this.manifests.placement({
        projectId,
        buildId: chapter.buildId,
        runtimeHash: chapter.runtimeHash,
      }),
    }));
    const claim = await this.claimGameRelease({
      projectId,
      userId,
      request,
      chapters: placements,
    });
    if (claim.kind === 'confirmed') return releaseFromRow(claim.row);
    if (claim.kind === 'rejected') throw storedRejection(claim.row);
    if (claim.kind === 'busy') throw releaseInProgress(claim);

    // Uploaded after the durable receipt exists, so a Java fetch can never
    // reach a manifest whose media authorization was not recorded first.
    for (const placement of placements) {
      // The upload's URL is deliberately not compared against the published
      // one: the key is a pure function of (projectId, buildId, runtimeHash)
      // and `upload` mints its URL from that same function, so a mismatch is
      // unrepresentable rather than merely unlikely. Such a check would read as
      // an assurance about where the object really landed, which it cannot give
      // — the provider's own result URL is not what the manifest published.
      // What does guard the bytes is `upload` refusing a manifest that does not
      // hash to the runtimeHash its key is addressed by.
      await this.manifests.upload(
        {
          projectId,
          buildId: placement.chapter.buildId,
          runtimeHash: placement.chapter.runtimeHash,
        },
        placement.chapter.manifest,
      );
    }

    let release: ExperienceReleaseResponse;
    try {
      release = await this.gateway.publish(request, viewerCookie);
    } catch (error) {
      // Identical posture to the Build publication path: only a lost response
      // is ambiguous, and it is settled once, here, by asking Java what it
      // actually serves rather than leaving it to a background poller.
      if (isStoryExperienceReleaseOutcomeUnknown(error)) {
        const settled = await this.settleUncertainPublish(claim, request);
        if (settled) return settled;
      }
      await this.recordPublishFailure(claim, error);
      throw error;
    }

    await this.confirmGameRelease(claim, release);
    return release;
  }

  private async claimGameRelease(input: {
    projectId: string;
    userId: string;
    request: VerifiedExperienceGameReleaseRequest;
    chapters: readonly {
      chapter: ChapterRelease;
      key: StoryChapterManifestPlacement;
    }[];
  }): Promise<GameReleaseClaim> {
    const leaseOwner = `game-release:${process.pid}:${randomUUID()}`;
    const requestHash = canonicalJsonHash(input.request);
    return this.prisma.$transaction(async (tx) => {
      await this.writeGuard.assertHumanWriteAllowed(tx, input.projectId);
      // Takes the same per-project advisory lock the Build publication
      // lifecycle takes, which serialises CLAIMS: two concurrent releases of
      // this project cannot both create a row or both acquire a lease.
      //
      // It is NOT a fence across the whole publish. The lock is
      // transaction-scoped, so it is gone once this claim commits, and the
      // uploads and `gateway.publish` run after it. A Build publication started
      // in that window is invisible to us (we read only
      // `story_experience_game_releases`) and we are invisible to it (its
      // competing-rows query reads only `story_experience_publications`), so
      // both can be in flight for one project and whichever lands last decides
      // what Java serves as current. Accepted for now because publishing is a
      // deliberate operator action on a work the operator owns, not a
      // concurrent path; closing it means a competing-lease check across BOTH
      // tables in BOTH claim paths.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(${`story-experience-publication:${input.projectId}`})::bigint
        )
      `;
      const now = await storyExperiencePublicationClock(tx);
      const existing = await tx.storyExperienceGameRelease.findUnique({
        where: {
          storyProjectId_contentVersion: {
            storyProjectId: input.projectId,
            contentVersion: input.request.contentVersion,
          },
        },
      });
      if (existing) {
        assertGameReleaseIdentity(existing, {
          gameId: input.request.gameId,
          requestHash,
          requestedSetCurrent: input.request.setCurrent,
        });
        if (existing.status === 'confirmed') {
          return {
            kind: 'confirmed' as const,
            row: gameReleaseSnapshot(existing),
          };
        }
        if (existing.status === 'rejected') {
          return {
            kind: 'rejected' as const,
            row: gameReleaseSnapshot(existing),
          };
        }
        if (
          existing.leaseExpiresAt &&
          existing.leaseExpiresAt.getTime() > now.getTime()
        ) {
          return {
            kind: 'busy' as const,
            row: gameReleaseSnapshot(existing),
            retryAfter: existing.leaseExpiresAt,
          };
        }
      }

      const row =
        existing ??
        (await tx.storyExperienceGameRelease.create({
          data: {
            storyProjectId: input.projectId,
            gameId: input.request.gameId,
            contentVersion: input.request.contentVersion,
            requestHash,
            requestedSetCurrent: input.request.setCurrent,
            requestedByUserId: input.userId,
            // One clock read per operation, stamped onto every lifecycle
            // field, so a column default evaluated later in the transaction
            // cannot land after the attempt timestamps.
            mediaAuthorizedAt: now,
            createdAt: now,
            updatedAt: now,
            chapters: {
              create: input.chapters.map(({ chapter, key }) => ({
                storyProjectId: input.projectId,
                storyChapterId: chapter.chapterId,
                buildId: chapter.buildId,
                rank: chapter.rank,
                manifestKey: key.key,
                manifestUrl: key.url,
                createdAt: now,
              })),
            },
          },
        }));

      const recoveringCrashedAttempt =
        row.status === 'pending' && row.attemptCount > 0;
      const claimed = await tx.storyExperienceGameRelease.update({
        where: { id: row.id },
        data: {
          ...(recoveringCrashedAttempt
            ? {
                status: 'uncertain' as const,
                lastErrorCode: 'STORY_GAME_RELEASE_CRASH_RECOVERY',
                lastErrorDetail:
                  'Recovered a game release whose process stopped before recording the Java outcome; replaying the exact immutable request.',
                lastErrorAt: now,
              }
            : {}),
          attemptCount: { increment: 1 },
          firstAttemptAt: row.firstAttemptAt ?? now,
          lastAttemptAt: now,
          lastAttemptedByUserId: input.userId,
          nextAttemptAt: null,
          leaseOwner,
          leaseAcquiredAt: now,
          leaseExpiresAt: new Date(now.getTime() + GAME_RELEASE_LEASE_TTL_MS),
        },
      });
      return {
        kind: 'claimed' as const,
        row: gameReleaseSnapshot(claimed),
        leaseOwner,
      };
    });
  }

  private async confirmGameRelease(
    claim: Extract<GameReleaseClaim, { kind: 'claimed' }>,
    release: ExperienceReleaseResponse,
  ): Promise<void> {
    if (
      release.status !== 'published' ||
      release.gameId !== claim.row.gameId ||
      release.contentVersion !== claim.row.contentVersion
    ) {
      throw new ConflictException({
        code: 'STORY_GAME_RELEASE_ACKNOWLEDGEMENT_MISMATCH',
        message:
          'Java release acknowledgement does not match the published chapter set.',
      });
    }
    const now = await storyExperiencePublicationClock(this.prisma);
    const updated = await this.prisma.storyExperienceGameRelease.updateMany({
      where: {
        id: claim.row.id,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'confirmed',
        manifestUrl: release.manifestUrl,
        publishedAt: now,
        leaseOwner: null,
        leaseAcquiredAt: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        lastErrorAt: null,
      },
    });
    if (updated.count === 1) return;

    const stored = await this.prisma.storyExperienceGameRelease.findUnique({
      where: { id: claim.row.id },
    });
    if (stored?.status === 'confirmed') {
      assertAcknowledgement(stored, release);
      return;
    }
    throw new ConflictException({
      code: 'STORY_GAME_RELEASE_LEASE_LOST',
      message:
        'Game release ownership expired before the Java acknowledgement could be stored.',
    });
  }

  /**
   * Resolves a lost publish response by asking Java what it actually serves,
   * exactly as the Build publication path does. Returns null when Java is not
   * serving this contentVersion or cannot be reached, so the creator simply
   * publishes again.
   */
  private async settleUncertainPublish(
    claim: Extract<GameReleaseClaim, { kind: 'claimed' }>,
    request: VerifiedExperienceGameReleaseRequest,
  ): Promise<ExperienceReleaseResponse | null> {
    let game: Awaited<ReturnType<typeof this.gateway.getGame>> = null;
    try {
      game = await this.gateway.getGame(request.gameId);
    } catch {
      return null;
    }
    if (!game || game.currentVersion !== request.contentVersion) return null;
    const release: ExperienceReleaseResponse = {
      gameId: game.gameId,
      contentVersion: game.currentVersion,
      status: 'published',
      manifestUrl: game.manifestUrl,
    };
    await this.confirmGameRelease(claim, release);
    return release;
  }

  private async recordPublishFailure(
    claim: Extract<GameReleaseClaim, { kind: 'claimed' }>,
    error: unknown,
  ): Promise<void> {
    const now = await storyExperiencePublicationClock(this.prisma);
    const detail = errorDetail(error);
    if (
      !isStoryExperienceReleaseOutcomeUnknown(error) &&
      claim.row.status === 'pending'
    ) {
      await this.prisma.storyExperienceGameRelease.updateMany({
        where: {
          id: claim.row.id,
          leaseOwner: claim.leaseOwner,
          status: 'pending',
        },
        data: {
          status: 'rejected',
          rejectedAt: now,
          mediaAuthorizationRevokedAt: now,
          leaseOwner: null,
          leaseAcquiredAt: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: detail.code,
          lastErrorDetail: detail.message,
          lastErrorAt: now,
        },
      });
      return;
    }

    // An unknown outcome, and any rejection observed after an earlier unknown
    // outcome, keep their media authorization: Java may already be serving
    // this Game Manifest, and revoking would break a live release.
    await this.prisma.storyExperienceGameRelease.updateMany({
      where: {
        id: claim.row.id,
        leaseOwner: claim.leaseOwner,
        status: { in: ['pending', 'uncertain'] },
      },
      data: {
        status: 'uncertain',
        lastErrorCode: detail.code,
        lastErrorDetail: detail.message,
        lastErrorAt: now,
      },
    });
  }

  /**
   * Every chapter of the project with its newest shippable Build, plus the
   * release locales taken from the manifest of the chapter the work opens on.
   */
  private async resolveChapters(projectId: string): Promise<{
    candidates: StoryChapterReleaseCandidate[];
    locales: string[];
    byChapterId: Map<string, ChapterRelease>;
    byBuildId: Map<string, ChapterRelease>;
  }> {
    const chapters = await this.prisma.storyChapter.findMany({
      where: { storyProjectId: projectId, archivedAt: null },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, rank: true, entryNodeId: true },
    });
    if (chapters.length === 0) {
      throw new UnprocessableEntityException({
        code: 'STORY_RELEASE_NO_CHAPTERS',
        message: 'A project needs at least one chapter to publish.',
      });
    }
    const builds = await this.prisma.storyBuild.findMany({
      where: {
        storyProjectId: projectId,
        status: StoryBuildStatus.ready,
        runtimeSchemaVersion: EXPERIENCE_RUNTIME_SCHEMA_VERSION,
      },
      orderBy: [{ buildNumber: 'desc' }, { id: 'desc' }],
      select: { id: true, scope: true },
    });

    const soleChapter = chapters.length === 1;
    const buildIdByChapterId = new Map<string, string>();
    for (const chapter of chapters) {
      const match = builds.find((build) => {
        const scope = StoryBuildScopeSchema.safeParse(build.scope);
        if (!scope.success) return false;
        // A whole-work Build can only stand in for a chapter when that chapter
        // IS the whole work; otherwise a chapter ships only from a Build that
        // starts at its own entry scene.
        if (scope.data.kind === 'full') return soleChapter;
        return scope.data.entryNodeId === chapter.entryNodeId;
      });
      if (match) buildIdByChapterId.set(chapter.id, match.id);
    }

    const releases = await this.loadChapterReleases(
      projectId,
      chapters,
      buildIdByChapterId,
    );
    const byChapterId = new Map(
      releases.map((release) => [release.chapterId, release]),
    );
    const byBuildId = new Map(
      releases.map((release) => [release.buildId, release]),
    );
    // Release locales come from the frozen manifest of the chapter the work
    // opens on, so the generated chapter titles cover exactly the locales the
    // chapters themselves ship.
    const openingChapter = chapters.find((chapter) =>
      byChapterId.has(chapter.id),
    );
    const opening = openingChapter
      ? byChapterId.get(openingChapter.id)
      : undefined;
    return {
      candidates: chapters.map((chapter) => ({
        chapterId: chapter.id,
        rank: chapter.rank,
        title: chapter.title,
        buildId: buildIdByChapterId.get(chapter.id) ?? null,
      })),
      locales: opening ? [...opening.manifest.localization.locales] : [],
      byChapterId,
      byBuildId,
    };
  }

  private async loadChapterReleases(
    projectId: string,
    chapters: readonly { id: string; rank: number }[],
    buildIdByChapterId: ReadonlyMap<string, string>,
  ): Promise<ChapterRelease[]> {
    const buildIds = [...buildIdByChapterId.values()];
    if (buildIds.length === 0) return [];
    const rows = await this.prisma.storyBuild.findMany({
      where: { storyProjectId: projectId, id: { in: buildIds } },
      select: {
        id: true,
        runtimeJson: true,
        runtimeHash: true,
        diagnostics: true,
        sourceDraftRevision: true,
        videoSnapshotHash: true,
        completedAt: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return chapters.flatMap((chapter) => {
      const buildId = buildIdByChapterId.get(chapter.id);
      if (!buildId) return [];
      const build = byId.get(buildId);
      if (!build) return [];
      return [
        {
          chapterId: chapter.id,
          rank: chapter.rank,
          buildId,
          runtimeHash: build.runtimeHash!,
          manifest: verifyChapterBuild(projectId, build),
        },
      ];
    });
  }
}

/**
 * The frozen manifest of one chapter Build, verified to be publishable.
 *
 * Deliberately does not require `channel === 'production'`: a chapter Build is
 * a subgraph, and `story_builds_production_scope_chk` admits only full-scope
 * Builds as `production`, so a chapter compiles on the preview channel. The
 * checks that matter for shipping — ready, Runtime Manifest v2, error-free, and
 * hashing to its own immutable identity — are all enforced here.
 */
function verifyChapterBuild(
  projectId: string,
  build: {
    id: string;
    runtimeJson: unknown;
    runtimeHash: string | null;
    diagnostics: unknown;
    sourceDraftRevision: number;
    videoSnapshotHash: string;
    completedAt: Date | null;
  },
): ExperienceRuntimeManifest {
  const diagnostics = Array.isArray(build.diagnostics) ? build.diagnostics : [];
  if (
    !build.runtimeJson ||
    !build.runtimeHash ||
    !build.completedAt ||
    !Number.isInteger(build.sourceDraftRevision) ||
    build.sourceDraftRevision < 0 ||
    !/^[a-f0-9]{64}$/.test(build.videoSnapshotHash) ||
    diagnostics.some(
      (diagnostic) =>
        (diagnostic as { severity?: unknown } | null)?.severity === 'error',
    )
  ) {
    throw new UnprocessableEntityException({
      code: 'STORY_CHAPTER_BUILD_NOT_PUBLISHABLE',
      message: `Chapter Build ${build.id} is not a completed error-free Runtime Manifest v2 Build.`,
    });
  }
  const parsed = ExperienceRuntimeManifestSchema.safeParse(build.runtimeJson);
  if (!parsed.success) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_BUILD_MANIFEST_CORRUPT',
      message: `Chapter Build ${build.id} does not contain a valid Runtime Manifest v2.`,
    });
  }
  const manifest = parsed.data;
  if (
    manifest.buildId !== build.id ||
    manifest.gameId !== projectId ||
    manifest.contentVersion !== build.id ||
    canonicalJsonHash(manifest) !== build.runtimeHash
  ) {
    throw new ConflictException({
      code: 'STORY_CHAPTER_BUILD_MANIFEST_IDENTITY_MISMATCH',
      message: `Chapter Build ${build.id} has a frozen manifest identity or hash that does not match its Build.`,
    });
  }
  return manifest;
}

function planRelease(
  candidates: readonly StoryChapterReleaseCandidate[],
  locales: readonly string[],
  manifestUrl: (buildId: string) => string,
) {
  try {
    return planStoryChapterRelease(candidates, { locales, manifestUrl });
  } catch (error) {
    if (error instanceof StoryChapterReleasePlanError) {
      throw new UnprocessableEntityException({
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}

function gameReleaseSnapshot(row: {
  id: string;
  storyProjectId: string;
  gameId: string;
  contentVersion: string;
  requestHash: string;
  status: GameReleaseStatus;
  requestedSetCurrent: boolean;
  manifestUrl: string | null;
  publishedAt: Date | null;
  attemptCount: number;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}): GameReleaseSnapshot {
  return {
    id: row.id,
    storyProjectId: row.storyProjectId,
    gameId: row.gameId,
    contentVersion: row.contentVersion,
    requestHash: row.requestHash,
    status: row.status,
    requestedSetCurrent: row.requestedSetCurrent,
    manifestUrl: row.manifestUrl,
    publishedAt: row.publishedAt,
    attemptCount: row.attemptCount,
    leaseExpiresAt: row.leaseExpiresAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorDetail: row.lastErrorDetail,
  };
}

function assertGameReleaseIdentity(
  row: { gameId: string; requestHash: string; requestedSetCurrent: boolean },
  input: {
    gameId: string;
    requestHash: string;
    requestedSetCurrent: boolean;
  },
): void {
  if (
    row.gameId !== input.gameId ||
    row.requestHash !== input.requestHash ||
    row.requestedSetCurrent !== input.requestedSetCurrent
  ) {
    throw new ConflictException({
      code: 'STORY_GAME_RELEASE_RECEIPT_CONFLICT',
      message:
        'The durable game release identity does not match this exact chapter set request.',
    });
  }
}

function assertAcknowledgement(
  row: { gameId: string; contentVersion: string; manifestUrl: string | null },
  release: ExperienceReleaseResponse,
): void {
  if (
    row.gameId !== release.gameId ||
    row.contentVersion !== release.contentVersion ||
    row.manifestUrl !== release.manifestUrl
  ) {
    throw new ConflictException({
      code: 'STORY_GAME_RELEASE_RECEIPT_CONFLICT',
      message:
        'The stored Java acknowledgement does not match this game release.',
    });
  }
}

function releaseFromRow(row: GameReleaseSnapshot): ExperienceReleaseResponse {
  if (!row.manifestUrl || !row.publishedAt) {
    throw new ConflictException({
      code: 'STORY_GAME_RELEASE_CORRUPT',
      message: 'Confirmed game release acknowledgement is incomplete.',
    });
  }
  return {
    gameId: row.gameId,
    contentVersion: row.contentVersion,
    status: 'published',
    manifestUrl: row.manifestUrl,
  };
}

function storedRejection(row: GameReleaseSnapshot): ConflictException {
  return new ConflictException({
    code: row.lastErrorCode ?? 'STORY_GAME_RELEASE_REJECTED',
    message:
      row.lastErrorDetail ??
      'Java definitively rejected this immutable game release.',
  });
}

function releaseInProgress(
  claim: Extract<GameReleaseClaim, { kind: 'busy' }>,
): ConflictException {
  return new ConflictException({
    code: 'STORY_GAME_RELEASE_IN_PROGRESS',
    message: 'This exact game release is still being resolved with Java.',
    contentVersion: claim.row.contentVersion,
    retryAfter: claim.retryAfter.toISOString(),
  });
}

function scopeMismatch(): ConflictException {
  return new ConflictException({
    code: 'STORY_PROJECT_SCOPE_MISMATCH',
    message: 'Story project does not belong to the active workspace.',
  });
}

function errorDetail(error: unknown): { code: string | null; message: string } {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object') {
      const value = response as { code?: unknown; message?: unknown };
      return {
        code: typeof value.code === 'string' ? value.code : null,
        message:
          typeof value.message === 'string'
            ? value.message
            : error.message || 'Java game release failed.',
      };
    }
    if (typeof response === 'string') return { code: null, message: response };
  }
  return {
    code: null,
    message:
      error instanceof Error ? error.message : 'Java game release failed.',
  };
}

function localizedText(
  value: Record<string, string>,
  defaultLocale: string,
): string {
  return value[defaultLocale] ?? Object.values(value)[0];
}
