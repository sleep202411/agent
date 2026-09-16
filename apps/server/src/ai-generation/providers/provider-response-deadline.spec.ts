import { BytePlusClient } from './byteplus/byteplus-client';
import { MiniMaxClient } from './minimax/minimax-client';
import { FalClient } from './fal/fal-client';
import { AgnesClient } from './agnes/agnes-client';
import { BailianClient } from './bailian/bailian-client';

type Transport = {
  requestJson(config: object, url: string, init: RequestInit): Promise<unknown>;
};
describe.each([
  BytePlusClient,
  MiniMaxClient,
  FalClient,
  AgnesClient,
  BailianClient,
])('%s response deadline', (Client) => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });
  it.each([200, 503])(
    'times out a stalled HTTP %s body without retrying',
    async (status) => {
      jest.useFakeTimers();
      const fetcher = jest.fn((_url: unknown, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init!.signal!.addEventListener(
                  'abort',
                  () =>
                    controller.error(new DOMException('timeout', 'AbortError')),
                  { once: true },
                );
              },
            }),
            { status },
          ),
        ),
      );
      globalThis.fetch = fetcher as typeof fetch;
      const client = new Client() as unknown as Transport;
      const result = expect(
        client.requestJson(
          { apiKey: 'fixture', requestTimeoutMs: 100 },
          'https://provider.example.test',
          { method: 'POST' },
        ),
      ).rejects.toMatchObject({ payload: { code: 'PROVIDER_TIMEOUT' } });
      await jest.advanceTimersByTimeAsync(100);
      await result;
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
