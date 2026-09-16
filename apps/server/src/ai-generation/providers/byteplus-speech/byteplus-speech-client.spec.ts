import {
  BytePlusSpeechClient,
  readTtsAudioStream,
} from './byteplus-speech-client';

describe('readTtsAudioStream', () => {
  it('assembles newline-delimited base64 frames until the completion code', async () => {
    const response = new Response(
      [
        JSON.stringify({
          code: 0,
          data: Buffer.from('hello ').toString('base64'),
        }),
        JSON.stringify({
          code: 0,
          data: Buffer.from('world').toString('base64'),
        }),
        JSON.stringify({ code: 20_000_000, data: null }),
      ].join('\n'),
    );

    await expect(readTtsAudioStream(response)).resolves.toEqual(
      Buffer.from('hello world'),
    );
  });

  it('rejects a truncated stream without the documented completion frame', async () => {
    const response = new Response(
      JSON.stringify({
        code: 0,
        data: Buffer.from('partial').toString('base64'),
      }),
    );

    await expect(readTtsAudioStream(response)).rejects.toThrow(
      'without its completion frame',
    );
  });
});

describe('speech response lifetime', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });
  it.each(['createAudio', 'synthesizeTts'] as const)(
    'keeps the %s deadline active through body reads',
    async (method) => {
      jest.useFakeTimers();
      const client = new BytePlusSpeechClient({
        config: {
          enabled: true,
          apiKey: 'fixture',
          apiBaseUrl: 'https://speech.example.test',
          requestTimeoutMs: 100,
        },
      } as never);
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
          ),
        ),
      );
      globalThis.fetch = fetcher as typeof fetch;
      const result = expect(client[method]({} as never)).rejects.toMatchObject({
        payload: { code: 'PROVIDER_TIMEOUT' },
      });
      await jest.advanceTimersByTimeAsync(100);
      await result;
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('cancels and releases a malformed TTS stream', async () => {
    const cancel = jest.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('malformed\n'));
        },
        cancel,
      }),
    );
    await expect(readTtsAudioStream(response)).rejects.toThrow(
      'malformed JSON',
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  });
});
