/* eslint-disable @typescript-eslint/no-unsafe-assignment -- focused service mocks intentionally inspect Prisma payloads. */
import { ExperienceRuntimeManifestSchema } from '@repo/shared/experience-runtime';
import { ForbiddenException } from '@nestjs/common';
import { canonicalJsonHash } from './canonical-json';
import type { StoryBuildDto, StoryWorkbenchDto } from './dto';
import { StoryExperienceReleaseService } from './story-experience-release.service';

const PROJECT_ID = '019f60f4-b101-70d4-8000-000000000002';
const USER_ID = 'creator-1';
const HASH = 'a'.repeat(64);
const COVER_URL = 'https://media.example.test/project-cover.jpg';
const FIRST_BUILD_ID = '019f60f4-b101-70d4-8000-000000000011';
const SECOND_BUILD_ID = '019f60f4-b101-70d4-8000-000000000012';

describe('StoryExperienceReleaseService', () => {
  it('prepares one draft release without contacting Java', async () => {
    const manifest = manifestFixture(FIRST_BUILD_ID, 'production');
    const build = buildFixture(FIRST_BUILD_ID, manifest);
    const draftUpsert = jest.fn(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'receipt-1', ...create }),
    );
    const dependencies = serviceDependencies({
      workbench: workbenchFixture([
        {
          id: '019f60f4-b101-70d4-8000-000000000021',
          title: 'Opening',
          rank: 0,
        },
      ]),
      builds: [build],
      draftUpsert,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const release = await dependencies.service.prepareProjectCandidate(
      { userId: USER_ID } as never,
      PROJECT_ID,
      {
        expectedProjectVersion: 3,
        expectedDraftRevision: 7,
        expectedVideoSnapshotHash: HASH,
      },
    );

    expect(release).toMatchObject({
      gameId: PROJECT_ID,
      contentVersion: FIRST_BUILD_ID,
      status: 'draft',
      setCurrent: true,
      title: 'Interactive Film',
      coverUrl: COVER_URL,
    });
    expect(release.manifest).toEqual(manifest);
    expect(dependencies.permissions.requireProject).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
      'story.release',
    );
    expect(draftUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: FIRST_BUILD_ID },
        create: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          gameId: PROJECT_ID,
          contentVersion: FIRST_BUILD_ID,
          requestHash: canonicalJsonHash(release),
          listingSnapshot: expect.objectContaining({
            title: 'Interactive Film',
            listing: expect.objectContaining({ developer: 'Creators' }),
          }),
          status: 'pending',
        }),
      }),
    );
    expect(dependencies.buildService.createBuild).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.anything(),
      expect.stringMatching(/^story-review:v4:/),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prepares a multi-chapter game manifest and uploads chapter manifests', async () => {
    const first = manifestFixture(FIRST_BUILD_ID, 'preview');
    const second = manifestFixture(SECOND_BUILD_ID, 'preview');
    const chapters = [
      {
        id: '019f60f4-b101-70d4-8000-000000000021',
        title: 'Opening',
        rank: 0,
        entryNodeId: 'scene.entry',
      },
      {
        id: '019f60f4-b101-70d4-8000-000000000022',
        title: 'Finale',
        rank: 1,
        entryNodeId: 'scene.entry',
      },
    ];
    const gameUpsert = jest.fn(
      ({
        create,
      }: {
        create: Record<string, unknown> & {
          chapters: { create: Array<Record<string, unknown>> };
        };
      }) =>
        Promise.resolve({
          id: 'game-receipt-1',
          ...create,
          chapters: create.chapters.create.map((chapter, index) => ({
            id: `chapter-receipt-${index}`,
            ...chapter,
          })),
        }),
    );
    const dependencies = serviceDependencies({
      workbench: workbenchFixture(chapters),
      builds: [
        buildFixture(FIRST_BUILD_ID, first),
        buildFixture(SECOND_BUILD_ID, second),
      ],
      gameUpsert,
    });

    const release = await dependencies.service.prepareProjectCandidate(
      { userId: USER_ID } as never,
      PROJECT_ID,
      {
        expectedProjectVersion: 3,
        expectedDraftRevision: 7,
        expectedVideoSnapshotHash: HASH,
      },
    );

    expect(release).toMatchObject({
      gameId: PROJECT_ID,
      status: 'draft',
      setCurrent: true,
      coverUrl: COVER_URL,
      manifest: {
        manifestType: 'fizzdragon.experience-game',
        gameId: PROJECT_ID,
        chapters: [
          expect.objectContaining({
            chapterId: chapters[0].id,
            contentVersion: FIRST_BUILD_ID,
          }),
          expect.objectContaining({
            chapterId: chapters[1].id,
            contentVersion: SECOND_BUILD_ID,
          }),
        ],
      },
    });
    expect(dependencies.manifests.upload).toHaveBeenCalledTimes(2);
    expect(gameUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          storyProjectId: PROJECT_ID,
          requestHash: canonicalJsonHash(release),
          listingSnapshot: expect.objectContaining({
            title: 'Interactive Film',
            listing: expect.objectContaining({ developer: 'Creators' }),
          }),
          status: 'pending',
        }),
      }),
    );
  });

  it('rejects stale introduction versions before building', async () => {
    const dependencies = serviceDependencies({
      workbench: workbenchFixture([
        { id: 'chapter', title: 'Opening', rank: 0 },
      ]),
      builds: [],
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 2,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_RELEASE_SNAPSHOT_CONFLICT' },
    });
    expect(dependencies.buildService.createBuild).not.toHaveBeenCalled();
  });

  it('prepares a candidate with description and cover while retaining empty creator metadata', async () => {
    const workbench = workbenchFixture([
      { id: '019f60f4-b101-70d4-8000-000000000021', title: 'Opening', rank: 0 },
    ]);
    workbench.project.storeListing!.developer = '';
    const manifest = manifestFixture(FIRST_BUILD_ID, 'production');
    const draftUpsert = jest.fn(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ id: 'receipt-empty-creator', ...create }),
    );
    const dependencies = serviceDependencies({
      workbench,
      builds: [buildFixture(FIRST_BUILD_ID, manifest)],
      draftUpsert,
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).resolves.toMatchObject({
      gameId: PROJECT_ID,
      coverUrl: COVER_URL,
      status: 'draft',
    });
    expect(draftUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          listingSnapshot: expect.objectContaining({
            listing: expect.objectContaining({
              description: workbench.project.storeListing!.description,
              developer: '',
            }),
          }),
        }),
      }),
    );
    expect(workbench.project.storeListing!.developer).toBe('');
  });

  it('requires a nonempty work description before building for review', async () => {
    const workbench = workbenchFixture([
      { id: 'chapter', title: 'Opening', rank: 0 },
    ]);
    workbench.project.storeListing!.description = ' \n\n ';
    const dependencies = serviceDependencies({ workbench, builds: [] });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'STORY_RELEASE_INTRODUCTION_REQUIRED',
        message: 'Add a work description before submitting for review.',
        fields: ['description'],
      },
    });
    expect(dependencies.buildService.createBuild).not.toHaveBeenCalled();
  });

  it('does not admit a candidate when introduction changes during its build', async () => {
    const manifest = manifestFixture(FIRST_BUILD_ID, 'production');
    const draftUpsert = jest.fn();
    const dependencies = serviceDependencies({
      workbench: workbenchFixture([
        { id: 'chapter', title: 'Opening', rank: 0 },
      ]),
      builds: [buildFixture(FIRST_BUILD_ID, manifest)],
      draftUpsert,
      finalProjectVersion: 4,
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_RELEASE_SNAPSHOT_CONFLICT' },
    });
    expect(draftUpsert).not.toHaveBeenCalled();
  });

  it('rejects unauthorized private assets left in an older saved introduction before building', async () => {
    const workbench = workbenchFixture([
      { id: 'chapter', title: 'Opening', rank: 0 },
    ]);
    workbench.project.storeListing!.screenshotAssetIds = [
      '019f60f4-b101-70d4-8000-000000000098',
    ];
    workbench.project.storeListing!.trailerAssetId =
      '019f60f4-b101-70d4-8000-000000000097';
    const draftUpsert = jest.fn();
    const dependencies = serviceDependencies({
      workbench,
      builds: [],
      draftUpsert,
      requireMediaUseAccess: jest.fn().mockRejectedValue(
        new ForbiddenException({
          code: 'MEDIA_ASSET_ACCESS_DENIED',
          message: 'You do not have access to this media asset.',
        }),
      ),
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_ASSET_ACCESS_DENIED' },
    });
    expect(
      dependencies.projects.requireProjectMediaUseAccess,
    ).toHaveBeenCalledWith(USER_ID, PROJECT_ID, [
      workbench.project.cover!.id,
      ...workbench.project.storeListing!.screenshotAssetIds,
      workbench.project.storeListing!.trailerAssetId,
    ]);
    expect(dependencies.buildService.createBuild).not.toHaveBeenCalled();
    expect(draftUpsert).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    'rechecks revoked media permission before freezing a %s-chapter candidate',
    async (chapterCount) => {
      const draftUpsert = jest.fn();
      const gameUpsert = jest.fn();
      const requireMediaUseAccess = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(
          new ForbiddenException({ code: 'MEDIA_ASSET_ACCESS_DENIED' }),
        );
      const dependencies = serviceDependencies({
        workbench: workbenchFixture(
          Array.from({ length: chapterCount }, (_, index) => ({
            id: `019f60f4-b101-70d4-8000-00000000002${index + 1}`,
            title: `Chapter ${index + 1}`,
            rank: index,
            entryNodeId: 'scene.entry',
          })),
        ),
        builds: [FIRST_BUILD_ID, SECOND_BUILD_ID].map((id) =>
          buildFixture(id, manifestFixture(id, 'production')),
        ),
        draftUpsert,
        gameUpsert,
        requireMediaUseAccess,
      });
      await expect(
        dependencies.service.prepareProjectCandidate(
          { userId: USER_ID } as never,
          PROJECT_ID,
          {
            expectedProjectVersion: 3,
            expectedDraftRevision: 7,
            expectedVideoSnapshotHash: HASH,
          },
        ),
      ).rejects.toMatchObject({
        response: { code: 'MEDIA_ASSET_ACCESS_DENIED' },
      });
      expect(requireMediaUseAccess).toHaveBeenCalledTimes(2);
      expect(dependencies.buildService.createBuild).toHaveBeenCalledTimes(
        chapterCount,
      );
      expect(draftUpsert).not.toHaveBeenCalled();
      expect(gameUpsert).not.toHaveBeenCalled();
    },
  );

  it('blocks assets that became unavailable after draft saving', async () => {
    const manifest = manifestFixture(FIRST_BUILD_ID, 'production');
    const draftUpsert = jest.fn();
    const dependencies = serviceDependencies({
      workbench: workbenchFixture([
        { id: 'chapter', title: 'Opening', rank: 0 },
      ]),
      builds: [buildFixture(FIRST_BUILD_ID, manifest)],
      draftUpsert,
      candidateAssets: [],
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_RELEASE_INTRODUCTION_MEDIA_INVALID' },
    });
    expect(draftUpsert).not.toHaveBeenCalled();
  });

  it('cannot replace the introduction attached to an existing candidate identity', async () => {
    const manifest = manifestFixture(FIRST_BUILD_ID, 'production');
    const draftUpsert = jest.fn(
      ({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'receipt',
          ...create,
          listingSnapshot: {
            ...(create.listingSnapshot as Record<string, unknown>),
            title: 'Other title',
          },
        }),
    );
    const dependencies = serviceDependencies({
      workbench: workbenchFixture([
        { id: 'chapter', title: 'Opening', rank: 0 },
      ]),
      builds: [buildFixture(FIRST_BUILD_ID, manifest)],
      draftUpsert,
    });
    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_RELEASE_CANDIDATE_CORRUPT' },
    });
    expect(draftUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({
          listingSnapshot: expect.anything(),
        }),
      }),
    );
  });

  it.each([
    { kind: 'single', legacyGenres: false },
    { kind: 'single', legacyGenres: true },
    { kind: 'serial', legacyGenres: false },
    { kind: 'serial', legacyGenres: true },
  ] as const)(
    'reuses an equivalent earlier $kind receipt (genres: $legacyGenres) while rejecting invalid or changed introductions',
    async ({ kind, legacyGenres }) => {
      for (const scenario of [
        'equivalent',
        'unknown-field',
        'changed-content',
        'changed-description',
      ]) {
        const chapters = [
          {
            id: '019f60f4-b101-70d4-8000-000000000021',
            title: 'Opening',
            rank: 0,
            entryNodeId: 'scene.entry',
          },
          ...(kind === 'serial'
            ? [
                {
                  id: '019f60f4-b101-70d4-8000-000000000022',
                  title: 'Finale',
                  rank: 1,
                  entryNodeId: 'scene.entry',
                },
              ]
            : []),
        ];
        const workbench = workbenchFixture(chapters);
        workbench.project.storeListing!.tags = [
          'Drama',
          'Mystery',
          'Multiple endings',
        ];
        let storedSnapshot: unknown;
        let storedJson: string | undefined;
        const upsert = jest.fn(
          ({
            create,
          }: {
            create: Record<string, unknown> & {
              chapters?: { create: Array<Record<string, unknown>> };
            };
          }) => {
            const snapshot = create.listingSnapshot as {
              title: string;
              defaultLocale: string;
              coverAssetId: string;
              listing: Record<string, unknown>;
            };
            const savedListing = { ...snapshot.listing };
            delete savedListing.description;
            storedSnapshot = {
              ...snapshot,
              listing: {
                ...savedListing,
                tagline: ' Find your story ',
                shortDescription: 'Explore an interactive film.',
                aboutParagraphs: [
                  '',
                  scenario === 'changed-description'
                    ? 'Other story'
                    : ' Choose how the story unfolds. ',
                  ' ',
                ],
                ...(legacyGenres
                  ? {
                      genres: [' Drama ', 'Mystery'],
                      tags: ['Mystery', 'Multiple endings'],
                    }
                  : { tags: ['Drama', 'Mystery', 'Multiple endings'] }),
                ...(scenario === 'unknown-field'
                  ? { unknownField: 'Unexpected' }
                  : {}),
                ...(scenario === 'changed-content'
                  ? { developer: 'Other creator' }
                  : {}),
              },
            };
            storedJson = JSON.stringify(storedSnapshot);
            return Promise.resolve({
              id: 'existing-receipt',
              ...create,
              listingSnapshot: storedSnapshot,
              ...(create.chapters ? { chapters: create.chapters.create } : {}),
            });
          },
        );
        const buildKind = kind === 'single' ? 'production' : 'preview';
        const dependencies = serviceDependencies({
          workbench,
          builds: [
            buildFixture(
              FIRST_BUILD_ID,
              manifestFixture(FIRST_BUILD_ID, buildKind),
            ),
            ...(kind === 'serial'
              ? [
                  buildFixture(
                    SECOND_BUILD_ID,
                    manifestFixture(SECOND_BUILD_ID, buildKind),
                  ),
                ]
              : []),
          ],
          ...(kind === 'single'
            ? { draftUpsert: upsert }
            : { gameUpsert: upsert }),
        });
        const preparation = dependencies.service.prepareProjectCandidate(
          { userId: USER_ID } as never,
          PROJECT_ID,
          {
            expectedProjectVersion: 3,
            expectedDraftRevision: 7,
            expectedVideoSnapshotHash: HASH,
          },
        );
        if (scenario === 'equivalent') {
          await expect(preparation).resolves.toMatchObject({
            gameId: PROJECT_ID,
            status: 'draft',
          });
        } else {
          await expect(preparation).rejects.toMatchObject({
            response: { code: 'STORY_RELEASE_CANDIDATE_CORRUPT' },
          });
        }
        expect(JSON.stringify(storedSnapshot)).toBe(storedJson);
        expect(upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.not.objectContaining({
              listingSnapshot: expect.anything(),
            }),
          }),
        );
      }
    },
  );

  it('rejects review submission when the project has no public cover URL', async () => {
    const dependencies = serviceDependencies({
      workbench: workbenchFixture(
        [
          {
            id: '019f60f4-b101-70d4-8000-000000000021',
            title: 'Opening',
            rank: 0,
          },
        ],
        null,
      ),
      builds: [],
    });

    await expect(
      dependencies.service.prepareProjectCandidate(
        { userId: USER_ID } as never,
        PROJECT_ID,
        {
          expectedProjectVersion: 3,
          expectedDraftRevision: 7,
          expectedVideoSnapshotHash: HASH,
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'STORY_RELEASE_COVER_REQUIRED' },
    });
  });
});

