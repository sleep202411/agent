import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, StoryExperiencePublicationStatus } from '@prisma/client';
import {
  EXPERIENCE_GAME_MANIFEST_SCHEMA_VERSION,
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  ExperienceRuntimeManifestSchema,
  type ExperienceGameChapter,
  type ExperienceReleaseRequest,
  type ExperienceRuntimeManifest,
} from '@repo/shared/experience-runtime';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from './canonical-json';
import type {
  PrepareStoryExperienceReleaseInput,
  StoryBuildDto,
  StoryChapterDto,
  StoryWorkbenchDto,
} from './dto';
import {
  createExperienceGameReleaseRequest,
  createExperienceReleaseRequest,
} from './experience-release-request';
import {
  planStoryChapterRelease,
  StoryChapterReleasePlanError,
  type StoryChapterReleaseCandidate,
} from './story-chapter-release-plan';
import { StoryChapterManifestStorageService } from './story-chapter-manifest-storage.service';
import {
  STORY_BUILD_COMPILER_SEMANTIC_VERSION,
  StoryBuildService,
} from './story-build.service';
import { StoryPermissionService } from './story-permission.service';
import { StoryProjectsService } from './story-projects.service';
import {
  publicationListingSnapshot,
  StoryPublicationListingSnapshotSchema,
  type StoryPublicationListingSnapshot,
} from './story-publication-listing';

const RELEASE_BUILD_CONCURRENCY = 8;
const CHAPTER_MANIFEST_UPLOAD_CONCURRENCY = 16;
// A release Build is replayed by this key, including a failed one. Bump when
// publishability rules change, otherwise the next submit returns the old
// failure and never runs the new compiler.
const RELEASE_BUILD_KEY_VERSION = 4;

interface PreparedChapter {
  chapterId: string;
  rank: number;
  buildId: string;
  runtimeHash: string;
  manifest: ExperienceRuntimeManifest;
}

/**
 * Compiles the current Nest-owned Story Project into one immutable Java release
 * request. Java calls stay in StoryPublicationService: it verifies this frozen
 * receipt, uploads with the current actor's session and submits for moderation.
 */
