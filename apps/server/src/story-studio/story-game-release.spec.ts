import {
  ExperienceRuntimeManifestSchema,
  type ExperienceGameManifest,
  type ExperienceReleaseRequest,
  type ExperienceRuntimeManifest,
} from '@repo/shared/experience-runtime';
import { MediaAssetUrlResolverService } from '../infra/storage/media-asset-url-resolver.service';
import { canonicalJsonHash, canonicalJsonString } from './canonical-json';
import {
  StoryChapterManifestStorageService,
  storyChapterManifestKey,
} from './story-chapter-manifest-storage.service';
import { StoryExperienceReleaseOutcomeUnknownException } from './story-experience-release.gateway';
import { StoryExperienceReleaseService } from './story-experience-release.service';
import { StoryGameReleaseService } from './story-game-release.service';

const PROJECT_ID = '019f993d-aecc-7020-b59f-3fec0fb7bfc6';
const WORKSPACE_ID = '019f60f4-b101-70d4-8000-000000000003';
const PROLOGUE_BUILD_ID = '019f60f4-b101-70d4-8000-00000000a001';
const CHAPTER_ONE_BUILD_ID = '019f60f4-b101-70d4-8000-00000000a002';
const WHOLE_WORK_BUILD_ID = '019f60f4-b101-70d4-8000-00000000a003';
const PROLOGUE_CHAPTER_ID = '019f60f4-b101-70d4-8000-00000000c001';
const CHAPTER_ONE_CHAPTER_ID = '019f60f4-b101-70d4-8000-00000000c002';
const HASH = 'a'.repeat(64);
const PUBLIC_BASE_URL = 'https://r2.fizzdragon.com';
const JAVA_MANIFEST_URL =
  'https://cdn.java.test/interactive-film/manifest.json';