function serviceDependencies({
  workbench,
  builds,
  draftUpsert = jest.fn(),
  gameUpsert = jest.fn(),
  finalProjectVersion = 3,
  candidateAssets,
  requireMediaUseAccess = jest.fn().mockResolvedValue(undefined),
}: {
  workbench: StoryWorkbenchDto;
  builds: StoryBuildDto[];
  draftUpsert?: jest.Mock;
  gameUpsert?: jest.Mock;
  finalProjectVersion?: number;
  candidateAssets?: Array<{ id: string; kind: string }>;
  requireMediaUseAccess?: jest.Mock;
}) {
  const permissions = { requireProject: jest.fn().mockResolvedValue({}) };
  const projects = {
    workbench: jest.fn().mockResolvedValue(workbench),
    requireProjectMediaUseAccess: requireMediaUseAccess,
  };
  let buildIndex = 0;
  const buildService = {
    createBuild: jest.fn(() =>
      Promise.resolve(builds[buildIndex++] ?? builds.at(-1)),
    ),
  };
  const manifests = {
    publicUrl: jest.fn(
      ({ buildId }: { buildId: string }) =>
        `https://media.example.test/${buildId}/manifest.json`,
    ),
    placement: jest.fn(({ buildId }: { buildId: string }) => ({
      key: `interactive-film/${buildId}/manifest.json`,
      url: `https://media.example.test/${buildId}/manifest.json`,
    })),
    upload: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      Promise.resolve(
        callback({
          $queryRaw: jest
            .fn()
            .mockResolvedValue([{ version: finalProjectVersion }]),
          mediaAsset: {
            findMany: jest
              .fn()
              .mockResolvedValue(
                candidateAssets ?? [
                  { id: workbench.project.cover?.id, kind: 'image' },
                ],
              ),
          },
          storyExperienceDraftRelease: { upsert: draftUpsert },
          storyExperienceGameRelease: { upsert: gameUpsert },
        }),
      ),
    ),
  };
  return {
    buildService,
    permissions,
    manifests,
    projects,
    service: new StoryExperienceReleaseService(
      permissions as never,
      projects as never,
      buildService as never,
      manifests as never,
      prisma as never,
    ),
  };
}

