import { CdnPurgeProvider, type CdnPurgeInput } from './cdn-purge.provider';

const input = { actionId: 'test', placement: {} } as CdnPurgeInput;

describe('CDN purge response transport', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.MEDIA_CDN_PURGE_MODE = '';
    process.env.MEDIA_CDN_PURGE_HTTP_ENDPOINT = 'https://purge.invalid';
    jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });
  it('propagates a body connection failure after successful HTTP headers', async () => {
    const failure = new Error('connection lost during response');
    jest.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(failure);
          },
        }),
        { status: 200 },
      ),
    );
    await expect(new CdnPurgeProvider().purge(input)).rejects.toBe(failure);
  });
  it('propagates timeout cancellation while reading the response', async () => {
    jest.useFakeTimers();
    process.env.MEDIA_CDN_PURGE_HTTP_TIMEOUT_MS = '1000';
    jest.mocked(fetch).mockImplementation((_url, options) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              options?.signal?.addEventListener('abort', () =>
                controller.error(new Error('body aborted')),
              );
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const result = new CdnPurgeProvider().purge(input);
    const rejected = expect(result).rejects.toThrow('body aborted');
    await Promise.all([rejected, jest.advanceTimersByTimeAsync(1000)]);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('retains an empty successful acknowledgement', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(new CdnPurgeProvider().purge(input)).resolves.toEqual({
      providerTaskId: null,
      metadata: undefined,
    });
  });
  it('retains provider task evidence and rejects an HTTP failure', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response('{"taskId":"task-1"}', { status: 200 }),
      );
    await expect(new CdnPurgeProvider().purge(input)).resolves.toEqual({
      providerTaskId: 'task-1',
      metadata: { taskId: 'task-1' },
    });
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response('{"message":"unavailable"}', { status: 503 }),
      );
    await expect(new CdnPurgeProvider().purge(input)).rejects.toThrow(
      'HTTP 503: unavailable',
    );
  });
});
