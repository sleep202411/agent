/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers and mock.calls payloads are intentionally untyped in lifecycle assertions. */
import { BadGatewayException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceReleaseRequest,
} from '@repo/shared/experience-runtime';
import {
  JAVA_REQUEST_TIMEOUT_MS,
  JAVA_STUDIO_URL,
} from '../integrations/java/java-config';
import {
  JAVA_EXPERIENCE_GAMES_PATH,
  JAVA_EXPERIENCE_RELEASE_PATH,
  StoryExperienceReleaseGateway,
  StoryExperienceReleaseOutcomeUnknownException,
} from './story-experience-release.gateway';
import { canonicalJsonHash } from './canonical-json';
import { StoryExperienceReleaseService } from './story-experience-release.service';

const BUILD_ID = '019f60f4-b101-70d4-8000-000000000001';
const OLD_BUILD_ID = '019f60f4-b101-70d4-8000-000000000004';
const NEW_BUILD_ID = '019f60f4-b101-70d4-8000-000000000005';
const PROJECT_ID = '019f60f4-b101-70d4-8000-000000000002';
const WORKSPACE_ID = '019f60f4-b101-70d4-8000-000000000003';
const HASH = 'a'.repeat(64);
const MANIFEST_URL =
  'https://media.example.com/interactive-film/branching-film/build/manifest.json';