function workbenchFixture(
  chapters: Array<{
    id: string;
    title: string;
    rank: number;
    entryNodeId?: string;
  }>,
  coverUrl: string | null = COVER_URL,
): StoryWorkbenchDto {
  return {
    project: {
      id: PROJECT_ID,
      projectVersion: 3,
      cover: coverUrl
        ? { id: '019f60f4-b101-70d4-8000-000000000099', previewUrl: coverUrl }
        : null,
      title: 'Interactive Film',
      defaultLocale: 'en-US',
      storeListing: {
        description:
          'Find your story\n\nExplore an interactive film.\n\nChoose how the story unfolds.',
        developer: 'Creators',
        tags: [],
        trailerAssetId: null,
        screenshotAssetIds: [],
      },
    },
    draft: { revision: 7 },
    video: { snapshotHash: HASH },
    chapters: chapters.map((chapter) => ({ entryNodeId: null, ...chapter })),
  } as unknown as StoryWorkbenchDto;
}

function buildFixture(
  id: string,
  manifest: ReturnType<typeof manifestFixture>,
): StoryBuildDto {
  return {
    id,
    projectId: PROJECT_ID,
    status: 'ready',
    sourceDraftRevision: 7,
    videoSnapshotHash: HASH,
    runtimeSchemaVersion: 2,
    runtimeJson: manifest,
    runtimeHash: canonicalJsonHash(manifest),
    diagnostics: [],
    completedAt: '2026-08-30T00:00:00.000Z',
  } as unknown as StoryBuildDto;
}

function manifestFixture(buildId: string, channel: 'production' | 'preview') {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: 'fizzdragon.experience',
    schemaVersion: 2,
    channel,
    gameId: PROJECT_ID,
    buildId,
    contentVersion: buildId,
    completionPolicy: 'finite',
    metadata: {
      title: { 'en-US': 'Interactive Film' },
      summary: { 'en-US': 'A release candidate' },
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1,
      requiredCapabilities: ['core.text'],
    },
    localization: { defaultLocale: 'en-US', locales: ['en-US'] },
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
        title: { 'en-US': 'Complete' },
        kind: 'success',
      },
    ],
    graph: {
      entrySceneId: 'scene.entry',
      nodes: [
        {
          kind: 'scene',
          sceneId: 'scene.entry',
          clock: { kind: 'none' },
          renderers: [
            {
              instanceId: 'text.entry',
              rendererId: 'core.text',
              layer: 0,
              config: { body: { 'en-US': 'Start' } },
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