@Injectable()
export class StoryExperienceReleaseService {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly projects: StoryProjectsService,
    private readonly builds: StoryBuildService,
    private readonly manifests: StoryChapterManifestStorageService,
    private readonly prisma: PrismaService,
  ) {}

  async prepareProjectCandidate(
    user: AuthUser,
    projectId: string,
    input: PrepareStoryExperienceReleaseInput,
  ): Promise<ExperienceReleaseRequest> {
    await this.permissions.requireProject(
      user.userId,
      projectId,
      'story.release',
    );
    const workbench = await this.projects.workbench(user, projectId, {});
    assertExpectedSnapshot(workbench, input);
    const coverUrl = requireReleaseCoverUrl(workbench);
    const listingSnapshot = publicationListingSnapshot(workbench.project);
    await this.projects.requireProjectMediaUseAccess(
      user.userId,
      projectId,
      listingAssetIds(listingSnapshot),
    );

    const chapters = await this.buildCurrentChapters(
      user,
      projectId,
      workbench,
      input,
    );
    const byChapterId = new Map(
      chapters.map((chapter) => [chapter.chapterId, chapter]),
    );
    const byBuildId = new Map(
      chapters.map((chapter) => [chapter.buildId, chapter]),
    );
    const opening = chapters[0];
    const plan = planRelease(
      workbench.chapters.map((chapter) => ({
        chapterId: chapter.id,
        rank: chapter.rank,
        title: chapter.title,
        buildId: byChapterId.get(chapter.id)?.buildId ?? null,
      })),
      opening ? [...opening.manifest.localization.locales] : [],
      (buildId) => {
        const chapter = byBuildId.get(buildId);
        if (!chapter) throw releaseCorrupt(`Build ${buildId} is missing.`);
        return this.manifests.publicUrl({
          projectId,
          buildId,
          runtimeHash: chapter.runtimeHash,
        });
      },
    );

    if (plan.chapters.length === 0) {
      const chapter = byBuildId.get(plan.opening.buildId);
      if (!chapter) throw releaseCorrupt('The opening Build is missing.');
      const request = runtimeReleaseRequest(chapter.manifest, coverUrl);
      await this.authorizeSingleCandidate(
        projectId,
        user.userId,
        chapter.buildId,
        request,
        listingSnapshot,
        input.expectedProjectVersion,
      );
      return request;
    }

    const toc: ExperienceGameChapter[] = plan.chapters.map((entry) => {
      const chapter = byChapterId.get(entry.chapterId);
      if (!chapter) {
        throw releaseCorrupt(
          `Chapter ${entry.chapterId} is missing its Build.`,
        );
      }
      return {
        chapterId: entry.chapterId,
        rank: entry.rank,
        title: entry.title,
        manifestUrl: entry.manifestUrl,
        contentVersion: chapter.manifest.contentVersion,
        manifestHash: chapter.runtimeHash,
      };
    });
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
        status: 'draft',
        setCurrent: true,
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

    await this.uploadChapterManifests(projectId, chapters);
    await this.authorizeGameCandidate(
      projectId,
      user.userId,
      request,
      chapters,
      listingSnapshot,
      input.expectedProjectVersion,
    );
    return request;
  }

  private async buildCurrentChapters(
    user: AuthUser,
    projectId: string,
    workbench: StoryWorkbenchDto,
    input: PrepareStoryExperienceReleaseInput,
  ): Promise<PreparedChapter[]> {
    if (workbench.chapters.length === 0) {
      throw new UnprocessableEntityException({
        code: 'STORY_RELEASE_NO_CHAPTERS',
        message: 'A project needs at least one chapter to submit for review.',
      });
    }

    const singleChapter = workbench.chapters.length === 1;
    for (const chapter of workbench.chapters) {
      if (!singleChapter && !chapter.entryNodeId) {
        throw new UnprocessableEntityException({
          code: 'STORY_RELEASE_CHAPTER_ENTRY_REQUIRED',
          message: `Chapter ${chapter.title} needs an entry scene before the work can be submitted for review.`,
          chapterId: chapter.id,
        });
      }
    }

    const result: PreparedChapter[] = [];
    for (
      let offset = 0;
      offset < workbench.chapters.length;
      offset += RELEASE_BUILD_CONCURRENCY
    ) {
      const batch = workbench.chapters.slice(
        offset,
        offset + RELEASE_BUILD_CONCURRENCY,
      );
      const built = await Promise.all(
        batch.map(async (chapter) => {
          const build = await this.builds.createBuild(
            user,
            projectId,
            {
              expectedDraftRevision: input.expectedDraftRevision,
              expectedVideoSnapshotHash: input.expectedVideoSnapshotHash,
              scope: singleChapter
                ? { kind: 'full' as const }
                : {
                    kind: 'subgraph' as const,
                    entryNodeId: chapter.entryNodeId!,
                  },
              kind: singleChapter ? 'production' : 'preview',
            },
            releaseBuildKey(workbench, input, chapter),
          );
          return preparedChapter(projectId, chapter, build, input);
        }),
      );
      result.push(...built);
    }
    return result;
  }

  private async uploadChapterManifests(
    projectId: string,
    chapters: readonly PreparedChapter[],
  ): Promise<void> {
    for (
      let offset = 0;
      offset < chapters.length;
      offset += CHAPTER_MANIFEST_UPLOAD_CONCURRENCY
    ) {
      await Promise.all(
        chapters
          .slice(offset, offset + CHAPTER_MANIFEST_UPLOAD_CONCURRENCY)
          .map((chapter) =>
            this.manifests.upload(
              {
                projectId,
                buildId: chapter.buildId,
                runtimeHash: chapter.runtimeHash,
              },
              chapter.manifest,
            ),
          ),
      );
    }
  }

  private async authorizeSingleCandidate(
    projectId: string,
    userId: string,
    buildId: string,
    request: ExperienceReleaseRequest,
    listingSnapshot: StoryPublicationListingSnapshot,
    expectedProjectVersion: number,
  ): Promise<void> {
    const requestHash = canonicalJsonHash(request);
    await this.prisma.$transaction(async (tx) => {
      await assertCandidateProjectVersion(
        tx,
        projectId,
        expectedProjectVersion,
      );
      await assertCandidateListingAssets(tx, listingSnapshot);
      await this.projects.requireProjectMediaUseAccess(
        userId,
        projectId,
        listingAssetIds(listingSnapshot),
      );
      const receipt = await tx.storyExperienceDraftRelease.upsert({
        where: { buildId },
        create: {
          buildId,
          storyProjectId: projectId,
          gameId: request.gameId,
          contentVersion: request.contentVersion,
          requestHash,
          listingSnapshot,
          status: StoryExperiencePublicationStatus.pending,
          requestedByUserId: userId,
        },
        update: {
          status: StoryExperiencePublicationStatus.pending,
          requestedByUserId: userId,
          confirmedAt: null,
          rejectedAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          lastErrorAt: null,
        },
      });
      if (
        receipt.storyProjectId !== projectId ||
        receipt.gameId !== request.gameId ||
        receipt.contentVersion !== request.contentVersion ||
        receipt.requestHash !== requestHash ||
        !matchesListingSnapshot(receipt.listingSnapshot, listingSnapshot)
      ) {
        throw releaseCorrupt(
          'The prepared candidate does not match its immutable Build receipt.',
        );
      }
    });
  }

  private async authorizeGameCandidate(
    projectId: string,
    userId: string,
    request: ExperienceReleaseRequest,
    chapters: readonly PreparedChapter[],
    listingSnapshot: StoryPublicationListingSnapshot,
    expectedProjectVersion: number,
  ): Promise<void> {
    const requestHash = canonicalJsonHash(request);
    await this.prisma.$transaction(async (tx) => {
      await assertCandidateProjectVersion(
        tx,
        projectId,
        expectedProjectVersion,
      );
      await assertCandidateListingAssets(tx, listingSnapshot);
      await this.projects.requireProjectMediaUseAccess(
        userId,
        projectId,
        listingAssetIds(listingSnapshot),
      );
      const receipt = await tx.storyExperienceGameRelease.upsert({
        where: {
          storyProjectId_contentVersion: {
            storyProjectId: projectId,
            contentVersion: request.contentVersion,
          },
        },
        create: {
          storyProjectId: projectId,
          gameId: request.gameId,
          contentVersion: request.contentVersion,
          requestHash,
          listingSnapshot,
          status: StoryExperiencePublicationStatus.pending,
          requestedSetCurrent: true,
          requestedByUserId: userId,
          chapters: {
            create: chapters.map((chapter) => {
              const placement = this.manifests.placement({
                projectId,
                buildId: chapter.buildId,
                runtimeHash: chapter.runtimeHash,
              });
              return {
                storyProjectId: projectId,
                storyChapterId: chapter.chapterId,
                buildId: chapter.buildId,
                rank: chapter.rank,
                manifestKey: placement.key,
                manifestUrl: placement.url,
              };
            }),
          },
        },
        update: {
          status: StoryExperiencePublicationStatus.pending,
          requestedByUserId: userId,
          mediaAuthorizationRevokedAt: null,
          rejectedAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          lastErrorAt: null,
        },
        include: { chapters: true },
      });
      const expectedChapters = [...chapters]
        .sort((left, right) => left.rank - right.rank)
        .map(
          (chapter) =>
            `${chapter.chapterId}:${chapter.buildId}:${chapter.rank}`,
        );
      const actualChapters = [...receipt.chapters]
        .sort((left, right) => left.rank - right.rank)
        .map(
          (chapter) =>
            `${chapter.storyChapterId}:${chapter.buildId}:${chapter.rank}`,
        );
      if (
        receipt.gameId !== request.gameId ||
        receipt.requestHash !== requestHash ||
        !matchesListingSnapshot(receipt.listingSnapshot, listingSnapshot) ||
        expectedChapters.join('|') !== actualChapters.join('|')
      ) {
        throw releaseCorrupt(
          'The prepared serial candidate does not match its immutable chapter receipt.',
        );
      }
    });
  }
}

