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
