/* eslint-disable @typescript-eslint/no-unsafe-assignment -- focused service mocks intentionally inspect Prisma payloads. */
import { ExperienceRuntimeManifestSchema } from '@repo/shared/experience-runtime';
import { canonicalJsonHash } from './canonical-json';
import type { StoryBuildDto, StoryWorkbenchDto } from './dto';
import { StoryExperienceReleaseService } from './story-experience-release.service';

const PROJECT_ID = '019f60f4-b101-70d4-8000-000000000002';
const USER_ID = 'creator-1';
const HASH = 'a'.repeat(64);
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
      { expectedDraftRevision: 7, expectedVideoSnapshotHash: HASH },
    );

    expect(release).toMatchObject({
      gameId: PROJECT_ID,
      contentVersion: FIRST_BUILD_ID,
      status: 'draft',
      setCurrent: true,
      title: 'Interactive Film',
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
          status: 'pending',
        }),
      }),
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
      { expectedDraftRevision: 7, expectedVideoSnapshotHash: HASH },
    );

    expect(release).toMatchObject({
      gameId: PROJECT_ID,
      status: 'draft',
      setCurrent: true,
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
          status: 'pending',
        }),
      }),
    );
  });
});

function serviceDependencies({
  workbench,
  builds,
  draftUpsert = jest.fn(),
  gameUpsert = jest.fn(),
}: {
  workbench: StoryWorkbenchDto;
  builds: StoryBuildDto[];
  draftUpsert?: jest.Mock;
  gameUpsert?: jest.Mock;
}) {
  const permissions = { requireProject: jest.fn().mockResolvedValue({}) };
  const projects = { workbench: jest.fn().mockResolvedValue(workbench) };
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
          storyExperienceDraftRelease: { upsert: draftUpsert },
          storyExperienceGameRelease: { upsert: gameUpsert },
        }),
      ),
    ),
  };
  return {
    permissions,
    manifests,
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
): StoryWorkbenchDto {
  return {
    project: { id: PROJECT_ID, projectVersion: 3 },
    draft: { revision: 7 },
    video: { snapshotHash: HASH },
    chapters: chapters.map((chapter) => ({ entryNodeId: null, ...chapter })),
  } as StoryWorkbenchDto;
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