function matchesListingSnapshot(
  stored: Prisma.JsonValue | null,
  expected: StoryPublicationListingSnapshot,
): boolean {
  const parsed = StoryPublicationListingSnapshotSchema.safeParse(stored);
  return (
    parsed.success &&
    canonicalJsonHash(parsed.data) === canonicalJsonHash(expected)
  );
}

function runtimeReleaseRequest(
  manifest: ExperienceRuntimeManifest,
  coverUrl: string,
): ExperienceReleaseRequest {
  const subtitle = manifest.metadata.summary
    ? localizedText(
        manifest.metadata.summary,
        manifest.localization.defaultLocale,
      )
    : undefined;
  return createExperienceReleaseRequest(
    {
      gameId: manifest.gameId,
      contentVersion: manifest.contentVersion,
      title: localizedText(
        manifest.metadata.title,
        manifest.localization.defaultLocale,
      ),
      ...(subtitle ? { subtitle } : {}),
      coverUrl,
      status: 'draft',
      setCurrent: true,
    },
    manifest,
  );
}

function publishDiagnosticNodeId(diagnostic: {
  entityType: string | null;
  entityId: string | null;
}): string | null {
  if (
    (diagnostic.entityType === 'node' || diagnostic.entityType === 'clip') &&
    diagnostic.entityId?.includes(':')
  ) {
    return diagnostic.entityId;
  }
  return null;
}

