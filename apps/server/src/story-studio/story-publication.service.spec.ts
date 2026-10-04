import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth';
import { canonicalJsonHash } from './canonical-json';
import type { SubmitStoryPublicationInput } from './story-publication.dto';
import { StoryPublicationService } from './story-publication.service';

const PROJECT = '019f60f4-b101-70d4-8000-000000000002';
const BUILD = '019f60f4-b101-70d4-8000-000000000011';
const actor = { userId: 'producer-2' } as AuthUser;
const request: SubmitStoryPublicationInput = {
  gameId: PROJECT,
  contentVersion: BUILD,
  status: 'draft',
  setCurrent: true,
  title: 'Frozen title',
  coverUrl: 'https://media.test.invalid/cover.jpg',
  manifest: {
    gameId: PROJECT,
    buildId: BUILD,
    contentVersion: BUILD,
    frozen: true,
  },
};

function setup() {
  const build = {
    id: BUILD,
    storyProjectId: PROJECT,
    status: 'ready',
    completedAt: new Date(),
    runtimeSchemaVersion: 2,
    runtimeJson: request.manifest,
    runtimeHash: canonicalJsonHash(request.manifest),
  };
  const receipt = {
    requestHash: canonicalJsonHash(request),
    build,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ acquired: true }]),
    storyExperienceDraftRelease: {
      findFirst: jest.fn().mockResolvedValue(receipt),
    },
    storyExperienceGameRelease: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    $transaction: jest.fn((run: (value: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: 'workspace-1' },
      role: 'producer',
    }),
  };
  const reviewing = {
    gameId: PROJECT,
    status: 'reviewing',
    draftVersion: BUILD,
    rejectReason: null,
  };
  const java = {
    read: jest.fn().mockResolvedValue({
      gameId: PROJECT,
      status: 'draft',
      draftVersion: BUILD,
    }),
    upload: jest.fn().mockResolvedValue(undefined),
    transition: jest.fn().mockResolvedValue(reviewing),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const liveBuild: {
    id: string;
    projectId: string;
    kind: string;
    status: string;
    completedAt: string;
    runtimeSchemaVersion: number;
    runtimeJson: Record<string, unknown> | null;
    runtimeHash: string;
    diagnostics: Array<{ severity: string; message: string }>;
  } = {
    id: BUILD,
    projectId: PROJECT,
    kind: 'production',
    status: 'ready',
    completedAt: new Date().toISOString(),
    runtimeSchemaVersion: 2,
    runtimeJson: request.manifest,
    runtimeHash: build.runtimeHash,
    diagnostics: [],
  };
  const builds = { getBuild: jest.fn().mockResolvedValue(liveBuild) };
  const service = new StoryPublicationService(
    permissions as never,
    prisma as never,
    java as never,
    audit as never,
    builds as never,
  );
  return {
    service,
    permissions,
    prisma,
    tx,
    java,
    audit,
    receipt,
    build,
    builds,
    liveBuild,
    reviewing,
  };
}

