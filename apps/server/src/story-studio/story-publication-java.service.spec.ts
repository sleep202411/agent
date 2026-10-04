import { StoryPublicationJavaService } from './story-publication-java.service';

const GAME = '019f60f4-b101-70d4-8000-000000000002';
const VERSION = '019f60f4-b101-70d4-8000-000000000011';
const BASE = 'https://java.test.invalid/studio';
const TOKEN = 'fixture-service-token';
const detail = {
  gameId: GAME,
  status: 'draft',
  draftVersion: VERSION,
  rejectReason: null,
};
const candidate = {
  gameId: GAME,
  contentVersion: VERSION,
  status: 'draft' as const,
  setCurrent: true,
  manifest: { frozen: true },
};

describe('Java project publication adapter (fixture responses)', () => {
  const original = {
    url: process.env.JAVA_STUDIO_URL,
    token: process.env.JAVA_ADMIN_API_TOKEN,
    header: process.env.JAVA_ADMIN_API_TOKEN_HEADER,
  };
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    process.env.JAVA_STUDIO_URL = BASE;
    process.env.JAVA_ADMIN_API_TOKEN = TOKEN;
    delete process.env.JAVA_ADMIN_API_TOKEN_HEADER;
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response(detail));
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });
  afterAll(() => {
    restore('JAVA_STUDIO_URL', original.url);
    restore('JAVA_ADMIN_API_TOKEN', original.token);
    restore('JAVA_ADMIN_API_TOKEN_HEADER', original.header);
  });

  it.each(['JAVA_STUDIO_URL', 'JAVA_ADMIN_API_TOKEN'])(
    'fails readiness when %s is missing',
    (name) => {
      delete process.env[name];
      expect(() => new StoryPublicationJavaService()).toThrow(name);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://user:password@java.test.invalid',
    'https://java.test.invalid/?secret=value',
    'file:///tmp/java',
  ])('rejects an unsafe base URL', (value) => {
    process.env.JAVA_STUDIO_URL = value;
    expect(() => new StoryPublicationJavaService()).toThrow('JAVA_STUDIO_URL');
  });
  it.each(['Cookie', 'Authorization', 'Host', 'Bad\nHeader'])(
    'rejects a credential header collision: %s',
    (name) => {
      process.env.JAVA_ADMIN_API_TOKEN_HEADER = name;
      expect(() => new StoryPublicationJavaService()).toThrow(
        'JAVA_ADMIN_API_TOKEN_HEADER',
      );
    },
  );
  it('does not echo a malformed service credential in readiness errors', () => {
    const malformedToken = 'fixture-secret\ninvalid-header-value';
    process.env.JAVA_ADMIN_API_TOKEN = malformedToken;
    let error: unknown;
    try {
      new StoryPublicationJavaService();
    } catch (value) {
      error = value;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'JAVA_ADMIN_API_TOKEN must be a valid HTTP header value.',
    );
    expect((error as Error).stack).not.toContain(malformedToken);
    expect((error as Error).stack).not.toContain('fixture-secret');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('reads the private management detail with only the service credential', async () => {
    const svc = new StoryPublicationJavaService();
    await expect(svc.read(GAME)).resolves.toEqual(detail);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/admin/interactive-film/${GAME}`);
    const headers = new Headers(init.headers);
    expect(headers.get('X-Admin-Api-Token')).toBe(TOKEN);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    });
  });
  it('sends only submit/offline to the existing service status route', async () => {
    const svc = new StoryPublicationJavaService();
    await svc.transition(GAME, 'submit');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/admin/interactive-film/${GAME}/status`);
    expect(JSON.parse(init.body as string)).toEqual({ action: 'submit' });
    expect(new Headers(init.headers).has('cookie')).toBe(false);
  });
  it('uploads with the actual actor cookie and never sends the admin token on the user route', async () => {
    fetchSpy.mockResolvedValueOnce(
      response({
        gameId: GAME,
        contentVersion: VERSION,
        status: 'draft',
        manifestUrl: 'https://media.test.invalid/manifest.json',
      }),
    );
    const svc = new StoryPublicationJavaService();
    await svc.upload(candidate, 'satoken=actual-actor');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/user/interactive-film/releases`);
    expect(new Headers(init.headers).get('cookie')).toBe(
      'satoken=actual-actor',
    );
    expect(new Headers(init.headers).has('X-Admin-Api-Token')).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual(candidate);
  });
  it('maps only a real not-found business envelope to an absent publication', async () => {
    fetchSpy.mockResolvedValueOnce(response(null, 404, 'game not found'));
    await expect(
      new StoryPublicationJavaService().read(GAME),
    ).resolves.toBeNull();
    fetchSpy.mockResolvedValueOnce(
      new Response('missing route', { status: 404 }),
    );
    await expect(
      new StoryPublicationJavaService().read(GAME),
    ).rejects.toMatchObject({ status: 503 });
  });
  it.each([302, 401, 403])(
    'keeps service auth %s distinct from player permissions/session',
    async (code) => {
      fetchSpy.mockResolvedValueOnce(
        response(null, code, 'Upstream denied exactly'),
      );
      await expect(
        new StoryPublicationJavaService().read(GAME),
      ).rejects.toMatchObject({
        status: 502,
        response: {
          code: 'STORY_PUBLICATION_UPSTREAM_FAILED',
          upstreamCode: code,
          msg: 'Upstream denied exactly',
          message: 'Upstream denied exactly',
          kind: 'service_authentication',
        },
      });
    },
  );
  it.each(['read', 'submit', 'offline'] as const)(
    'redacts the known service credential from %s business errors',
    async (action) => {
      fetchSpy.mockResolvedValueOnce(
        response(null, 403, `Denied token=${TOKEN}; request another grant`),
      );
      const service = new StoryPublicationJavaService();
      const error = await (
        action === 'read'
          ? service.read(GAME)
          : service.transition(GAME, action)
      ).catch((value: unknown) => value);
      expect(error).toMatchObject({
        status: 502,
        response: {
          code: 'STORY_PUBLICATION_UPSTREAM_FAILED',
          message: 'Denied token=[redacted]; request another grant',
          msg: 'Denied token=[redacted]; request another grant',
          upstreamCode: 403,
          upstreamHttpStatus: 200,
          kind: 'service_authentication',
        },
      });
      expect(JSON.stringify(error)).not.toContain(TOKEN);
      expect((error as Error).message).not.toContain(TOKEN);
    },
  );
  it('redacts the actual actor cookie and each satoken value from an upload error', async () => {
    const actorToken = 'actor.token.+*|(?)';
    const secondToken = 'another-actor-token';
    const actorCookie = `satoken=${actorToken}; language=en-US; satoken=${secondToken}`;
    fetchSpy.mockResolvedValueOnce(
      response(
        null,
        302,
        `Expired cookie=${actorCookie}; actor=${actorToken}; second=${secondToken}; service=${TOKEN}; retry after sign-in`,
      ),
    );
    const error = await new StoryPublicationJavaService()
      .upload(candidate, actorCookie)
      .catch((value: unknown) => value);
    const expected =
      'Expired cookie=[redacted]; actor=[redacted]; second=[redacted]; service=[redacted]; retry after sign-in';
    expect(error).toMatchObject({
      status: 401,
      response: {
        code: 'STORY_PUBLICATION_SESSION_EXPIRED',
        message: expected,
        msg: expected,
        upstreamCode: 302,
        upstreamHttpStatus: 200,
        kind: 'session',
      },
    });
    for (const credential of [TOKEN, actorCookie, actorToken, secondToken]) {
      expect(JSON.stringify(error)).not.toContain(credential);
      expect((error as Error).message).not.toContain(credential);
    }
  });
  it('reports an expired actual upload session as a session error', async () => {
    fetchSpy.mockResolvedValueOnce(response(null, 302, 'Not logged in!'));
    await expect(
      new StoryPublicationJavaService().upload(candidate, 'satoken=expired'),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        code: 'STORY_PUBLICATION_SESSION_EXPIRED',
        upstreamCode: 302,
        msg: 'Not logged in!',
      },
    });
  });
  it('retains an upstream business error even inside HTTP 200', async () => {
    fetchSpy.mockResolvedValueOnce(
      response(null, 400, 'cannot edit while reviewing'),
    );
    await expect(
      new StoryPublicationJavaService().upload(candidate, 'satoken=actor'),
    ).rejects.toMatchObject({
      status: 502,
      response: {
        upstreamCode: 400,
        message: 'cannot edit while reviewing',
        upstreamHttpStatus: 200,
      },
    });
  });
  it.each([
    { ...detail, gameId: 'other-project' },
    { ...detail, status: 'approved' },
    null,
  ])('rejects invalid or cross-project successful detail', async (value) => {
    fetchSpy.mockResolvedValueOnce(response(value));
    await expect(
      new StoryPublicationJavaService().read(GAME),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'STORY_PUBLICATION_INVALID_RESPONSE' },
    });
  });
  it('rejects a cross-version upload response', async () => {
    fetchSpy.mockResolvedValueOnce(
      response({
        gameId: GAME,
        contentVersion: 'other-version',
        status: 'draft',
        manifestUrl: 'https://media.test.invalid/manifest.json',
      }),
    );
    await expect(
      new StoryPublicationJavaService().upload(candidate, 'satoken=actor'),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('does not echo credential-bearing transport errors', async () => {
    fetchSpy.mockRejectedValueOnce(
      new Error(`network failure ${TOKEN} satoken=actual-actor`),
    );
    const error = await new StoryPublicationJavaService()
      .read(GAME)
      .catch((value: unknown) => value);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain('satoken=actual-actor');
    expect(error).toMatchObject({ status: 503 });
  });
  it.each(['not a URL', 'file:///private/path'])(
    'classifies a malformed upstream manifest URL as a service response error: %s',
    async (manifestUrl) => {
      fetchSpy.mockResolvedValueOnce(
        response({
          gameId: GAME,
          contentVersion: candidate.contentVersion,
          status: 'draft',
          manifestUrl,
        }),
      );
      await expect(
        new StoryPublicationJavaService().upload(candidate, 'satoken=actor'),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'STORY_PUBLICATION_INVALID_RESPONSE' },
      });
    },
  );
  it.each(['read', 'upload', 'submit', 'offline'] as const)(
    'never starts a %s request after the publication operation was cancelled',
    async (action) => {
      const controller = new AbortController();
      controller.abort(new Error(`caller reason ${TOKEN}`));
      const service = new StoryPublicationJavaService();
      const operation =
        action === 'read'
          ? service.read(GAME, controller.signal)
          : action === 'upload'
            ? service.upload(candidate, 'satoken=actor', controller.signal)
            : service.transition(GAME, action, controller.signal);
      const error = await operation.catch((value: unknown) => value);
      expect(error).toMatchObject({
        status: 503,
        response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
      });
      expect(JSON.stringify(error)).not.toContain(TOKEN);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('propagates a shared operation abort to an in-flight Java mutation', async () => {
    const controller = new AbortController();
    let signal!: AbortSignal;
    fetchSpy.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('request aborted')),
        );
      });
    });
    const result = new StoryPublicationJavaService().transition(
      GAME,
      'submit',
      controller.signal,
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
    });
    expect(signal.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('discards a late successful response after the operation was cancelled', async () => {
    const controller = new AbortController();
    let finish!: (value: Response) => void;
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = new StoryPublicationJavaService().transition(
      GAME,
      'submit',
      controller.signal,
    );
    controller.abort();
    finish(response({ ...detail, status: 'reviewing' }));
    await expect(result).rejects.toMatchObject({
      status: 503,
      response: { code: 'STORY_PUBLICATION_OPERATION_STOPPED' },
    });
  });

  it('configures a five-second deadline and propagates a request abort', async () => {
    const controller = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    fetchSpy.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('timed out')),
          );
          expect(init.signal).toBe(controller.signal);
          controller.abort();
        }),
    );
    try {
      await expect(
        new StoryPublicationJavaService().read(GAME),
      ).rejects.toMatchObject({ status: 503 });
      expect(timeout).toHaveBeenCalledWith(5_000);
    } finally {
      timeout.mockRestore();
    }
  });
});

function response(data: unknown, code = 200, msg = 'Success') {
  return new Response(JSON.stringify({ code, msg, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