function requireReleaseCoverUrl(workbench: StoryWorkbenchDto): string {
  const coverUrl = workbench.project.cover?.previewUrl?.trim();
  if (coverUrl) return coverUrl;
  throw new UnprocessableEntityException({
    code: 'STORY_RELEASE_COVER_REQUIRED',
    message:
      'Select a ready project cover before submitting this work for review.',
  });
}

function preparedChapter(
  projectId: string,
  chapter: Pick<StoryChapterDto, 'id' | 'rank' | 'title'>,
  build: StoryBuildDto,
  expected: PrepareStoryExperienceReleaseInput,
): PreparedChapter {
  if (
    build.status !== 'ready' ||
    !build.runtimeJson ||
    !build.runtimeHash ||
    !build.completedAt ||
    build.sourceDraftRevision !== expected.expectedDraftRevision ||
    build.videoSnapshotHash !== expected.expectedVideoSnapshotHash ||
    build.runtimeSchemaVersion !== EXPERIENCE_RUNTIME_SCHEMA_VERSION ||
    build.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
  ) {
    const diagnostics = build.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error')
      .map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        nodeId: publishDiagnosticNodeId(diagnostic),
      }));
    throw new UnprocessableEntityException({
      code: 'STORY_BUILD_NOT_PUBLISHABLE',
      message:
        diagnostics[0]?.message ??
        (build.status === 'failed'
          ? `“${chapter.title}” could not be prepared for review.`
          : build.status === 'ready'
            ? `“${chapter.title}” changed before it could be submitted. Refresh and submit again.`
            : `“${chapter.title}” is still being prepared for review.`),
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      diagnostics,
    });
  }
  const parsed = ExperienceRuntimeManifestSchema.safeParse(build.runtimeJson);
  if (!parsed.success) {
    throw releaseCorrupt(`Chapter Build ${build.id} has an invalid manifest.`);
  }
  const manifest = parsed.data;
  if (
    manifest.buildId !== build.id ||
    manifest.gameId !== projectId ||
    manifest.contentVersion !== build.id ||
    canonicalJsonHash(manifest) !== build.runtimeHash
  ) {
    throw releaseCorrupt(
      `Chapter Build ${build.id} has a mismatched manifest identity.`,
    );
  }
  return {
    chapterId: chapter.id,
    rank: chapter.rank,
    buildId: build.id,
    runtimeHash: build.runtimeHash,
    manifest,
  };
}

