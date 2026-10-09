import type { AppearanceDesignRequest } from '@repo/game-agent-protocol';
import { HttpException } from '@nestjs/common';
import { GameAgentWorkerClient } from './game-agent-worker.client';

const request: AppearanceDesignRequest = {
  requestId: '135b85a7-1c82-4b1f-8f7c-fbc174f19ea2',
  locale: 'en-US',
  prompt: 'Style the start button',
  appearance: {
    version: 1,
  },
  context: { title: 'A story', choiceLabels: [] },
  history: [],
};
const result = {
  requestId: request.requestId,
  appearance: {
    version: 1,
    presentation: { copy: { start: { 'en-US': 'Enter' } } },
  },
  message: 'Done',
};
const client = () =>
  new GameAgentWorkerClient({
    value: {
      workerBaseUrl: 'http://game-agent:4396',
      internalToken: 'independent-test-token',
      studioOrigin: 'https://fizzdragon.com',
    },
  } as never);
afterEach(() => jest.restoreAllMocks());

it('calls the independent service with its own credentials', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json(result));
  await expect(
    client().designAppearance(request, new AbortController().signal),
  ).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledWith(
    'http://game-agent:4396/v1/game-agent/appearance/design',
    expect.objectContaining({
      headers: {
        'content-type': 'application/json',
        'x-game-agent-internal-token': 'independent-test-token',
      },
    }),
  );
});

describe('authenticated hosted appearance control', () => {
  const scope = {
    userId: 'actor',
    projectId: '019f60f4-b101-70d4-8000-000000000002',
  };
  const id = '019f60f4-b101-70d4-8000-000000000003';
  const leaseId = '019f60f4-b101-70d4-8000-000000000004';
  const open = {
    action: 'open' as const,
    key: '019f60f4-b101-70d4-8000-000000000005',
    leaseId,
    request,
    draft: '',
  };

  it('supplies trusted scope and presentation and never discloses the private listener', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        id,
        leaseId,
        requestId: request.requestId,
        url: 'http://localhost:12345/?token=secret',
      }),
    );
    const response = await client().controlAppearanceWeb(
      open,
      scope,
      new AbortController().signal,
    );
    expect(response).toEqual({
      id,
      leaseId,
      requestId: request.requestId,
      url: `/aurora/game-agent/projects/${scope.projectId}/appearance/web/${id}/`,
    });
    const sent = JSON.parse(fetch.mock.calls[0][1]?.body as string) as unknown;
    expect(sent).toEqual({
      ...open,
      scope,
      parentOrigin: 'https://fizzdragon.com',
      copy: {
        working: 'Updating the appearance…',
        workingFor: 'Updating the appearance · {duration}',
      },
    });
  });

  it('rejects an open response from a different admission lease', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        id,
        leaseId: id,
        requestId: request.requestId,
        url: 'http://localhost:12345/',
      }),
    );
    await expect(
      client().controlAppearanceWeb(open, scope, new AbortController().signal),
    ).rejects.toThrow('does not match');
  });

  it('accepts the retained request identity of an authorized resumed workspace', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ id, leaseId, requestId: id, url: '/' }),
      );
    await expect(
      client().controlAppearanceWeb(open, scope, new AbortController().signal),
    ).resolves.toEqual({
      id,
      leaseId,
      requestId: id,
      url: `/aurora/game-agent/projects/${scope.projectId}/appearance/web/${id}/`,
    });
  });

  it('binds poll and close to the same authenticated scope', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ result: null }))
      .mockResolvedValueOnce(Response.json({ closed: false }));
    await expect(
      client().controlAppearanceWeb(
        { action: 'poll', id },
        scope,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ result: null });
    await expect(
      client().controlAppearanceWeb(
        { action: 'close', id, leaseId },
        scope,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ closed: false });
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
      action: 'poll',
      id,
      scope,
    });
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({
      action: 'close',
      id,
      leaseId,
      scope,
    });
  });

  it('rejects a malformed poll instead of exposing arbitrary worker data', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ result: null, url: 'http://localhost/private' }),
      );
    await expect(
      client().controlAppearanceWeb(
        { action: 'poll', id },
        scope,
        new AbortController().signal,
      ),
    ).rejects.toThrow('invalid session response');
  });

  it.each([404, 410])(
    'preserves expired session status %s for controlled reconnect',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Appearance session expired.' } },
            { status },
          ),
        );
      const failure = await client()
        .controlAppearanceWeb(
          { action: 'poll', id },
          scope,
          new AbortController().signal,
        )
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(HttpException);
      expect((failure as HttpException).getStatus()).toBe(status);
    },
  );
});

it('does not admit already-cancelled inference', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  const controller = new AbortController();
  controller.abort();
  await expect(
    client().designAppearance(request, controller.signal),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects a result from another authoring request', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      ...result,
      requestId: '435b85a7-1c82-4b1f-8f7c-fbc174f19ea2',
    }),
  );
  await expect(
    client().designAppearance(request, new AbortController().signal),
  ).rejects.toThrow('does not match');
});

it('preserves actionable worker errors', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { message: 'Provider quota exceeded' } },
        { status: 429 },
      ),
    );
  await expect(
    client().designAppearance(request, new AbortController().signal),
  ).rejects.toThrow('Provider quota exceeded');
});

it('rejects malformed worker responses as a gateway error', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('not JSON', { status: 200 }));
  await expect(
    client().designAppearance(request, new AbortController().signal),
  ).rejects.toThrow('invalid JSON');
});
