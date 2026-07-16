import {
  BadGatewayException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceReleaseRequest,
  type ExperienceReleaseResponse,
} from '@repo/shared/experience-runtime';
import { JAVA_STUDIO_URL } from '../integrations/java/java-config';
import {
  JAVA_EXPERIENCE_RELEASE_PATH,
  StoryExperienceReleaseGateway,
} from './story-experience-release.gateway';
import { StoryExperienceReleaseService } from './story-experience-release.service';

const BUILD_ID = '019f60f4-b101-70d4-8000-000000000001';
const PROJECT_ID = '019f60f4-b101-70d4-8000-000000000002';
const WORKSPACE_ID = '019f60f4-b101-70d4-8000-000000000003';
const HASH = 'a'.repeat(64);

function manifestFixture() {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: 'fizzdragon.experience',
    schemaVersion: 2,
    channel: 'production',
    gameId: 'jinling',
    buildId: BUILD_ID,
    contentVersion: `build:${BUILD_ID}`,
    completionPolicy: 'finite',
    metadata: {
      title: { 'zh-CN': '金陵入梦', 'en-US': 'Dream of Jinling' },
      summary: { 'zh-CN': '第一季 · 无字来客', 'en-US': 'Season one' },
    },
    compatibility: {
      engineApiVersion: '2.0.0',
      experienceApiVersion: '1.0.0',
      semanticRulesVersion: 1,
      requiredCapabilities: ['core.text'],
    },
    localization: {
      defaultLocale: 'zh-CN',
      locales: ['zh-CN', 'en-US'],
    },
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
                    {
                      kind: 'ending.complete',
                      endingId: 'ending.complete',
                    },
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

describe('StoryExperienceReleaseGateway', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts the exact request to the agreed Java endpoint and unwraps data', async () => {
    const manifest = manifestFixture();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          msg: '成功',
          data: {
            gameId: manifest.gameId,
            contentVersion: manifest.contentVersion,
            status: 'published',
            manifestUrl:
              'https://media.example.com/interactive-film/jinling/build/manifest.json',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await new StoryExperienceReleaseGateway().publish(
      {
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        title: '金陵入梦',
        manifest,
        status: 'published',
        setCurrent: true,
      },
      { cookie: 'satoken=test-session' },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_RELEASE_PATH}`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Cookie: 'satoken=test-session' });
    if (typeof init?.body !== 'string') {
      throw new Error('Expected the Java release body to be serialized JSON');
    }
    expect(JSON.parse(init.body)).toEqual({
      gameId: 'jinling',
      contentVersion: `build:${BUILD_ID}`,
      title: '金陵入梦',
      manifest,
      status: 'published',
      setCurrent: true,
    });
    expect(result).toMatchObject({ gameId: 'jinling', status: 'published' });
  });

  it('surfaces the Java envelope message when publication is rejected', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ code: 409, msg: '版本内容冲突', data: null }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    let rejected: unknown;
    try {
      await new StoryExperienceReleaseGateway().publish(
        {
          gameId: 'jinling',
          contentVersion: 'v2',
          manifest: manifestFixture(),
          status: 'published',
        },
        {},
      );
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(BadGatewayException);
    expect((rejected as BadGatewayException).getResponse()).toMatchObject({
      message: '版本内容冲突',
    });
  });

  it('rejects a successful Java response for a different release identity', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          msg: '成功',
          data: {
            gameId: 'different-game',
            contentVersion: 'v2',
            status: 'published',
            manifestUrl:
              'https://media.example.com/interactive-film/different-game/v2/manifest.json',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    let rejected: unknown;
    try {
      await new StoryExperienceReleaseGateway().publish(
        {
          gameId: 'jinling',
          contentVersion: 'v2',
          manifest: manifestFixture(),
          status: 'published',
        },
        {},
      );
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(BadGatewayException);
    expect((rejected as BadGatewayException).getResponse()).toMatchObject({
      code: 'JAVA_EXPERIENCE_RELEASE_IDENTITY_MISMATCH',
    });
  });
});

describe('StoryExperienceReleaseService', () => {
  it('publishes only the exact ready production Build with release permission', async () => {
    const manifest = manifestFixture();
    const permissions = {
      requireProject: jest.fn(() => ({
        project: { workspaceId: WORKSPACE_ID },
      })),
    };
    const builds = {
      getBuild: jest.fn(() => ({
        id: BUILD_ID,
        status: 'ready',
        profile: 'production',
        scope: { kind: 'full' },
        runtimeSchemaVersion: 2,
        runtimeJson: manifest,
      })),
    };
    const gateway = {
      publish: jest.fn(
        (request: ExperienceReleaseRequest): ExperienceReleaseResponse => ({
          gameId: request.gameId,
          contentVersion: request.contentVersion,
          status: request.status,
          manifestUrl: 'https://media.example.com/jinling/manifest.json',
        }),
      ),
    };
    const service = new StoryExperienceReleaseService(
      permissions as never,
      builds as never,
      gateway as never,
    );

    await expect(
      service.publishBuild(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
        BUILD_ID,
        { status: 'published', setCurrent: true },
        { cookie: 'satoken=test-session' },
      ),
    ).resolves.toMatchObject({ gameId: 'jinling', status: 'published' });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'user-1',
      PROJECT_ID,
      'story.release',
    );
    expect(gateway.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: 'jinling',
        contentVersion: `build:${BUILD_ID}`,
        title: '金陵入梦',
        subtitle: '第一季 · 无字来客',
        setCurrent: true,
      }),
      { cookie: 'satoken=test-session' },
    );
  });

  it('rejects a non-production Build before calling Java', async () => {
    const permissions = {
      requireProject: jest.fn(() => ({
        project: { workspaceId: WORKSPACE_ID },
      })),
    };
    const builds = {
      getBuild: jest.fn(() => ({
        id: BUILD_ID,
        status: 'ready',
        profile: 'preview',
        scope: { kind: 'full' },
        runtimeSchemaVersion: 2,
        runtimeJson: manifestFixture(),
      })),
    };
    const gateway = { publish: jest.fn() };
    const service = new StoryExperienceReleaseService(
      permissions as never,
      builds as never,
      gateway as never,
    );

    await expect(
      service.publishBuild(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
        BUILD_ID,
        { status: 'published', setCurrent: true },
        {},
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(gateway.publish).not.toHaveBeenCalled();
  });
});