function assertExpectedSnapshot(
  workbench: StoryWorkbenchDto,
  expected: PrepareStoryExperienceReleaseInput,
): void {
  if (
    workbench.project.projectVersion === expected.expectedProjectVersion &&
    workbench.draft.revision === expected.expectedDraftRevision &&
    workbench.video.snapshotHash === expected.expectedVideoSnapshotHash
  ) {
    return;
  }
  throw new ConflictException({
    code: 'STORY_RELEASE_SNAPSHOT_CONFLICT',
    message:
      'The project changed before its review candidate was prepared. Refresh and submit the latest version.',
  });
}

function releaseBuildKey(
  workbench: StoryWorkbenchDto,
  input: PrepareStoryExperienceReleaseInput,
  chapter: Pick<StoryChapterDto, 'id'>,
): string {
  return `story-review:v${RELEASE_BUILD_KEY_VERSION}:${canonicalJsonHash({
    compiler: STORY_BUILD_COMPILER_SEMANTIC_VERSION,
    projectId: workbench.project.id,
    projectVersion: workbench.project.projectVersion,
    draftRevision: input.expectedDraftRevision,
    videoSnapshotHash: input.expectedVideoSnapshotHash,
    chapterId: chapter.id,
  })}`;
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

function localizedText(
  value: Record<string, string>,
  defaultLocale: string,
): string {
  return value[defaultLocale] ?? Object.values(value)[0];
}

function releaseCorrupt(message: string): ConflictException {
  return new ConflictException({
    code: 'STORY_RELEASE_CANDIDATE_CORRUPT',
    message,
  });
}

/** Lock the project while admitting its immutable introduction receipt. */
async function assertCandidateProjectVersion(
  tx: Prisma.TransactionClient,
  projectId: string,
  expectedProjectVersion: number,
): Promise<void> {
  const rows = await tx.$queryRaw<{ version: number }[]>(Prisma.sql`
    SELECT version FROM story_projects
    WHERE id = ${projectId}::uuid AND status = 'active' AND archived_at IS NULL
    FOR SHARE
  `);
  if (rows[0]?.version !== expectedProjectVersion) {
    throw new ConflictException({
      code: 'STORY_RELEASE_SNAPSHOT_CONFLICT',
      message:
        'The project introduction changed while its review candidate was being prepared. Refresh and submit the latest version.',
    });
  }
}

async function assertCandidateListingAssets(
  tx: Prisma.TransactionClient,
  snapshot: StoryPublicationListingSnapshot,
): Promise<void> {
  const expected = new Map<string, 'image' | 'video'>([
    [snapshot.coverAssetId, 'image'],
    ...snapshot.listing.screenshotAssetIds.map((id) => [id, 'image'] as const),
    ...(snapshot.listing.trailerAssetId
      ? [[snapshot.listing.trailerAssetId, 'video'] as const]
      : []),
  ]);
  const assets = await tx.mediaAsset.findMany({
    where: {
      id: { in: [...expected.keys()] },
      status: 'ready',
      moderationStatus: { not: 'blocked' },
      deletedAt: null,
    },
    select: { id: true, kind: true },
  });
  const actual = new Map(assets.map((asset) => [asset.id, asset.kind]));
  const unavailable = [...expected].find(
    ([id, kind]) => actual.get(id) !== kind,
  );
  if (unavailable) {
    throw new UnprocessableEntityException({
      code: 'STORY_RELEASE_INTRODUCTION_MEDIA_INVALID',
      message:
        'The cover, trailer and screenshots must be ready, available assets before submitting for review.',
      assetId: unavailable[0],
    });
  }
}

function listingAssetIds(snapshot: StoryPublicationListingSnapshot): string[] {
  return [
    snapshot.coverAssetId,
    ...snapshot.listing.screenshotAssetIds,
    ...(snapshot.listing.trailerAssetId
      ? [snapshot.listing.trailerAssetId]
      : []),
  ];
}
