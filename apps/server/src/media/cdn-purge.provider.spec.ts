import { RPCClient } from '@alicloud/pop-core';
import { CdnPurgeProvider, type CdnPurgeInput } from './cdn-purge.provider';

const rpc = { request: jest.fn() };
jest.mock('@alicloud/pop-core', () => ({
  RPCClient: jest.fn().mockImplementation(() => rpc),
}));

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

describe('Aliyun CDN file refresh', () => {
  const originalEnv = { ...process.env };
  const urls = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `https://media.fizzspace.cn/hls/a/${index}.ts`,
    );
  beforeEach(() => {
    jest.mocked(RPCClient).mockClear();
    rpc.request.mockReset();
    process.env.MEDIA_CDN_PURGE_MODE = 'aliyun';
    process.env.OSS_ACCESS_KEY_ID = 'oss-ak';
    process.env.OSS_ACCESS_KEY_SECRET = 'oss-sk';
    delete process.env.ALIYUN_CDN_ACCESS_KEY_ID;
    delete process.env.ALIYUN_CDN_ACCESS_KEY_SECRET;
    delete process.env.ALIYUN_CDN_ENDPOINT;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refreshes files by URL with the OSS key pair of the same account', async () => {
    rpc.request.mockResolvedValue({ RefreshTaskId: '7041', RequestId: 'r' });
    await expect(new CdnPurgeProvider().refreshFiles(urls(2))).resolves.toBe(
      '7041',
    );
    expect(RPCClient).toHaveBeenCalledWith({
      accessKeyId: 'oss-ak',
      accessKeySecret: 'oss-sk',
      endpoint: 'https://cdn.aliyuncs.com',
      apiVersion: '2018-05-10',
    });
    expect(rpc.request).toHaveBeenCalledWith(
      'RefreshObjectCaches',
      {
        ObjectPath: `${urls(2)[0]}\n${urls(2)[1]}`,
        ObjectType: 'File',
      },
      { method: 'POST', timeout: 15_000 },
    );
  });

  it('prefers a dedicated CDN key pair and endpoint when configured', async () => {
    process.env.ALIYUN_CDN_ACCESS_KEY_ID = 'cdn-ak';
    process.env.ALIYUN_CDN_ACCESS_KEY_SECRET = 'cdn-sk';
    process.env.ALIYUN_CDN_ENDPOINT = 'https://cdn.example.test';
    rpc.request.mockResolvedValue({ RefreshTaskId: '1' });
    await new CdnPurgeProvider().refreshFiles(urls(1));
    expect(RPCClient).toHaveBeenCalledWith(
      expect.objectContaining({
        accessKeyId: 'cdn-ak',
        accessKeySecret: 'cdn-sk',
        endpoint: 'https://cdn.example.test',
      }),
    );
  });

  it('takes 1-100 URLs per request', async () => {
    const provider = new CdnPurgeProvider();
    await expect(provider.refreshFiles([])).rejects.toThrow('got 0');
    await expect(provider.refreshFiles(urls(101))).rejects.toThrow('got 101');
    expect(rpc.request).not.toHaveBeenCalled();
    rpc.request.mockResolvedValue({ RefreshTaskId: '100' });
    await expect(provider.refreshFiles(urls(100))).resolves.toBe('100');
  });

  it("rethrows Aliyun's code and message verbatim", async () => {
    rpc.request.mockRejectedValue(
      Object.assign(new Error('Forbidden, URL: https://cdn.aliyuncs.com/'), {
        code: 'Forbidden.RAM',
        data: {
          Code: 'Forbidden.RAM',
          Message: 'User not authorized to operate on the specified resource.',
        },
      }),
    );
    await expect(new CdnPurgeProvider().refreshFiles(urls(1))).rejects.toThrow(
      'Aliyun CDN RefreshObjectCaches failed: Forbidden.RAM: User not authorized to operate on the specified resource.',
    );
  });

  it('refuses outside aliyun mode', async () => {
    process.env.MEDIA_CDN_PURGE_MODE = 'log';
    await expect(new CdnPurgeProvider().refreshFiles(urls(1))).rejects.toThrow(
      'requires MEDIA_CDN_PURGE_MODE=aliyun',
    );
  });

  it('purges one placement URL through the same refresh', async () => {
    rpc.request.mockResolvedValue({ RefreshTaskId: '9' });
    await expect(
      new CdnPurgeProvider().purge({ ...input, url: urls(1)[0] }),
    ).resolves.toEqual({ providerTaskId: '9', metadata: { mode: 'aliyun' } });
    await expect(
      new CdnPurgeProvider().purge({ ...input, url: null }),
    ).rejects.toThrow('could not be resolved');
  });

  it('asserts the refresh configuration, naming every missing setting', () => {
    expect(() =>
      new CdnPurgeProvider().assertAliyunRefreshConfigured(
        'story playback HLS',
      ),
    ).not.toThrow();
    process.env.MEDIA_CDN_PURGE_MODE = 'http';
    delete process.env.OSS_ACCESS_KEY_SECRET;
    expect(() =>
      new CdnPurgeProvider().assertAliyunRefreshConfigured(
        'story playback HLS',
      ),
    ).toThrow(
      'story playback HLS requires: MEDIA_CDN_PURGE_MODE=aliyun, ALIYUN_CDN_ACCESS_KEY_SECRET|OSS_ACCESS_KEY_SECRET',
    );
  });

  it('rejects an unknown purge mode instead of guessing one', async () => {
    process.env.MEDIA_CDN_PURGE_MODE = 'aliyn';
    await expect(new CdnPurgeProvider().purge(input)).rejects.toThrow(
      'MEDIA_CDN_PURGE_MODE must be log, http or aliyun (got "aliyn").',
    );
  });
});
