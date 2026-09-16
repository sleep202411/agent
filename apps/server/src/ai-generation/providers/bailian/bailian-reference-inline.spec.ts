import { inlineBailianImageReferences } from './bailian-reference-inline';

const PNG = Buffer.from('fake-png-bytes');

function fetchMock(impl: (url: string) => Response | Promise<Response>) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(impl as never);
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.BAILIAN_INLINE_REFERENCE_IMAGES;
  delete process.env.BAILIAN_INLINE_MAX_BYTES;
});

describe('inlineBailianImageReferences', () => {
  it('inlines https image references as data URIs', async () => {
    fetchMock(() =>
      Promise.resolve(
        new Response(PNG, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );

    const result = await inlineBailianImageReferences({
      prompt: 'a card',
      referenceImages: [
        { url: 'https://media.fizzspace.cn/a.png', bytes: 4, label: '角色' },
      ],
    });

    const item = (result.referenceImages as Array<{ url: string }>)[0];
    expect(item.url).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });

  it('inlines startFrame and endFrame image urls', async () => {
    fetchMock(() =>
      Promise.resolve(
        new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      ),
    );

    const result = await inlineBailianImageReferences({
      startFrame: 'https://media.fizzspace.cn/first.png',
      endFrame: 'https://media.fizzspace.cn/last.png',
    });

    expect(result.startFrame).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`,
    );
    expect(result.endFrame).toBe(
      `data:image/png;base64,${PNG.toString('base64')}`,
    );
  });

  it('falls back to the original URL when the download fails', async () => {
    fetchMock(() => Promise.resolve(new Response('nope', { status: 502 })));

    const result = await inlineBailianImageReferences({
      referenceImages: [{ url: 'https://media.fizzspace.cn/a.png' }],
    });

    expect((result.referenceImages as Array<{ url: string }>)[0].url).toBe(
      'https://media.fizzspace.cn/a.png',
    );
  });

  it('skips references whose declared bytes exceed the cap', async () => {
    process.env.BAILIAN_INLINE_MAX_BYTES = '100';
    const spy = fetchMock(() => Promise.resolve(new Response(PNG)));

    const result = await inlineBailianImageReferences({
      referenceImages: [
        { url: 'https://media.fizzspace.cn/big.png', bytes: 999 },
      ],
    });

    expect((result.referenceImages as Array<{ url: string }>)[0].url).toBe(
      'https://media.fizzspace.cn/big.png',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves non-image and non-https values untouched', async () => {
    const spy = fetchMock(() => Promise.resolve(new Response(PNG)));

    const input = {
      referenceImages: [{ url: 'http://insecure.example/a.png' }, 'junk'],
      prompt: 'x',
    };
    const result = await inlineBailianImageReferences(input);

    expect(result).toEqual(input);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled by env', async () => {
    process.env.BAILIAN_INLINE_REFERENCE_IMAGES = 'false';
    const spy = fetchMock(() => Promise.resolve(new Response(PNG)));

    const input = { referenceImages: [{ url: 'https://x.example/a.png' }] };
    const result = await inlineBailianImageReferences(input);

    expect(result).toBe(input);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('bounded reference download lifetime', () => {
  it('stops a chunked response as soon as the byte cap is exceeded', async () => {
    process.env.BAILIAN_INLINE_MAX_BYTES = '5';
    let pulls = 0;
    const cancel = jest.fn();
    fetchMock(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(4));
              if (pulls === 20) controller.close();
            },
            cancel,
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    );
    const url = 'https://media.fizzspace.cn/large.png';
    expect(
      (await inlineBailianImageReferences({ startFrame: url })).startFrame,
    ).toBe(url);
    expect(cancel).toHaveBeenCalled();
    expect(pulls).toBeLessThan(20);
  });
  it.each([503, 200])(
    'cancels an unread rejected response (%s)',
    async (status) => {
      const cancel = jest.fn();
      fetchMock(
        () =>
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: { 'content-length': '999999999' },
          }),
      );
      await inlineBailianImageReferences({
        startFrame: 'https://media.fizzspace.cn/a.png',
      });
      expect(cancel).toHaveBeenCalled();
    },
  );
  it('keeps an exact-cap multi-chunk image valid', async () => {
    process.env.BAILIAN_INLINE_MAX_BYTES = '4';
    fetchMock(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.enqueue(new Uint8Array([3, 4]));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    );
    expect(
      (
        await inlineBailianImageReferences({
          startFrame: 'https://media.fizzspace.cn/a.png',
        })
      ).startFrame,
    ).toBe('data:image/png;base64,AQIDBA==');
  });
});

describe('server-side reference origin admission', () => {
  it.each([
    'https://127.0.0.1/private',
    'https://untrusted.example/a.png',
    'https://user:secret@media.fizzspace.cn/a.png',
    'https://media.fizzspace.cn:8443/a.png',
  ])('preserves %s without fetching it on the server', async (url) => {
    const spy = fetchMock(() => new Response(PNG));
    expect(
      (await inlineBailianImageReferences({ startFrame: url })).startFrame,
    ).toBe(url);
    expect(spy).not.toHaveBeenCalled();
  });
  it('disables automatic redirects while downloading trusted media', async () => {
    const spy = fetchMock(() => new Response(PNG));
    await inlineBailianImageReferences({
      startFrame: 'https://media.fizzspace.cn/a.png',
    });
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it('accepts the configured media origin without broadening to sibling hosts', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS: 'https://configured.example/media',
    });
    const spy = fetchMock(
      () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    );
    const result = await inlineBailianImageReferences({
      startFrame: 'https://configured.example/media/a.png',
      endFrame: 'https://sibling.configured.example/a.png',
    });
    expect(result.startFrame).toMatch(/^data:image\/png;base64,/);
    expect(result.endFrame).toBe('https://sibling.configured.example/a.png');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('reference response admission', () => {
  it.each(['text/html', 'application/json', 'video/mp4'])(
    'does not relabel an explicit %s response as a PNG',
    async (contentType) => {
      fetchMock(
        () =>
          new Response('not-an-image', {
            headers: { 'content-type': contentType },
          }),
      );
      const url = 'https://media.fizzspace.cn/a.png';
      expect(
        (await inlineBailianImageReferences({ startFrame: url })).startFrame,
      ).toBe(url);
    },
  );
  it('keeps octet-stream references compatible with the existing PNG fallback', async () => {
    fetchMock(
      () =>
        new Response(PNG, {
          headers: { 'content-type': 'application/octet-stream' },
        }),
    );
    expect(
      (
        await inlineBailianImageReferences({
          startFrame: 'https://media.fizzspace.cn/a.png',
        })
      ).startFrame,
    ).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
  });
});

it('cancels a stalled reference body at the deadline without submitting partial bytes', async () => {
  jest.useFakeTimers();
  try {
    const cancel = jest.fn();
    fetchMock(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
            },
            cancel,
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
    );
    const url = 'https://media.fizzspace.cn/stalled.png';
    const result = inlineBailianImageReferences({ startFrame: url });
    await jest.advanceTimersByTimeAsync(10_001);
    expect((await result).startFrame).toBe(url);
    expect(cancel).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