function manifestFixture(buildId = BUILD_ID) {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: 'fizzdragon.experience',
    schemaVersion: 2,
    channel: 'production',
    gameId: PROJECT_ID,
    buildId,
    contentVersion: buildId,
    completionPolicy: 'finite',
    metadata: {
      title: {
        'zh-CN': 'Branching Film Test',
        'en-US': 'Dream of Branching Film',
      },
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

describe('StoryExperienceReleaseGateway', () => {
  afterEach(() => jest.restoreAllMocks());

  it('forwards only the guard-normalized viewer cookie to Java POST', async () => {
    const manifest = manifestFixture();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      javaResponse(200, {
        gameId: manifest.gameId,
        contentVersion: manifest.contentVersion,
        status: 'published',
        manifestUrl: MANIFEST_URL,
      }),
    );

    await new StoryExperienceReleaseGateway().publish(
      releaseRequest(manifest),
      'satoken=normalized-session',
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_RELEASE_PATH}`);
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: 'satoken=normalized-session',
    });
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('treats a business envelope rejection as definitive', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 409, msg: '版本内容冲突', data: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
        message: '版本内容冲突',
      }),
    });
  });

  it('treats a non-JSON HTTP 4xx response as a definitive rejection', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('invalid release', { status: 400 }));

    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
      }),
    });
  });

  it.each([502, 503, 504])(
    'treats HTTP %s as unknown because Java may already have committed',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 500, msg: 'upstream gateway failed' }),
            { status, headers: { 'content-type': 'application/json' } },
          ),
        );
      await expect(
        new StoryExperienceReleaseGateway().publish(
          releaseRequest(manifestFixture()),
          '',
        ),
      ).rejects.toBeInstanceOf(StoryExperienceReleaseOutcomeUnknownException);
    },
  );

  it('treats a non-JSON HTTP 5xx response as unknown', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('gateway failed', { status: 503 }));
    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toBeInstanceOf(StoryExperienceReleaseOutcomeUnknownException);
  });

  it('treats HTTP 408 as unknown because the request may have committed', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 408, msg: 'request timeout' }), {
        status: 408,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toBeInstanceOf(StoryExperienceReleaseOutcomeUnknownException);
  });

  it('treats an HTTP-success envelope 5xx as unknown', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 500, msg: 'internal error' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toBeInstanceOf(StoryExperienceReleaseOutcomeUnknownException);
  });

  it('keeps the deadline active while reading the Java response body', async () => {
    jest.useFakeTimers();
    try {
      jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        const signal = init?.signal;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => {
                reject(
                  new DOMException('The operation was aborted.', 'AbortError'),
                );
              });
            }),
        } as Response);
      });
      const pending = new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      );
      const assertion = expect(pending).rejects.toBeInstanceOf(
        StoryExperienceReleaseOutcomeUnknownException,
      );
      await jest.advanceTimersByTimeAsync(JAVA_REQUEST_TIMEOUT_MS);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats a malformed successful acknowledgement as unknown', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      javaResponse(200, {
        gameId: 'different-game',
        contentVersion: 'different-version',
        status: 'published',
        manifestUrl: MANIFEST_URL,
      }),
    );
    await expect(
      new StoryExperienceReleaseGateway().publish(
        releaseRequest(manifestFixture()),
        '',
      ),
    ).rejects.toBeInstanceOf(StoryExperienceReleaseOutcomeUnknownException);
  });

  it('queries Java currentVersion publicly without creator credentials', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      javaResponse(200, {
        gameId: PROJECT_ID,
        title: 'Branching Film',
        currentVersion: BUILD_ID,
        manifestUrl: MANIFEST_URL,
      }),
    );
    const result = await new StoryExperienceReleaseGateway().getGame(
      PROJECT_ID,
    );
    expect(result?.currentVersion).toBe(BUILD_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `${JAVA_STUDIO_URL}${JAVA_EXPERIENCE_GAMES_PATH}/${PROJECT_ID}`,
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('models an explicit Java game-not-found response as authority absence', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 404, msg: 'game not found', data: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    await expect(
      new StoryExperienceReleaseGateway().getGame(PROJECT_ID),
    ).resolves.toBeNull();
  });

  it('accepts an HTTP 404 game response even when its body is not JSON', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(
      new StoryExperienceReleaseGateway().getGame(PROJECT_ID),
    ).resolves.toBeNull();
  });

  it('does not interpret a 5xx envelope code 404 as authority absence', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 404, msg: 'upstream unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      new StoryExperienceReleaseGateway().getGame(PROJECT_ID),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});

describe('StoryExperienceReleaseService publication lifecycle', () => {
  it('rejects a draft Java release before the external side effect when Agent apply owns the lock', async () => {
    const locked = new Error('agent applying');
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      permissions: { requireProject: jest.fn().mockRejectedValue(locked) },
    });

    await expect(
      service.publishBuild(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
        BUILD_ID,
        { status: 'draft', setCurrent: false },
        'satoken=session',
      ),
    ).rejects.toBe(locked);
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('takes the project write fence before claiming a publication or calling Java', async () => {
    const locked = new Error('agent applying');
    const writeGuard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(locked),
    };
    const gateway = { publish: jest.fn() };
    const tx = claimTransaction({ existing: null });
    const service = serviceWith({
      gateway,
      prisma: prismaWithTransaction(tx),
      writeGuard,
    });

    await expect(publish(service)).rejects.toBe(locked);
    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.storyExperiencePublication.create).not.toHaveBeenCalled();
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('does not accept a draft release when Agent claims after the early permission check', async () => {
    const locked = new Error('agent applying');
    const writeGuard = {
      assertHumanWriteAllowed: jest.fn().mockRejectedValue(locked),
    };
    const gateway = { publish: jest.fn() };
    const tx = draftClaimTransaction({ existing: null });
    const service = serviceWith({
      gateway,
      prisma: prismaWithDraftTransaction(tx),
      writeGuard,
    });

    await expect(publishDraft(service)).rejects.toBe(locked);
    expect(writeGuard.assertHumanWriteAllowed).toHaveBeenCalledWith(
      tx,
      PROJECT_ID,
    );
    expect(tx.storyExperienceDraftRelease.create).not.toHaveBeenCalled();
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('durably authorizes media before Java POST and confirms afterward', async () => {
    const events: string[] = [];
    const manifest = manifestFixture();
    const pending = publicationRow({ status: 'pending' });
    const claimed = publicationRow({
      status: 'pending',
      leaseOwner: 'lease-1',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const tx = claimTransaction({
      existing: null,
      created: pending,
      claimed,
      onCreate: () => events.push('authorized'),
    });
    const prisma = prismaWithTransaction(tx);
    prisma.storyExperiencePublication.updateMany.mockImplementation(() => {
      events.push('confirmed');
      return { count: 1 };
    });
    const gateway = {
      publish: jest.fn(() => {
        events.push('java-post');
        return releaseResponse(manifest);
      }),
    };
    const service = serviceWith({ gateway, prisma, manifest });

    await expect(
      service.publishBuild(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
        BUILD_ID,
        { status: 'published', setCurrent: true },
        'satoken=session',
      ),
    ).resolves.toEqual(releaseResponse(manifest));
    expect(events).toEqual(['authorized', 'java-post', 'confirmed']);
    expect(tx.storyExperiencePublication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: BUILD_ID,
        requestedByUserId: 'user-1',
      }),
    });
    // Authorization is stamped explicitly from the transaction clock (one
    // clock read per operation — never mixed with column defaults, which the
    // time_order_chk constraint would reject on skew).
    const createData =
      tx.storyExperiencePublication.create.mock.calls[0][0].data;
    expect(createData.mediaAuthorizedAt).toBeInstanceOf(Date);
    expect(createData.createdAt).toEqual(createData.mediaAuthorizedAt);
    expect(gateway.publish).toHaveBeenCalledWith(
      expect.objectContaining({ contentVersion: BUILD_ID }),
      'satoken=session',
    );
  });

  it('uses the database clock for first-attempt and lease timestamps', async () => {
    const clock = new Date('2026-07-16T23:59:59.123Z');
    const tx = claimTransaction({
      existing: null,
      created: publicationRow(),
      claimed: publicationRow({
        leaseOwner: 'lease-1',
        leaseExpiresAt: new Date(clock.getTime() + 30_000),
      }),
      clock,
    });
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway: { publish: jest.fn(() => releaseResponse(manifestFixture())) },
    });

    await publish(service);

    expect(tx.storyExperiencePublication.update).toHaveBeenCalledWith({
      where: { buildId: BUILD_ID },
      data: expect.objectContaining({
        firstAttemptAt: clock,
        lastAttemptAt: clock,
        leaseAcquiredAt: clock,
        leaseExpiresAt: new Date(
          clock.getTime() + 20_000 + JAVA_REQUEST_TIMEOUT_MS,
        ),
      }),
    });
  });

  it('keeps media authorized and records uncertain after an ambiguous POST', async () => {
    const claimed = publicationRow({
      status: 'pending',
      leaseOwner: 'lease-unknown',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const prisma = prismaWithTransaction(
      claimTransaction({
        existing: publicationRow({ status: 'pending' }),
        claimed,
      }),
    );
    const unknown = new StoryExperienceReleaseOutcomeUnknownException({
      code: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
      message: 'timeout',
    });
    const service = serviceWith({
      prisma,
      gateway: { publish: jest.fn(() => Promise.reject(unknown)) },
    });

    await expect(publish(service)).rejects.toBe(unknown);
    expect(prisma.storyExperiencePublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ leaseOwner: expect.any(String) }),
      data: expect.objectContaining({
        status: 'uncertain',
        nextReconciliationAt: expect.any(Date),
      }),
    });
    const data =
      prisma.storyExperiencePublication.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('mediaAuthorizationRevokedAt');
    expect(data).not.toHaveProperty('leaseOwner');
  });

  it('revokes authorization only for a definitive first-attempt rejection', async () => {
    const claimed = publicationRow({
      status: 'pending',
      leaseOwner: 'lease-rejected',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const prisma = prismaWithTransaction(
      claimTransaction({
        existing: publicationRow({ status: 'pending' }),
        claimed,
      }),
    );
    const rejected = new BadGatewayException({
      code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
      message: 'invalid release',
    });
    const service = serviceWith({
      prisma,
      gateway: { publish: jest.fn(() => Promise.reject(rejected)) },
    });

    await expect(publish(service)).rejects.toBe(rejected);
    expect(prisma.storyExperiencePublication.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'pending' }),
      data: expect.objectContaining({
        status: 'rejected',
        rejectedAt: expect.any(Date),
        mediaAuthorizationRevokedAt: expect.any(Date),
        leaseOwner: null,
      }),
    });
  });

  it('returns the same confirmed Build without a second Java POST', async () => {
    const confirmed = publicationRow({
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date(),
    });
    const tx = claimTransaction({ existing: confirmed });
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      prisma: prismaWithTransaction(tx),
    });

    await expect(publish(service)).resolves.toEqual(
      releaseResponse(manifestFixture()),
    );
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('serializes different Builds in one project across processes', async () => {
    const competing = publicationRow({
      buildId: OLD_BUILD_ID,
      contentVersion: OLD_BUILD_ID,
      status: 'uncertain',
      leaseOwner: 'other-process',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const tx = claimTransaction({ existing: null, competing });
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      prisma: prismaWithTransaction(tx),
    });

    await expect(publish(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_EXPERIENCE_PUBLICATION_IN_PROGRESS',
        activeBuildId: OLD_BUILD_ID,
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('reconciles an expired unknown fence before allowing a newer Build', async () => {
    const newManifest = manifestFixture(NEW_BUILD_ID);
    const expired = authorityRow({
      id: 'publication-old-unknown',
      buildId: OLD_BUILD_ID,
      contentVersion: OLD_BUILD_ID,
      status: 'uncertain',
      sourceDraftRevision: 3,
    });
    Object.assign(expired, {
      leaseOwner: 'dead-process',
      leaseExpiresAt: new Date(Date.now() - 5_000),
      authorityCheckedAt: null,
    });
    const created = publicationRow({
      buildId: NEW_BUILD_ID,
      contentVersion: NEW_BUILD_ID,
    });
    const claimed = publicationRow({
      buildId: NEW_BUILD_ID,
      contentVersion: NEW_BUILD_ID,
      leaseOwner: 'new-lease',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const delegate = {
      findUnique: jest.fn(() => null),
      findMany: jest
        .fn()
        .mockReturnValueOnce([expired])
        .mockReturnValueOnce([expired])
        .mockReturnValueOnce([]),
      create: jest.fn(() => created),
      update: jest.fn().mockReturnValueOnce({}).mockReturnValueOnce(claimed),
    };
    const tx = {
      $executeRaw: jest.fn(() => 1),
      $queryRaw: jest.fn(() => [{ now: new Date() }]),
      storyExperiencePublication: delegate,
    };
    const prisma = prismaWithTransaction(tx);
    const gateway = {
      getGame: jest.fn(() => gameDetail(BUILD_ID)),
      publish: jest.fn(() => releaseResponse(newManifest)),
    };
    const service = serviceWith({ manifest: newManifest, prisma, gateway });

    await expect(
      service.publishBuild(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
        NEW_BUILD_ID,
        { status: 'published', setCurrent: true },
        'satoken=session',
      ),
    ).resolves.toEqual(releaseResponse(newManifest));
    expect(gateway.getGame.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.publish.mock.invocationCallOrder[0],
    );
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });

  it('durably claims a Java draft without creating public media authorization', async () => {
    const events: string[] = [];
    const claimed = draftReleaseRow({
      attemptCount: 1,
      firstAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      lastAttemptedByUserId: 'user-1',
      leaseOwner: 'draft-lease-1',
      leaseAcquiredAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const tx = draftClaimTransaction({
      existing: null,
      claimed,
      onCreate: () => events.push('draft-receipt'),
    });
    const prisma = prismaWithDraftTransaction(tx);
    prisma.storyExperienceDraftRelease.updateMany.mockImplementation(() => {
      events.push('confirmed');
      return { count: 1 };
    });
    const gateway = {
      publish: jest.fn(() => {
        events.push('java-post');
        return draftReleaseResponse(manifestFixture());
      }),
    };
    const service = serviceWith({ gateway, prisma });
    await expect(publishDraft(service)).resolves.toEqual(
      draftReleaseResponse(manifestFixture()),
    );
    expect(events).toEqual(['draft-receipt', 'java-post', 'confirmed']);
    expect(tx.storyExperienceDraftRelease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: BUILD_ID,
        storyProjectId: PROJECT_ID,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(prisma.storyExperiencePublication.updateMany).not.toHaveBeenCalled();
  });

  it('records an ambiguous draft response and only permits exact-request replay after backoff', async () => {
    const claimed = draftReleaseRow({
      status: 'pending',
      attemptCount: 1,
      firstAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      lastAttemptedByUserId: 'user-1',
      leaseOwner: 'draft-lease-unknown',
      leaseAcquiredAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const prisma = prismaWithDraftTransaction(
      draftClaimTransaction({ existing: draftReleaseRow(), claimed }),
    );
    const unknown = new StoryExperienceReleaseOutcomeUnknownException({
      code: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
      message: 'timeout',
    });
    const service = serviceWith({
      prisma,
      gateway: { publish: jest.fn(() => Promise.reject(unknown)) },
    });

    await expect(publishDraft(service)).rejects.toBe(unknown);
    expect(prisma.storyExperienceDraftRelease.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ leaseOwner: expect.any(String) }),
      data: {
        status: 'uncertain',
        nextAttemptAt: expect.any(Date),
        lastErrorCode: expect.any(String),
        lastErrorDetail: 'timeout',
        lastErrorAt: expect.any(Date),
      },
    });
  });

  it('terminalizes an uncertain draft receipt when the exact replay is definitively rejected', async () => {
    // A receipt left 'uncertain' by an ambiguous POST replays the exact
    // immutable request after backoff. Java deterministically rejecting that
    // replay proves the original never committed, so the receipt must
    // terminate as 'rejected' instead of rescheduling forever (it cannot be
    // deleted and its build_id is unique).
    const existing = draftReleaseRow({
      status: 'uncertain',
      attemptCount: 1,
      firstAttemptAt: new Date(Date.now() - 120_000),
      lastAttemptAt: new Date(Date.now() - 120_000),
      lastAttemptedByUserId: 'user-1',
      nextAttemptAt: new Date(Date.now() - 10_000),
      leaseOwner: 'dead-process',
      leaseAcquiredAt: new Date(Date.now() - 120_000),
      leaseExpiresAt: new Date(Date.now() - 60_000),
      lastErrorCode: 'JAVA_EXPERIENCE_RELEASE_UNAVAILABLE',
      lastErrorDetail: 'timeout',
      lastErrorAt: new Date(Date.now() - 120_000),
    });
    const claimed = draftReleaseRow({
      ...existing,
      attemptCount: 2,
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      leaseOwner: 'draft-lease-replay',
      leaseAcquiredAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 30_000),
    });
    const prisma = prismaWithDraftTransaction(
      draftClaimTransaction({ existing, claimed }),
    );
    const rejected = new BadGatewayException({
      code: 'JAVA_EXPERIENCE_RELEASE_REJECTED',
      message: 'invalid release',
    });
    const service = serviceWith({
      prisma,
      gateway: { publish: jest.fn(() => Promise.reject(rejected)) },
    });

    await expect(publishDraft(service)).rejects.toBe(rejected);
    expect(prisma.storyExperienceDraftRelease.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: { in: ['pending', 'uncertain'] },
      }),
      data: expect.objectContaining({
        status: 'rejected',
        rejectedAt: expect.any(Date),
        leaseOwner: null,
        nextAttemptAt: null,
        lastErrorCode: expect.any(String),
        lastErrorDetail: 'invalid release',
      }),
    });
  });

  it('replays a confirmed draft receipt without a second Java POST', async () => {
    const confirmed = draftReleaseRow({
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      confirmedAt: new Date(),
      attemptCount: 1,
      firstAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      lastAttemptedByUserId: 'user-1',
    });
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      prisma: prismaWithDraftTransaction(
        draftClaimTransaction({ existing: confirmed }),
      ),
    });

    await expect(publishDraft(service)).resolves.toEqual(
      draftReleaseResponse(manifestFixture()),
    );
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('rejects a mismatched draft receipt instead of changing idempotency identity', async () => {
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      prisma: prismaWithDraftTransaction(
        draftClaimTransaction({
          existing: draftReleaseRow({ requestHash: 'b'.repeat(64) }),
        }),
      ),
    });

    await expect(publishDraft(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_EXPERIENCE_DRAFT_RELEASE_RECEIPT_CONFLICT',
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('recovers an expired draft lease by marking the prior outcome uncertain before exact replay', async () => {
    const expired = draftReleaseRow({
      status: 'pending',
      attemptCount: 1,
      firstAttemptAt: new Date(Date.now() - 60_000),
      lastAttemptAt: new Date(Date.now() - 60_000),
      lastAttemptedByUserId: 'user-1',
      leaseOwner: 'dead-process',
      leaseAcquiredAt: new Date(Date.now() - 60_000),
      leaseExpiresAt: new Date(Date.now() - 30_000),
    });
    const tx = draftClaimTransaction({
      existing: expired,
      claimed: draftReleaseRow({
        status: 'uncertain',
        attemptCount: 2,
        firstAttemptAt: expired.firstAttemptAt,
        lastAttemptAt: new Date(),
        lastAttemptedByUserId: 'user-1',
        leaseOwner: 'fresh-process',
        leaseAcquiredAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 30_000),
        lastErrorCode: 'STORY_EXPERIENCE_DRAFT_RELEASE_CRASH_RECOVERY',
        lastErrorDetail: 'crash recovery',
        lastErrorAt: new Date(),
      }),
    });
    const gateway = {
      publish: jest.fn(() => draftReleaseResponse(manifestFixture())),
    };
    const service = serviceWith({
      gateway,
      prisma: prismaWithDraftTransaction(tx),
    });

    await expect(publishDraft(service)).resolves.toEqual(
      draftReleaseResponse(manifestFixture()),
    );
    expect(tx.storyExperienceDraftRelease.update).toHaveBeenCalledWith({
      where: { buildId: BUILD_ID },
      data: expect.objectContaining({
        status: 'uncertain',
        attemptCount: { increment: 1 },
        lastErrorCode: 'STORY_EXPERIENCE_DRAFT_RELEASE_CRASH_RECOVERY',
      }),
    });
    expect(gateway.publish).toHaveBeenCalledTimes(1);
  });

  it('publishes a valid Build with no frozen media assets', async () => {
    const service = serviceWith({ frozenAssetsAvailable: false });
    await expect(publish(service)).resolves.toEqual(
      releaseResponse(manifestFixture()),
    );
  });

  it('rejects a Build whose browser-safe frozen media no longer matches before contacting Java', async () => {
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      buildOverrides: {
        runtimeJson: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'STORY_BUILD_ASSET_METADATA_CHANGED',
            message: 'Frozen browser-safe playback metadata changed.',
            entityType: 'asset',
            entityId: 'asset-1',
          },
        ],
      },
    });

    await expect(publish(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_BUILD_NOT_PUBLISHABLE',
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('rejects a corrupt immutable manifest with a controlled conflict', async () => {
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      buildOverrides: { runtimeJson: { schemaVersion: 2 } },
    });

    await expect(publish(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_BUILD_MANIFEST_CORRUPT',
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('rejects a frozen manifest whose canonical hash no longer matches its Build', async () => {
    const gateway = { publish: jest.fn() };
    const service = serviceWith({
      gateway,
      buildOverrides: { runtimeHash: 'b'.repeat(64) },
    });

    await expect(publish(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_BUILD_MANIFEST_IDENTITY_MISMATCH',
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('rejects a manifest whose raw Build contentVersion identity was changed', async () => {
    const gateway = { publish: jest.fn() };
    const manifest = manifestFixture();
    manifest.contentVersion = OLD_BUILD_ID;
    const service = serviceWith({ gateway, manifest });

    await expect(publish(service)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_BUILD_MANIFEST_IDENTITY_MISMATCH',
      }),
    });
    expect(gateway.publish).not.toHaveBeenCalled();
  });
});

describe('StoryExperienceReleaseService authority reconciliation', () => {
  it('does not keep an interactive database transaction open during Java GET', async () => {
    const row = authorityRow({
      id: 'publication-current',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date('2026-07-16T11:00:00.000Z'),
      sourceDraftRevision: 7,
    });
    const tx = reconciliationTransaction([row]);
    const prisma = prismaWithTransaction(tx);
    let transactionDepth = 0;
    prisma.$transaction.mockImplementation(
      async (operation: (value: typeof tx) => unknown) => {
        transactionDepth += 1;
        try {
          return await operation(tx);
        } finally {
          transactionDepth -= 1;
        }
      },
    );
    const gateway = {
      getGame: jest.fn(() => {
        expect(transactionDepth).toBe(0);
        return gameDetail(BUILD_ID);
      }),
    };
    const service = serviceWith({ prisma, gateway });

    await service.reconcileProjectCurrent(PROJECT_ID, PROJECT_ID);

    expect(gateway.getGame).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('discards a slower stale Java response after a newer observation wins', async () => {
    const row = authorityRow({
      id: 'publication-v1',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date('2026-07-16T11:00:00.000Z'),
      sourceDraftRevision: 7,
    });
    const tx = reconciliationTransaction([row]);
    let rowVersion = '101';
    tx.$queryRaw.mockImplementation((query: TemplateStringsArray) =>
      query.join('').includes('xmin::text')
        ? [{ id: row.id, rowVersion }]
        : [{ now: new Date() }],
    );
    const persistedVersions: string[] = [];
    tx.storyExperiencePublication.update.mockImplementation((args) => {
      const data = args.data;
      const currentVersion = data.authorityCurrentVersion;
      if (typeof currentVersion === 'string') {
        persistedVersions.push(currentVersion);
      }
      rowVersion = String(Number(rowVersion) + 1);
      return {};
    });
    const prisma = prismaWithTransaction(tx);
    const slowResponse = deferred<ReturnType<typeof gameDetail>>();
    const newerAuthority = gameDetail(NEW_BUILD_ID);
    const gateway = {
      getGame: jest
        .fn()
        .mockReturnValueOnce(slowResponse.promise)
        .mockResolvedValue(newerAuthority),
    };
    const service = serviceWith({ prisma, gateway });

    const slowerRead = service.reconcileProjectCurrent(PROJECT_ID, PROJECT_ID);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const newerRead = await service.reconcileProjectCurrent(
      PROJECT_ID,
      PROJECT_ID,
    );
    slowResponse.resolve(gameDetail(BUILD_ID));
    const retriedRead = await slowerRead;

    expect(newerRead.currentVersion).toBe(NEW_BUILD_ID);
    expect(retriedRead.currentVersion).toBe(NEW_BUILD_ID);
    expect(gateway.getGame).toHaveBeenCalledTimes(3);
    expect(persistedVersions).toEqual([NEW_BUILD_ID, NEW_BUILD_ID]);
    expect(persistedVersions).not.toContain(BUILD_ID);
  });

  it('fails retryably instead of spinning when publication churn never settles', async () => {
    const row = authorityRow({
      id: 'publication-current',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date('2026-07-16T11:00:00.000Z'),
      sourceDraftRevision: 7,
    });
    const tx = reconciliationTransaction([row]);
    let tokenRead = 0;
    tx.$queryRaw.mockImplementation((query: TemplateStringsArray) => {
      if (!query.join('').includes('xmin::text')) {
        return [{ now: new Date() }];
      }
      tokenRead += 1;
      return [{ id: row.id, rowVersion: String(tokenRead) }];
    });
    const gateway = {
      getGame: jest.fn(() => gameDetail(BUILD_ID)),
    };
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway,
    });

    await expect(
      service.reconcileProjectCurrent(PROJECT_ID, PROJECT_ID),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'STORY_EXPERIENCE_AUTHORITY_OBSERVATION_SUPERSEDED',
      }),
    });
    expect(gateway.getGame).toHaveBeenCalledTimes(3);
    expect(tx.storyExperiencePublication.update).not.toHaveBeenCalled();
  });

  it('does not clear an active publish fence when current is queried', async () => {
    const checkedAt = new Date('2026-07-16T12:00:00.000Z');
    const pending = authorityRow({
      id: 'publication-in-flight',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'pending',
      sourceDraftRevision: 7,
    });
    Object.assign(pending, {
      leaseOwner: 'active-publisher',
      leaseAcquiredAt: new Date(checkedAt.getTime() - 1_000),
      leaseExpiresAt: new Date(checkedAt.getTime() + 30_000),
    });
    const tx = reconciliationTransaction([pending], checkedAt);
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway: { getGame: jest.fn(() => gameDetail(BUILD_ID)) },
    });

    await expect(
      service.getCurrentRelease(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
      ),
    ).resolves.toMatchObject({
      published: true,
      currentBuild: { id: BUILD_ID },
    });
    expect(tx.storyExperiencePublication.update).toHaveBeenCalledWith({
      where: { id: 'publication-in-flight' },
      data: { updatedAt: checkedAt },
    });
    expect(
      tx.storyExperiencePublication.update.mock.calls[0][0].data,
    ).not.toHaveProperty('leaseOwner');
  });

  it('recovers a crash after Java committed by confirming the pending Build', async () => {
    const pending = authorityRow({
      id: 'publication-current',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'pending',
      sourceDraftRevision: 7,
    });
    const tx = reconciliationTransaction([pending]);
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway: { getGame: jest.fn(() => gameDetail(BUILD_ID)) },
    });

    const current = await service.getCurrentRelease(
      { userId: 'user-1' } as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(current.currentBuild).toEqual({
      id: BUILD_ID,
      sourceDraftRevision: 7,
      videoSnapshotHash: HASH,
    });
    expect(tx.storyExperiencePublication.update).toHaveBeenCalledWith({
      where: { id: 'publication-current' },
      data: expect.objectContaining({
        status: 'confirmed',
        manifestUrl: MANIFEST_URL,
        authorityIsCurrent: true,
        leaseOwner: null,
      }),
    });
  });

  it('matches Java currentVersion against historical v1 when latest v2 is uncertain', async () => {
    const v1 = authorityRow({
      id: 'publication-v1',
      buildId: OLD_BUILD_ID,
      contentVersion: OLD_BUILD_ID,
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      sourceDraftRevision: 4,
    });
    const v2 = authorityRow({
      id: 'publication-v2',
      buildId: NEW_BUILD_ID,
      contentVersion: NEW_BUILD_ID,
      status: 'uncertain',
      sourceDraftRevision: 8,
    });
    const tx = reconciliationTransaction([v1, v2]);
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway: {
        getGame: jest.fn(() => gameDetail(OLD_BUILD_ID)),
      },
    });

    const current = await service.getCurrentRelease(
      { userId: 'user-1' } as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(current.currentBuild?.id).toBe(OLD_BUILD_ID);
    expect(current.currentBuild?.sourceDraftRevision).toBe(4);
    expect(tx.storyExperiencePublication.update).toHaveBeenCalledWith({
      where: { id: 'publication-v2' },
      data: expect.objectContaining({
        authorityIsCurrent: false,
        authorityCurrentVersion: OLD_BUILD_ID,
      }),
    });
  });

  it('exposes exact authoring identity so a newer draft is not marked published', async () => {
    const published = authorityRow({
      id: 'publication-v1',
      buildId: OLD_BUILD_ID,
      contentVersion: OLD_BUILD_ID,
      status: 'confirmed',
      manifestUrl: MANIFEST_URL,
      publishedAt: new Date(),
      sourceDraftRevision: 11,
    });
    const service = serviceWith({
      prisma: prismaWithTransaction(reconciliationTransaction([published])),
      gateway: {
        getGame: jest.fn(() => gameDetail(OLD_BUILD_ID)),
      },
    });
    const current = await service.getCurrentRelease(
      { userId: 'user-1' } as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    const currentSavedDraftRevision = 12;
    expect(current.currentBuild?.sourceDraftRevision).toBe(11);
    expect(current.currentBuild?.sourceDraftRevision).not.toBe(
      currentSavedDraftRevision,
    );
  });

  it('returns a normal unpublished state before the first lifecycle exists', async () => {
    const prisma = prismaWithTransaction(reconciliationTransaction([]));
    prisma.storyExperiencePublication.findFirst.mockResolvedValue(null);
    const gateway = { getGame: jest.fn() };
    const service = serviceWith({ prisma, gateway });
    await expect(
      service.getCurrentRelease(
        { userId: 'user-1' } as never,
        WORKSPACE_ID,
        PROJECT_ID,
      ),
    ).resolves.toEqual({
      projectId: PROJECT_ID,
      gameId: PROJECT_ID,
      published: false,
      currentVersion: null,
      manifestUrl: null,
      currentBuild: null,
      checkedAt: null,
    });
    expect(gateway.getGame).not.toHaveBeenCalled();
  });

  it('returns unpublished when the only local lifecycles were rejected', async () => {
    const prisma = prismaWithTransaction(reconciliationTransaction([]));
    prisma.storyExperiencePublication.findFirst.mockResolvedValue(null);
    const gateway = { getGame: jest.fn() };
    const service = serviceWith({ prisma, gateway });
    const current = await service.getCurrentRelease(
      { userId: 'user-1' } as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(current).toMatchObject({ published: false, currentBuild: null });
    expect(prisma.storyExperiencePublication.findFirst).toHaveBeenCalledWith({
      where: {
        storyProjectId: PROJECT_ID,
        status: { in: ['pending', 'uncertain', 'confirmed'] },
      },
      select: { id: true },
    });
    expect(gateway.getGame).not.toHaveBeenCalled();
  });

  it('persists explicit Java absence and releases an expired unknown fence', async () => {
    const uncertain = authorityRow({
      id: 'publication-unknown',
      buildId: BUILD_ID,
      contentVersion: BUILD_ID,
      status: 'uncertain',
      sourceDraftRevision: 2,
    });
    Object.assign(uncertain, {
      leaseOwner: 'dead-process',
      leaseExpiresAt: new Date(Date.now() - 5_000),
      reconciliationLeaseOwner: null,
    });
    const tx = reconciliationTransaction([uncertain]);
    const service = serviceWith({
      prisma: prismaWithTransaction(tx),
      gateway: { getGame: jest.fn(() => null) },
    });
    const current = await service.getCurrentRelease(
      { userId: 'user-1' } as never,
      WORKSPACE_ID,
      PROJECT_ID,
    );
    expect(current).toMatchObject({
      published: false,
      currentVersion: null,
      currentBuild: null,
      checkedAt: expect.any(String),
    });
    expect(tx.storyExperiencePublication.update).toHaveBeenCalledWith({
      where: { id: 'publication-unknown' },
      data: expect.objectContaining({
        authorityGameExists: false,
        authorityIsCurrent: false,
        authorityCheckedAt: expect.any(Date),
        nextReconciliationAt: null,
        leaseOwner: null,
      }),
    });
  });
});

describe('StoryExperiencePublication migration', () => {
  it('guards exact Build identity, authorization revocation and deletion', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260716180000_story_experience_publications/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('build_row."status" <> \'ready\'');
    expect(sql).toContain(
      'build_row."runtime_json"->>\'contentVersion\' IS DISTINCT FROM NEW."content_version"',
    );
    expect(sql).toContain(
      'Only a definitively rejected publication may revoke media authorization',
    );
    expect(sql).toContain('"story_experience_publications_no_delete_trg"');
  });

  it('keeps creator-only draft receipts immutable and separate from public authorization', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260718140000_story_external_command_intents/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('"story_experience_draft_releases"');
    expect(sql).toContain('"request_hash"');
    expect(sql).toContain(
      'Experience draft release receipts cannot be deleted',
    );
    expect(sql).toContain('Experience draft release identity is immutable');
    // A deterministic Java rejection of the idempotent replay must be able to
    // terminate a receipt wedged 'uncertain' — the lifecycle whitelist allows
    // uncertain -> rejected alongside uncertain -> confirmed.
    expect(sql).toContain(
      "OLD.\"status\" = 'uncertain' AND\n      NEW.\"status\" IN ('confirmed', 'rejected')",
    );
    expect(sql).not.toContain('media_authorized_at');
    expect(sql).not.toContain('authority_is_current');
  });
});

function releaseRequest(
  manifest: ReturnType<typeof manifestFixture>,
): ExperienceReleaseRequest {
  return {
    gameId: manifest.gameId,
    contentVersion: manifest.contentVersion,
    title: 'Branching Film Test',
    manifest,
    status: 'published',
    setCurrent: true,
  };
}

function releaseResponse(manifest: ReturnType<typeof manifestFixture>) {
  return {
    gameId: manifest.gameId,
    contentVersion: manifest.contentVersion,
    status: 'published' as const,
    manifestUrl: MANIFEST_URL,
  };
}

function draftReleaseResponse(manifest: ReturnType<typeof manifestFixture>) {
  return {
    gameId: manifest.gameId,
    contentVersion: manifest.contentVersion,
    status: 'draft' as const,
    manifestUrl: MANIFEST_URL,
  };
}

function gameDetail(currentVersion: string) {
  return {
    gameId: PROJECT_ID,
    title: 'Branching Film',
    currentVersion,
    manifestUrl: MANIFEST_URL,
  };
}

function javaResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ code: 200, msg: '成功', data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function publicationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'publication-1',
    buildId: BUILD_ID,
    storyProjectId: PROJECT_ID,
    gameId: PROJECT_ID,
    contentVersion: BUILD_ID,
    status: 'pending' as const,
    requestedSetCurrent: true,
    requestedByUserId: 'user-1',
    mediaAuthorizedAt: new Date(),
    mediaAuthorizationRevokedAt: null,
    manifestUrl: null,
    publishedAt: null,
    rejectedAt: null,
    attemptCount: 0,
    firstAttemptAt: null,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastAttemptedByUserId: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    lastErrorAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function draftReleaseRow(overrides: Record<string, unknown> = {}) {
  const manifest = manifestFixture();
  return {
    id: 'draft-release-1',
    buildId: BUILD_ID,
    storyProjectId: PROJECT_ID,
    gameId: PROJECT_ID,
    contentVersion: BUILD_ID,
    requestHash: canonicalJsonHash({
      gameId: manifest.gameId,
      contentVersion: manifest.contentVersion,
      title: 'Branching Film Test',
      subtitle: '第一季 · 无字来客',
      manifest,
      status: 'draft',
      setCurrent: false,
    }),
    status: 'pending' as const,
    requestedByUserId: 'user-1',
    manifestUrl: null,
    confirmedAt: null,
    rejectedAt: null,
    attemptCount: 0,
    firstAttemptAt: null,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastAttemptedByUserId: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorDetail: null,
    lastErrorAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function authorityRow(input: {
  id: string;
  buildId: string;
  contentVersion: string;
  status: 'pending' | 'confirmed' | 'uncertain' | 'rejected';
  manifestUrl?: string | null;
  publishedAt?: Date | null;
  sourceDraftRevision: number;
}) {
  return {
    ...publicationRow({
      id: input.id,
      buildId: input.buildId,
      contentVersion: input.contentVersion,
      status: input.status,
      manifestUrl: input.manifestUrl ?? null,
      publishedAt: input.publishedAt ?? null,
    }),
    build: {
      id: input.buildId,
      sourceDraftRevision: input.sourceDraftRevision,
      videoSnapshotHash: HASH,
    },
  };
}

function claimTransaction(input: {
  existing: ReturnType<typeof publicationRow> | null;
  competing?: ReturnType<typeof publicationRow> | null;
  created?: ReturnType<typeof publicationRow>;
  claimed?: ReturnType<typeof publicationRow>;
  onCreate?: () => void;
  clock?: Date;
}) {
  return {
    $executeRaw: jest.fn(() => 1),
    $queryRaw: jest.fn(() => [{ now: input.clock ?? new Date() }]),
    storyExperiencePublication: {
      findUnique: jest.fn(() => input.existing),
      findMany: jest.fn(() => (input.competing ? [input.competing] : [])),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        void args;
        input.onCreate?.();
        return input.created ?? publicationRow();
      }),
      update: jest.fn(
        (args: {
          where?: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          void args;
          return (
            input.claimed ??
            publicationRow({
              status: input.existing?.status ?? 'pending',
              leaseOwner: 'lease-1',
              leaseExpiresAt: new Date(Date.now() + 30_000),
            })
          );
        },
      ),
    },
  };
}

function draftClaimTransaction(input: {
  existing: ReturnType<typeof draftReleaseRow> | null;
  created?: ReturnType<typeof draftReleaseRow>;
  claimed?: ReturnType<typeof draftReleaseRow>;
  onCreate?: () => void;
  clock?: Date;
}) {
  return {
    $executeRaw: jest.fn(() => 1),
    $queryRaw: jest.fn(() => [{ now: input.clock ?? new Date() }]),
    storyExperienceDraftRelease: {
      findUnique: jest.fn(() => input.existing),
      create: jest.fn(() => {
        input.onCreate?.();
        return input.created ?? draftReleaseRow();
      }),
      update: jest.fn(
        () =>
          input.claimed ??
          draftReleaseRow({
            status: input.existing?.status ?? 'pending',
            attemptCount: (input.existing?.attemptCount ?? 0) + 1,
            leaseOwner: 'draft-lease-1',
            leaseExpiresAt: new Date(Date.now() + 30_000),
          }),
      ),
    },
  };
}

function reconciliationTransaction(
  rows: ReturnType<typeof authorityRow>[],
  clock = new Date(),
) {
  return {
    $executeRaw: jest.fn(() => 1),
    $queryRaw: jest.fn((query: TemplateStringsArray) =>
      query.join('').includes('xmin::text')
        ? rows.map((row) => ({
            id: row.id,
            rowVersion:
              (row as typeof row & { rowVersion?: string }).rowVersion ??
              `version:${row.id}`,
          }))
        : [{ now: clock }],
    ),
    storyExperiencePublication: {
      findMany: jest.fn(() => rows),
      update: jest.fn(
        (args: {
          where?: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          void args;
          return {};
        },
      ),
    },
  };
}

function prismaWithTransaction(tx: object) {
  return {
    $transaction: jest.fn((operation: (value: object) => unknown) =>
      operation(tx),
    ),
    $queryRaw: jest.fn(() => [{ now: new Date() }]),
    storyExperiencePublication: {
      updateMany: jest.fn(
        (args: {
          where?: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          void args;
          return { count: 1 };
        },
      ),
      findUnique: jest.fn(() => null),
      findFirst: jest.fn(
        (): Promise<{ id: string } | null> =>
          Promise.resolve({ id: 'publication-1' }),
      ),
    },
  };
}

function prismaWithDraftTransaction(tx: object) {
  return {
    $transaction: jest.fn((operation: (value: object) => unknown) =>
      operation(tx),
    ),
    $queryRaw: jest.fn(() => [{ now: new Date() }]),
    storyExperiencePublication: {
      updateMany: jest.fn(() => ({ count: 1 })),
      findUnique: jest.fn(() => null),
      findFirst: jest.fn(() => null),
    },
    storyExperienceDraftRelease: {
      updateMany: jest.fn(() => ({ count: 1 })),
      findUnique: jest.fn(() => null),
    },
  };
}

function serviceWith(input: {
  manifest?: ReturnType<typeof manifestFixture>;
  gateway?: object;
  prisma?: object;
  frozenAssetsAvailable?: boolean;
  buildOverrides?: Record<string, unknown>;
  writeGuard?: object;
  permissions?: object;
}) {
  const manifest = input.manifest ?? manifestFixture();
  return new StoryExperienceReleaseService(
    (input.permissions ?? {
      requireProject: jest.fn(() => ({
        project: { workspaceId: WORKSPACE_ID },
      })),
    }) as never,
    {
      getBuild: jest.fn(() => ({
        id: manifest.buildId,
        status: 'ready',
        scope: { kind: 'full' },
        sourceDraftRevision: 7,
        videoSnapshotHash: HASH,
        runtimeSchemaVersion: 2,
        runtimeJson: manifest,
        runtimeHash: canonicalJsonHash(manifest),
        completedAt: new Date().toISOString(),
        assets:
          input.frozenAssetsAvailable === false
            ? []
            : [
                {
                  id: 'frozen-theme',
                  buildId: manifest.buildId,
                  clipId: null,
                  role: 'runtime',
                  logicalKey: 'theme.config',
                  assetId: 'theme.config.source',
                  variantId: 'theme.config.variant',
                  checksumSha256: HASH,
                  contentType: 'application/json',
                  width: null,
                  height: null,
                  durationMs: null,
                  browserSafeMp4: null,
                  sizeBytes: '128',
                },
              ],
        diagnostics: [],
        ...input.buildOverrides,
      })),
    } as never,
    (input.gateway ?? {
      publish: jest.fn(() => releaseResponse(manifest)),
      getGame: jest.fn(() => gameDetail(manifest.contentVersion)),
    }) as never,
    (input.prisma ??
      prismaWithTransaction(claimTransaction({ existing: null }))) as never,
    (input.writeGuard ?? {
      assertHumanWriteAllowed: jest.fn(),
    }) as never,
  );
}

function publish(service: StoryExperienceReleaseService) {
  return service.publishBuild(
    { userId: 'user-1' } as never,
    WORKSPACE_ID,
    PROJECT_ID,
    BUILD_ID,
    { status: 'published', setCurrent: true },
    'satoken=session',
  );
}

function publishDraft(service: StoryExperienceReleaseService) {
  return service.publishBuild(
    { userId: 'user-1' } as never,
    WORKSPACE_ID,
    PROJECT_ID,
    BUILD_ID,
    { status: 'draft', setCurrent: false },
    'satoken=session',
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
