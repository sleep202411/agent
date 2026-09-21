import { MiniMaxClient } from './minimax-client';
import { MiniMaxConfigService } from './minimax-config.service';
import type { MiniMaxCatalogService } from './minimax-catalog.service';
import { MiniMaxProviderAdapter } from './minimax-provider.adapter';

jest.mock('./minimax-runtime', () => ({
  MINIMAX_PROVIDER: 'minimax',
  MINIMAX_H3_ENDPOINT: 'MiniMax-H3',
}));
jest.mock('./minimax-catalog.service', () => ({}));
jest.mock('./minimax-request.mapper', () => ({
  mapMiniMaxVideoProviderRequest: (input: unknown) => input,
}));

describe('MiniMax polling recovery', () => {
  afterEach(() => jest.restoreAllMocks());

  function adapter() {
    return new MiniMaxProviderAdapter(
      {
        config: {
          apiKey: 'test-only',
          apiBaseUrl: 'https://fixture.invalid',
          requestTimeoutMs: 1000,
        },
      } as MiniMaxConfigService,
      {} as MiniMaxCatalogService,
      new MiniMaxClient(),
    );
  }

  it.each(['{}', '<html>Unavailable</html>', '{"task":{"id":"existing"}}'])(
    'recovers from %p by checking the existing task again',
    async (body) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(body))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task: {
                status: 'succeeded',
                content: { url: 'https://fixture.invalid/video.mp4' },
              },
            }),
          ),
        );
      const provider = adapter();
      const error = await provider
        .pollStatus('existing')
        .catch((error: unknown) => error);
      expect(provider.mapError(error)).toMatchObject({
        code: 'UNKNOWN',
        retryable: true,
      });
      await expect(provider.pollStatus('existing')).resolves.toMatchObject({
        kind: 'completed',
        providerRequestId: 'existing',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [url, init] of fetchMock.mock.calls) {
        expect(url).toBe(
          'https://fixture.invalid/v2/query/video_generation/existing',
        );
        expect(init?.method).toBe('GET');
      }
    },
  );

  it.each([
    ['queued', 'pending'],
    ['running', 'pending'],
    ['failed', 'failed'],
    ['cancelled', 'failed'],
  ])('keeps %s as %s', async (status, kind) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ task: { status } })));
    await expect(adapter().pollStatus('existing')).resolves.toMatchObject({
      kind,
    });
  });
});