describe('Project publication permissions and frozen receipts (fixture Java)', () => {
  afterEach(() => jest.useRealTimers());
  it('allows an editor to read Java management state through story.read', async () => {
    const t = setup();
    await expect(
      t.service.read({ userId: 'editor' } as AuthUser, PROJECT),
    ).resolves.toEqual({
      gameId: PROJECT,
      status: 'draft',
      rejectReason: null,
    });
    expect(t.permissions.requireProject).toHaveBeenCalledWith(
      'editor',
      PROJECT,
      'story.read',
    );
  });
  it.each(['read', 'submit', 'offline'] as const)(
    'never contacts Java when project %s authorization fails',
    async (action) => {
      const t = setup();
      t.permissions.requireProject.mockRejectedValue(
        new ForbiddenException({
          code: 'STORY_PERMISSION_DENIED',
          message: 'No permission',
        }),
      );
      const result =
        action === 'submit'
          ? t.service.submit(actor, PROJECT, request, 'satoken=actual-producer')
          : t.service[action](actor, PROJECT);
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(t.java.read).not.toHaveBeenCalled();
      expect(t.java.upload).not.toHaveBeenCalled();
      expect(t.java.transition).not.toHaveBeenCalled();
      expect(t.audit.record).not.toHaveBeenCalled();
    },
  );
  it('allows a producer to upload their exact prepared candidate and submit with their own actor session', async () => {
    const t = setup();
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actual-producer'),
    ).resolves.toEqual({
      gameId: PROJECT,
      status: 'reviewing',
      rejectReason: null,
    });
    expect(t.java.upload).toHaveBeenCalledWith(
      request,
      'satoken=actual-producer',
      expect.any(AbortSignal),
    );
    expect(t.java.transition).toHaveBeenCalledWith(
      PROJECT,
      'submit',
      expect.any(AbortSignal),
    );
    expect(t.tx.storyExperienceDraftRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: PROJECT,
          gameId: PROJECT,
          contentVersion: BUILD,
          status: { not: 'rejected' },
        },
      }),
    );
    const rows = t.audit.record.mock.calls.map(
      ([row]) => row as Record<string, unknown>,
    );
    expect(rows.map((row) => row.action)).toEqual([
      'story_publication.submit.requested',
      'story_publication.submit.completed',
    ]);
    expect(
      rows.every(
        (row) => row.actorUserId === actor.userId && row.entityId === PROJECT,
      ),
    ).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('satoken');
  });
  it.each([
    'gameId',
    'title',
    'coverUrl',
    'contentVersion',
    'manifest',
  ] as const)(
    'rejects a client-forged %s before any Java write',
    async (field) => {
      const t = setup();
      const bad = {
        ...request,
        [field]: field === 'manifest' ? { replaced: true } : 'forged-value',
      };
      await expect(
        t.service.submit(
          actor,
          PROJECT,
          bad as SubmitStoryPublicationInput,
          'satoken=actor',
        ),
      ).rejects.toMatchObject({
        status: ['gameId', 'coverUrl'].includes(field) ? 400 : 409,
      });
      expect(t.java.upload).not.toHaveBeenCalled();
      expect(t.java.transition).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: 'published' },
    { setCurrent: false },
    { action: 'approve' },
  ])('rejects a moderation/bypass-shaped submission', async (extra) => {
    const t = setup();
    await expect(
      t.service.submit(
        actor,
        PROJECT,
        { ...request, ...extra } as SubmitStoryPublicationInput,
        'satoken=actor',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(t.java.upload).not.toHaveBeenCalled();
  });
  it.each([
    'missing',
    'hash',
    'build-status',
    'build-runtime',
    'build-project',
    'build-identity',
    'build-diagnostics',
    'build-media-hash',
    'single-preview',
    'media',
  ] as const)('refuses an unverified candidate: %s', async (problem) => {
    const t = setup();
    if (problem === 'missing')
      t.tx.storyExperienceDraftRelease.findFirst.mockResolvedValue(null);
    if (problem === 'hash') t.receipt.requestHash = 'wrong';
    if (problem === 'build-status') t.build.status = 'failed';
    if (problem === 'build-runtime') t.build.runtimeHash = 'wrong';
    if (problem === 'build-project') t.build.storyProjectId = 'other-project';
    if (problem === 'build-identity')
      t.liveBuild.runtimeJson = {
        ...request.manifest,
        gameId: 'other-project',
      };
    if (problem === 'build-media-hash') t.liveBuild.runtimeHash = 'changed';
    if (problem === 'single-preview') t.liveBuild.kind = 'preview';
    if (problem === 'build-diagnostics' || problem === 'media') {
      t.liveBuild.runtimeJson = null;
      t.liveBuild.diagnostics = [
        { severity: 'error', message: 'Exact frozen media is blocked' },
      ];
    }
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({
      status: [
        'media',
        'build-identity',
        'build-diagnostics',
        'build-media-hash',
        'single-preview',
      ].includes(problem)
        ? 422
        : 409,
    });
    expect(t.java.read).not.toHaveBeenCalled();
    expect(t.java.upload).not.toHaveBeenCalled();
  });
  it('accepts the existing multichapter preview Builds only through their frozen game receipt', async () => {
    const t = setup();
    t.liveBuild.kind = 'preview';
    const second = {
      ...t.build,
      id: 'chapter-two',
      runtimeJson: {
        ...request.manifest,
        buildId: 'chapter-two',
        contentVersion: 'chapter-two',
      },
    };
    second.runtimeHash = canonicalJsonHash(second.runtimeJson);
    t.tx.storyExperienceDraftRelease.findFirst.mockResolvedValue(null);
    t.tx.storyExperienceGameRelease.findFirst.mockResolvedValue({
      requestHash: canonicalJsonHash(request),
      chapters: [{ build: t.build }, { build: second }],
    });
    t.builds.getBuild.mockImplementation(
      (_user: AuthUser, projectId: string, buildId: string) =>
        buildId === BUILD
          ? t.liveBuild
          : {
              ...t.liveBuild,
              id: buildId,
              projectId,
              runtimeJson: second.runtimeJson,
              runtimeHash: second.runtimeHash,
            },
    );
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).resolves.toMatchObject({ status: 'reviewing' });
    expect(t.builds.getBuild).toHaveBeenCalledTimes(2);
    expect(t.builds.getBuild).toHaveBeenCalledWith(
      actor,
      PROJECT,
      'chapter-two',
    );
  });
  it('requires a multichapter receipt with unrevoked anonymous media authorization', async () => {
    const t = setup();
    t.tx.storyExperienceDraftRelease.findFirst.mockResolvedValue(null);
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 409 });
    expect(t.tx.storyExperienceGameRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          storyProjectId: PROJECT,
          gameId: PROJECT,
          contentVersion: BUILD,
          status: { not: 'rejected' },
          mediaAuthorizationRevokedAt: null,
        },
      }),
    );
    expect(t.java.read).not.toHaveBeenCalled();
  });
  it('rejects ambiguous single and multichapter receipts before contacting Java', async () => {
    const t = setup();
    t.tx.storyExperienceGameRelease.findFirst.mockResolvedValue({
      requestHash: canonicalJsonHash(request),
      chapters: [{ build: t.build }],
    });
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 409 });
    expect(t.java.read).not.toHaveBeenCalled();
  });
  it('recovers a lost success response for the same reviewing version without uploading twice', async () => {
    const t = setup();
    t.java.read.mockResolvedValue(t.reviewing);
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).resolves.toMatchObject({ status: 'reviewing' });
    expect(t.java.upload).not.toHaveBeenCalled();
    expect(t.java.transition).not.toHaveBeenCalled();
  });
  it.each(['published', 'reviewing'])(
    'does not overwrite a %s candidate',
    async (status) => {
      const t = setup();
      t.java.read.mockResolvedValue({
        gameId: PROJECT,
        status,
        draftVersion: 'other-version',
      });
      await expect(
        t.service.submit(actor, PROJECT, request, 'satoken=actor'),
      ).rejects.toMatchObject({ status: 409 });
      expect(t.java.upload).not.toHaveBeenCalled();
    },
  );
  it('never submits a different Java draft after uploading its candidate', async () => {
    const t = setup();
    t.java.read
      .mockResolvedValueOnce({
        gameId: PROJECT,
        status: 'draft',
        draftVersion: BUILD,
      })
      .mockResolvedValueOnce({
        gameId: PROJECT,
        status: 'draft',
        draftVersion: 'someone-elses-version',
      });
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 409 });
    expect(t.java.transition).not.toHaveBeenCalled();
  });
  it('rechecks permissions immediately before the upload', async () => {
    const t = setup();
    t.permissions.requireProject
      .mockResolvedValueOnce({ project: { workspaceId: 'workspace-1' } })
      .mockResolvedValueOnce({ project: { workspaceId: 'workspace-1' } })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 403 });
    expect(t.java.upload).not.toHaveBeenCalled();
  });
  it('rechecks permissions before changing status when a member was removed during upload', async () => {
    const t = setup();
    for (let i = 0; i < 3; i++)
      t.permissions.requireProject.mockResolvedValueOnce({
        project: { workspaceId: 'workspace-1' },
      });
    t.permissions.requireProject.mockRejectedValueOnce(
      new ForbiddenException(),
    );
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 403 });
    expect(t.java.upload).toHaveBeenCalledTimes(1);
    expect(t.java.transition).not.toHaveBeenCalled();
  });
  it('refuses a competing project mutation before contacting Java', async () => {
    const t = setup();
    t.tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STORY_PUBLICATION_BUSY' },
    });
    expect(t.java.read).not.toHaveBeenCalled();
    expect(t.audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'story_publication.submit.failed',
        actorUserId: actor.userId,
      }),
    );
  });
  it.each(['submit', 'offline'] as const)(
    'does not issue a Java %s write after the lock transaction becomes unusable',
    async (action) => {
      const t = setup();
      t.tx.$queryRaw
        .mockResolvedValueOnce([{ acquired: true }])
        .mockRejectedValueOnce(new Error('Transaction is already closed'));
      if (action === 'offline')
        t.java.read.mockResolvedValue({ gameId: PROJECT, status: 'published' });
      const result =
        action === 'submit'
          ? t.service.submit(actor, PROJECT, request, 'satoken=actor')
          : t.service.offline(actor, PROJECT);
      await expect(result).rejects.toMatchObject({
        status: 503,
        response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
      });
      expect(t.java.upload).not.toHaveBeenCalled();
      expect(t.java.transition).not.toHaveBeenCalled();
      expect(t.tx.$queryRaw).toHaveBeenCalledTimes(2);
    },
  );

  it('revalidates the lock again after uploading and stops before the submit transition', async () => {
    const t = setup();
    t.tx.$queryRaw
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ alive: 1 }])
      .mockRejectedValueOnce(new Error('Transaction ended during upload'));
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
    });
    expect(t.java.upload).toHaveBeenCalledTimes(1);
    expect(t.java.transition).not.toHaveBeenCalled();
    expect(t.tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('stops a slow Build validation at the shared deadline without extending the transaction timeout', async () => {
    jest.useFakeTimers();
    const t = setup();
    let releaseBuild!: (build: typeof t.liveBuild) => void;
    let started!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.builds.getBuild.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        releaseBuild = resolve;
      });
    });
    const result = t.service.submit(actor, PROJECT, request, 'satoken=actor');
    const stopped = expect(result).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
    });
    await validationStarted;
    await jest.advanceTimersByTimeAsync(25_000);
    releaseBuild(t.liveBuild);
    await stopped;
    expect(t.java.read).not.toHaveBeenCalled();
    expect(t.java.upload).not.toHaveBeenCalled();
    expect(t.java.transition).not.toHaveBeenCalled();
    expect(t.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
  });

  it('aborts an abandoned transaction callback before a late Build validation can continue into Java', async () => {
    const t = setup();
    let releaseBuild!: (build: typeof t.liveBuild) => void;
    let started!: () => void;
    let closeTransaction!: (error: Error) => void;
    let callback!: Promise<unknown>;
    const validationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.builds.getBuild.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        releaseBuild = resolve;
      });
    });
    t.prisma.$transaction.mockImplementationOnce((run) => {
      callback = run(t.tx);
      void callback.catch(() => undefined);
      return new Promise((_resolve, reject) => {
        closeTransaction = reject;
      });
    });
    const result = t.service.submit(actor, PROJECT, request, 'satoken=actor');
    const stopped = expect(result).rejects.toMatchObject({ status: 503 });
    await validationStarted;
    closeTransaction(
      Object.assign(new Error('Transaction expired'), { code: 'P2028' }),
    );
    await stopped;
    releaseBuild(t.liveBuild);
    await expect(callback).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
    });
    expect(t.java.read).not.toHaveBeenCalled();
    expect(t.java.upload).not.toHaveBeenCalled();
    expect(t.java.transition).not.toHaveBeenCalled();
  });

  it('shares one deadline across Java calls and never sends a transition after an uncooperative timed-out upload', async () => {
    jest.useFakeTimers();
    const t = setup();
    let finishUpload!: () => void;
    let started!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    t.java.upload.mockImplementationOnce(() => {
      started();
      return new Promise<void>((resolve) => {
        finishUpload = resolve;
      });
    });
    const result = t.service.submit(actor, PROJECT, request, 'satoken=actor');
    const stopped = expect(result).rejects.toMatchObject({ status: 503 });
    await uploadStarted;
    const [, , signal] = t.java.upload.mock.calls[0] as [
      unknown,
      unknown,
      AbortSignal,
    ];
    const [, readSignal] = t.java.read.mock.calls[0] as [unknown, AbortSignal];
    expect(signal.aborted).toBe(false);
    expect(readSignal).toBe(signal);
    await jest.advanceTimersByTimeAsync(25_000);
    expect(signal.aborted).toBe(true);
    // An upstream can still complete a request after client-side cancellation.
    finishUpload();
    await stopped;
    expect(t.java.read).toHaveBeenCalledTimes(1);
    expect(t.java.transition).not.toHaveBeenCalled();
  });

  it('persists a failed actor audit without claiming an upstream rejection is draft', async () => {
    const t = setup();
    const error = new BadGatewayException({
      code: 'STORY_PUBLICATION_UPSTREAM_FAILED',
      upstreamCode: 403,
      message: 'Service token rejected',
    });
    t.java.read.mockRejectedValue(error);
    await expect(
      t.service.submit(actor, PROJECT, request, 'satoken=actor'),
    ).rejects.toBe(error);
    const lastAuditCall = t.audit.record.mock.calls.at(-1) as
      | [unknown]
      | undefined;
    expect(lastAuditCall?.[0]).toMatchObject({
      action: 'story_publication.submit.failed',
      metadata: { upstreamCode: 403 },
    });
    expect(t.java.upload).not.toHaveBeenCalled();
  });
  it.each(['reviewing', 'published'])(
    'allows the release-capable actor to withdraw a %s work',
    async (status) => {
      const t = setup();
      t.java.read.mockResolvedValue({
        gameId: PROJECT,
        status,
        draftVersion: BUILD,
      });
      t.java.transition.mockResolvedValue({
        gameId: PROJECT,
        status: 'offline',
        draftVersion: BUILD,
      });
      await expect(t.service.offline(actor, PROJECT)).resolves.toMatchObject({
        status: 'offline',
      });
      expect(t.java.transition).toHaveBeenCalledWith(
        PROJECT,
        'offline',
        expect.any(AbortSignal),
      );
      expect(t.java.upload).not.toHaveBeenCalled();
    },
  );
  it('returns offline idempotently without another Java write', async () => {
    const t = setup();
    t.java.read.mockResolvedValue({
      gameId: PROJECT,
      status: 'offline',
      draftVersion: BUILD,
    });
    await expect(t.service.offline(actor, PROJECT)).resolves.toMatchObject({
      status: 'offline',
    });
    expect(t.java.transition).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'published', draftVersion: BUILD },
    { status: 'reviewing', draftVersion: 'different-version' },
  ])(
    'fails if Java reports the wrong final state or version',
    async (detail) => {
      const t = setup();
      t.java.transition.mockResolvedValue({
        gameId: PROJECT,
        ...detail,
      });
      await expect(
        t.service.submit(actor, PROJECT, request, 'satoken=actor'),
      ).rejects.toMatchObject({ status: 502 });
    },
  );
});