function manifestFixture(
  buildId: string,
  entrySceneId: string,
  // A chapter Build is a subgraph, which the production-scope constraint keeps
  // on the preview channel; a whole-work Build is production.
  channel: 'preview' | 'production' = 'preview',
): ExperienceRuntimeManifest {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: 'fizzdragon.experience',
    schemaVersion: 2,
    channel,
    gameId: PROJECT_ID,
    buildId,
    contentVersion: buildId,
    completionPolicy: 'finite',
    metadata: {
      title: { 'zh-CN': '入梦金陵', 'en-US': 'Dream of Jinling' },
      summary: { 'zh-CN': '第一季', 'en-US': 'Season one' },
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1,
      requiredCapabilities: ['core.text'],
    },
    localization: { defaultLocale: 'zh-CN', locales: ['zh-CN', 'en-US'] },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: 'core.text',
        apiVersion: '1.0.0',
        configSchemaVersion: '1.0.0',
        requiredCapabilities: ['core.text'],
        outcomes: [],
        commands: [],
      },
    ],
    assets: [
      {
        assetId: 'theme.config',
        kind: 'data',
        sourceAssetId: 'theme.config.source',
        sha256: HASH,
        uri: '/experience-runtime/themes/test.json',
        mediaType: 'application/json',
        format: 'json',
      },
    ],
    theme: {
      themeId: 'theme.test',
      apiVersion: '1.0.0',
      configAssetId: 'theme.config',
    },
    telemetryDefinitions: [],
    endings: [
      {
        endingId: 'ending.complete',
        title: { 'zh-CN': '完成', 'en-US': 'Complete' },
        kind: 'success',
      },
    ],
    graph: {
      entrySceneId,
      nodes: [
        {
          kind: 'scene',
          sceneId: entrySceneId,
          clock: { kind: 'none' },
          renderers: [
            {
              instanceId: 'text.entry',
              rendererId: 'core.text',
              layer: 0,
              config: { body: { 'zh-CN': '开始', 'en-US': 'Start' } },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: 'complete.on-enter',
              on: { type: 'scene.entered' },
              routes: [
                {
                  routeId: 'complete',
                  actions: [
                    { kind: 'ending.complete', endingId: 'ending.complete' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

interface BuildFixture {
  id: string;
  buildNumber: number;
  scope: Record<string, unknown>;
  manifest: ExperienceRuntimeManifest;
}

function buildFixture(
  id: string,
  buildNumber: number,
  scope: Record<string, unknown>,
  entrySceneId: string,
): BuildFixture {
  return {
    id,
    buildNumber,
    scope,
    manifest: manifestFixture(
      id,
      entrySceneId,
      scope.kind === 'full' ? 'production' : 'preview',
    ),
  };
}

const PROLOGUE_BUILD = buildFixture(
  PROLOGUE_BUILD_ID,
  1,
  { kind: 'subgraph', entryNodeId: 'clip:p-s1' },
  'scene.clip-p-s1',
);
const CHAPTER_ONE_BUILD = buildFixture(
  CHAPTER_ONE_BUILD_ID,
  2,
  { kind: 'subgraph', entryNodeId: 'clip:c1-s1' },
  'scene.clip-c1-s1',
);
const WHOLE_WORK_BUILD = buildFixture(
  WHOLE_WORK_BUILD_ID,
  3,
  { kind: 'full' },
  'scene.clip-p-s1',
);

const PROLOGUE_CHAPTER = {
  id: PROLOGUE_CHAPTER_ID,
  title: '序章',
  rank: 0,
  entryNodeId: 'clip:p-s1',
};
const CHAPTER_ONE_CHAPTER = {
  id: CHAPTER_ONE_CHAPTER_ID,
  title: '第一章 · 石上之梦',
  rank: 1,
  entryNodeId: 'clip:c1-s1',
};

function buildRow(build: BuildFixture) {
  return {
    id: build.id,
    buildNumber: build.buildNumber,
    scope: build.scope,
    runtimeJson: build.manifest,
    runtimeHash: canonicalJsonHash(build.manifest),
    diagnostics: [],
    sourceDraftRevision: 69,
    videoSnapshotHash: HASH,
    completedAt: new Date('2026-07-25T00:00:00.000Z'),
  };
}

type Row = Record<string, unknown>;

interface GameReleaseWhere {
  id?: string;
  leaseOwner?: string | null;
  status?: string | { in: string[] };
  storyProjectId_contentVersion?: {
    storyProjectId: string;
    contentVersion: string;
  };
}

interface RowMutation {
  where: GameReleaseWhere;
  data: Row;
}

interface RowCreation {
  data: Row & { chapters?: { create: Row[] } };
}

function matchesRow(row: Row, where: GameReleaseWhere): boolean {
  if (where.id && row.id !== where.id) return false;
  if (where.leaseOwner && row.leaseOwner !== where.leaseOwner) return false;
  if (!where.status) return true;
  return typeof where.status === 'string'
    ? row.status === where.status
    : where.status.in.includes(row.status as string);
}

function applyRowData(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      'increment' in (value as Record<string, unknown>)
    ) {
      row[key] =
        ((row[key] as number) ?? 0) +
        ((value as { increment: number }).increment ?? 0);
      continue;
    }
    if (key === 'chapters') continue;
    row[key] = value;
  }
}

function fakePrisma(input: {
  chapters: { id: string; title: string; rank: number; entryNodeId: string }[];
  builds: BuildFixture[];
}) {
  const gameReleases: Row[] = [];
  const chapterRows: Row[] = [];
  const publications: Row[] = [];
  const clock = () => [{ now: new Date() }];

  const gameRelease = {
    findUnique: jest.fn(({ where }: { where: GameReleaseWhere }) => {
      if (where.id) {
        return gameReleases.find((row) => row.id === where.id) ?? null;
      }
      const key = where.storyProjectId_contentVersion!;
      return (
        gameReleases.find(
          (row) =>
            row.storyProjectId === key.storyProjectId &&
            row.contentVersion === key.contentVersion,
        ) ?? null
      );
    }),
    create: jest.fn(({ data }: RowCreation) => {
      const row: Row = {
        id: `release-${gameReleases.length + 1}`,
        status: 'pending',
        attemptCount: 0,
        firstAttemptAt: null,
        manifestUrl: null,
        publishedAt: null,
        rejectedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        ...data,
      };
      delete row.chapters;
      gameReleases.push(row);
      for (const chapter of data.chapters?.create ?? []) {
        chapterRows.push({ gameReleaseId: row.id, ...chapter });
      }
      return row;
    }),
    update: jest.fn(({ where, data }: RowMutation) => {
      const row = gameReleases.find((candidate) => candidate.id === where.id)!;
      applyRowData(row, data);
      return row;
    }),
    updateMany: jest.fn(({ where, data }: RowMutation) => {
      const matched = gameReleases.filter((row) => matchesRow(row, where));
      matched.forEach((row) => applyRowData(row, data));
      return { count: matched.length };
    }),
  };

  const tx = {
    $executeRaw: jest.fn(() => 1),
    $queryRaw: jest.fn(clock),
    storyExperienceGameRelease: gameRelease,
    storyExperiencePublication: {
      findUnique: jest.fn(() => null),
      findMany: jest.fn(() => []),
      create: jest.fn(({ data }: RowCreation) => {
        const row: Row = {
          id: `publication-${publications.length + 1}`,
          status: 'pending',
          attemptCount: 0,
          firstAttemptAt: null,
          manifestUrl: null,
          publishedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          ...data,
        };
        publications.push(row);
        return row;
      }),
      update: jest.fn(({ data }: RowMutation) => {
        const row = publications.at(-1)!;
        applyRowData(row, data);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn((operation: (value: object) => unknown) =>
      operation(tx),
    ),
    $queryRaw: jest.fn(clock),
    storyChapter: { findMany: jest.fn(() => input.chapters) },
    storyBuild: {
      findMany: jest.fn((args: { where?: { id?: { in?: string[] } } }) =>
        args.where?.id?.in
          ? input.builds
              .filter((build) => args.where!.id!.in!.includes(build.id))
              .map(buildRow)
          : [...input.builds]
              .sort((left, right) => right.buildNumber - left.buildNumber)
              .map(buildRow),
      ),
    },
    storyExperienceGameRelease: gameRelease,
    storyExperiencePublication: {
      findUnique: jest.fn(() => publications.at(-1) ?? null),
      findFirst: jest.fn(() => null),
      updateMany: jest.fn(({ data }: RowMutation) => {
        const row = publications.at(-1);
        if (!row) return { count: 0 };
        applyRowData(row, data);
        return { count: 1 };
      }),
    },
  };
  return { prisma, gameReleases, chapterRows, publications };
}

function serviceWith(input: {
  chapters: { id: string; title: string; rank: number; entryNodeId: string }[];
  builds: BuildFixture[];
  publish?: jest.Mock;
  getGame?: jest.Mock;
}) {
  const store = fakePrisma({ chapters: input.chapters, builds: input.builds });
  const upload = jest.fn(
    ({ key, body }: { key: string; body: Buffer; contentType: string }) =>
      Promise.resolve({
        url: `https://internal.r2.test/${key}`,
        storagePath: key,
        bytes: body.byteLength,
        provider: 's3_compatible' as const,
        bucket: 'fizzdragon-media',
        region: 'auto',
      }),
  );
  const manifests = new StoryChapterManifestStorageService(
    { forProvider: jest.fn(() => ({ upload })) } as never,
    new MediaAssetUrlResolverService(),
  );
  const permissions = {
    requireProject: jest.fn(() => ({
      project: { workspaceId: WORKSPACE_ID },
    })),
  };
  const writeGuard = { assertHumanWriteAllowed: jest.fn() };
  const publish =
    input.publish ??
    jest.fn((request: ExperienceReleaseRequest) => ({
      gameId: request.gameId,
      contentVersion: request.contentVersion,
      status: 'published' as const,
      manifestUrl: JAVA_MANIFEST_URL,
    }));
  const gateway = {
    publish,
    getGame: input.getGame ?? jest.fn(() => null),
  };
  const builds = {
    getBuild: jest.fn((_user: unknown, _projectId: string, buildId: string) => {
      const build = input.builds.find((candidate) => candidate.id === buildId)!;
      return {
        id: build.id,
        status: 'ready',
        scope: build.scope,
        sourceDraftRevision: 69,
        videoSnapshotHash: HASH,
        runtimeSchemaVersion: 2,
        runtimeJson: build.manifest,
        runtimeHash: canonicalJsonHash(build.manifest),
        completedAt: new Date().toISOString(),
        diagnostics: [],
      };
    }),
  };
  const releases = new StoryExperienceReleaseService(
    permissions as never,
    builds as never,
    gateway as never,
    store.prisma as never,
    writeGuard as never,
  );
  const service = new StoryGameReleaseService(
    permissions as never,
    releases,
    gateway as never,
    store.prisma as never,
    writeGuard as never,
    manifests,
  );
  return { service, store, publish, upload, gateway };
}

function publishProject(service: StoryGameReleaseService) {
  return service.publishProject(
    { userId: 'user-1' } as never,
    PROJECT_ID,
    { setCurrent: true },
    'satoken=session',
  );
}

function publishedRequest(
  publish: jest.Mock,
  call = 0,
): ExperienceReleaseRequest {
  return (publish.mock.calls[call] as [ExperienceReleaseRequest])[0];
}

function publishedGameManifest(
  publish: jest.Mock,
  call = 0,
): ExperienceGameManifest {
  return publishedRequest(publish, call)
    .manifest as unknown as ExperienceGameManifest;
}

function publishedRuntimeManifest(
  publish: jest.Mock,
  call = 0,
): ExperienceRuntimeManifest {
  return publishedRequest(publish, call)
    .manifest as unknown as ExperienceRuntimeManifest;
}

describe('StoryGameReleaseService', () => {
  const previousBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE;
  const previousBucket = process.env.S3_BUCKET;

  beforeEach(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE = PUBLIC_BASE_URL;
    process.env.S3_BUCKET = 'fizzdragon-media';
  });

  afterAll(() => {
    process.env.MEDIA_PUBLIC_BASE_URL_S3_COMPATIBLE = previousBaseUrl;
    process.env.S3_BUCKET = previousBucket;
  });

  it('publishes a two-chapter work as one game manifest of two chapter manifest URLs', async () => {
    const { service, publish, upload } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
    });

    const release = await publishProject(service);

    expect(publish).toHaveBeenCalledTimes(1);
    const manifest = publishedGameManifest(publish);
    expect(manifest.manifestType).toBe('fizzdragon.experience-game');
    expect(manifest.gameId).toBe(PROJECT_ID);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.chapters.map((chapter) => chapter.manifestUrl)).toEqual([
      `${PUBLIC_BASE_URL}/${storyChapterManifestKey({
        projectId: PROJECT_ID,
        buildId: PROLOGUE_BUILD_ID,
        runtimeHash: canonicalJsonHash(PROLOGUE_BUILD.manifest),
      })}`,
      `${PUBLIC_BASE_URL}/${storyChapterManifestKey({
        projectId: PROJECT_ID,
        buildId: CHAPTER_ONE_BUILD_ID,
        runtimeHash: canonicalJsonHash(CHAPTER_ONE_BUILD.manifest),
      })}`,
    ]);
    expect(manifest.chapters.map((chapter) => chapter.contentVersion)).toEqual([
      PROLOGUE_BUILD_ID,
      CHAPTER_ONE_BUILD_ID,
    ]);
    expect(manifest.chapters.map((chapter) => chapter.rank)).toEqual([0, 1]);
    expect(manifest.chapters[0]?.title).toEqual({
      'zh-CN': '序章',
      'en-US': '序章',
    });
    expect(release).toEqual({
      gameId: PROJECT_ID,
      contentVersion: manifest.contentVersion,
      status: 'published',
      manifestUrl: JAVA_MANIFEST_URL,
    });
    // Each chapter manifest is uploaded byte-for-byte as the Build froze it.
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(([call]) => call.key)).toEqual(
      manifest.chapters.map((chapter) =>
        chapter.manifestUrl.slice(`${PUBLIC_BASE_URL}/`.length),
      ),
    );
    expect(upload.mock.calls[0][0].body.toString('utf8')).toBe(
      canonicalJsonString(PROLOGUE_BUILD.manifest),
    );
    expect(upload.mock.calls[0][0].contentType).toBe('application/json');
  });

  it('records every published chapter against the Build that supplied it', async () => {
    const { service, store } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
    });

    await publishProject(service);

    expect(store.chapterRows).toHaveLength(2);
    expect(
      store.chapterRows.map((row) => [
        row.storyChapterId,
        row.buildId,
        row.rank,
      ]),
    ).toEqual([
      [PROLOGUE_CHAPTER_ID, PROLOGUE_BUILD_ID, 0],
      [CHAPTER_ONE_CHAPTER_ID, CHAPTER_ONE_BUILD_ID, 1],
    ]);
    // The receipt exists before Java is contacted, so a manifest fetch can
    // never arrive before the media grant it depends on.
    expect(store.gameReleases[0]?.mediaAuthorizedAt).toBeInstanceOf(Date);
    expect(store.gameReleases[0]?.status).toBe('confirmed');
  });

  it('re-runs without uploading or releasing anything twice', async () => {
    const { service, publish, upload } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
    });

    const first = await publishProject(service);
    const second = await publishProject(service);

    expect(second).toEqual(first);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('publishes a newly built chapter as a new content version', async () => {
    const rebuiltChapterOne = buildFixture(
      '019f60f4-b101-70d4-8000-00000000a009',
      4,
      { kind: 'subgraph', entryNodeId: 'clip:c1-s1' },
      'scene.clip-c1-s1',
    );
    const { service, publish } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
    });
    const rebuilt = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD, rebuiltChapterOne],
    });

    const before = await publishProject(service);
    const after = await publishProject(rebuilt.service);

    expect(publishedGameManifest(publish).chapters[1]?.contentVersion).toBe(
      CHAPTER_ONE_BUILD_ID,
    );
    expect(
      publishedGameManifest(rebuilt.publish).chapters[1]?.contentVersion,
    ).toBe(rebuiltChapterOne.id);
    expect(after.contentVersion).not.toBe(before.contentVersion);
  });

  it('publishes a single-chapter work exactly as a Build publication', async () => {
    const { service, publish, upload } = serviceWith({
      chapters: [{ ...PROLOGUE_CHAPTER, rank: 0 }],
      builds: [WHOLE_WORK_BUILD],
    });

    const release = await publishProject(service);

    expect(publish).toHaveBeenCalledTimes(1);
    const manifest = publishedRuntimeManifest(publish);
    // One chapter is one manifest: the Build's own frozen Runtime Manifest,
    // published at the Build's contentVersion, with no table of contents and
    // no chapter object uploaded anywhere.
    expect(manifest.manifestType).toBe('fizzdragon.experience');
    expect(manifest.buildId).toBe(WHOLE_WORK_BUILD_ID);
    expect(publishedRequest(publish).contentVersion).toBe(WHOLE_WORK_BUILD_ID);
    expect(upload).not.toHaveBeenCalled();
    expect(release.contentVersion).toBe(WHOLE_WORK_BUILD_ID);
  });

  it('refuses to publish when the opening chapter has no Build', async () => {
    const { service, publish } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [CHAPTER_ONE_BUILD],
    });

    await expect(publishProject(service)).rejects.toThrow(/entry of this work/);
    expect(publish).not.toHaveBeenCalled();
  });

  it('leaves an unbuilt later chapter out of the release', async () => {
    const laterChapter = {
      id: '019f60f4-b101-70d4-8000-00000000c003',
      title: '第二章',
      rank: 2,
      entryNodeId: 'clip:c2-s1',
    };
    const { service, publish } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER, laterChapter],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
    });

    await publishProject(service);

    expect(
      publishedGameManifest(publish).chapters.map((chapter) => chapter.rank),
    ).toEqual([0, 1]);
  });

  it('settles a lost Java response against what Java actually serves', async () => {
    const unknown = new StoryExperienceReleaseOutcomeUnknownException({
      code: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
      message: 'socket hang up',
    });
    const publish = jest.fn(() => {
      throw unknown;
    });
    const pending: { contentVersion?: string } = {};
    const getGame = jest.fn(() => ({
      gameId: PROJECT_ID,
      title: '入梦金陵',
      currentVersion: pending.contentVersion,
      manifestUrl: JAVA_MANIFEST_URL,
    }));
    const probe = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
      publish: jest.fn((request: ExperienceReleaseRequest) => {
        pending.contentVersion = request.contentVersion;
        return {
          gameId: request.gameId,
          contentVersion: request.contentVersion,
          status: 'published' as const,
          manifestUrl: JAVA_MANIFEST_URL,
        };
      }),
    });
    await publishProject(probe.service);

    const { service } = serviceWith({
      chapters: [PROLOGUE_CHAPTER, CHAPTER_ONE_CHAPTER],
      builds: [PROLOGUE_BUILD, CHAPTER_ONE_BUILD],
      publish,
      getGame,
    });

    await expect(publishProject(service)).resolves.toEqual({
      gameId: PROJECT_ID,
      contentVersion: pending.contentVersion,
      status: 'published',
      manifestUrl: JAVA_MANIFEST_URL,
    });
    expect(getGame).toHaveBeenCalledWith(PROJECT_ID);
  });
});
