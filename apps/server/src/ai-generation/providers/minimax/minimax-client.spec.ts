import { MiniMaxClient, taskFromQueryBody } from './minimax-client';
import type { MiniMaxProviderConfig } from './minimax-config.service';
import { mapMiniMaxUnknownError } from './minimax-error.mapper';

const config: MiniMaxProviderConfig = {
  enabled: true,
  apiKey: 'test-only',
  apiBaseUrl: 'https://fixture.invalid',
  requestTimeoutMs: 1000,
  initialPollDelayMs: 1000,
};

describe('MiniMax response validation', () => {
  const client = new MiniMaxClient();
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['', '<html>Unavailable</html>', 'null', '[]', '"running"', '42'])(
    'rejects malformed successful body %p as a retryable observation error',
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body));
      await expect(
        client.getVideoTask(config, 'existing-task'),
      ).rejects.toMatchObject({
        payload: { code: 'UNKNOWN', retryable: true },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://fixture.invalid/v2/query/video_generation/existing-task',
        expect.objectContaining({ method: 'GET' }),
      );
    },
  );

  it('preserves a response body stream failure', async () => {
    const response = new Response();
    jest
      .spyOn(response, 'text')
      .mockRejectedValue(new Error('stream interrupted'));
    fetchMock.mockResolvedValue(response);
    await expect(
      client.getVideoTask(config, 'existing-task'),
    ).rejects.toMatchObject({
      payload: {
        code: 'UNKNOWN',
        message: 'stream interrupted',
        retryable: true,
      },
    });
  });

  it('classifies a timeout during body reading', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const response = new Response();
      jest.spyOn(response, 'text').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('body aborted')),
            );
          }),
      );
      return Promise.resolve(response);
    });
    const result = expect(
      client.getVideoTask(config, 'existing-task'),
    ).rejects.toMatchObject({
      payload: { code: 'PROVIDER_TIMEOUT', retryable: true },
    });
    await jest.advanceTimersByTimeAsync(1000);
    await result;
  });

  it.each([
    [401, 'PROVIDER_NOT_CONFIGURED'],
    [402, 'PROVIDER_NOT_CONFIGURED'],
    [429, 'PROVIDER_429'],
    [503, 'PROVIDER_5XX'],
  ])(
    'preserves HTTP %s classification before parsing HTML',
    async (status, code) => {
      fetchMock.mockResolvedValue(
        new Response('<html>Error</html>', { status: Number(status) }),
      );
      await expect(
        client.getVideoTask(config, 'existing-task'),
      ).rejects.toMatchObject({ payload: { code } });
    },
  );

  it('accepts create-task responses', async () => {
    fetchMock.mockResolvedValue(new Response('{"task_id":"new-task"}'));
    await expect(client.createVideoTask(config, {})).resolves.toMatchObject({
      body: { task_id: 'new-task' },
    });
  });

  it.each([
    {},
    null,
    [],
    { task: {} },
    { task: null },
    { task: [] },
    { status: 1 },
    { status: '' },
    { status: '  ' },
  ])('rejects missing or invalid query status: %p', (body) => {
    try {
      taskFromQueryBody(body);
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(mapMiniMaxUnknownError(error)).toMatchObject({
        code: 'UNKNOWN',
        retryable: true,
        message: 'MiniMax query returned no valid task status',
      });
    }
  });

  it.each([
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'canceled',
  ])('preserves valid nested and flat %s responses', (status) => {
    const task = {
      id: 'existing-task',
      status,
      content: { url: 'https://fixture.invalid/video.mp4' },
    };
    expect(taskFromQueryBody({ task })).toEqual(task);
    expect(taskFromQueryBody(task)).toEqual(task);
  });
});
