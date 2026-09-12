import { PassThrough } from 'node:stream';
import { streamStoryPrivateMedia } from './story-private-media';
function responseFixture() {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Uint8Array) => chunks.push(Buffer.from(chunk)));
  const response = Object.assign(stream, {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  });
  return { response, body: () => Buffer.concat(chunks).toString() };
}
describe('private story media stream', () => {
  afterEach(() => jest.restoreAllMocks());
  it('streams partial content without revealing or redirecting to the origin', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('abc', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-2/10',
          'content-length': '3',
          'accept-ranges': 'bytes',
        },
      }),
    );
    const { response, body } = responseFixture();
    await streamStoryPrivateMedia(
      'https://storage.example/private.mp4?signature=secret',
      response as never,
      'bytes=0-2',
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { range: 'bytes=0-2' },
        redirect: 'error',
        cache: 'no-store',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(206);
    expect(response.setHeader).toHaveBeenCalledWith(
      'cache-control',
      'private, no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'content-range',
      'bytes 0-2/10',
    );
    expect(
      response.setHeader.mock.calls.some(([name]) => name === 'location'),
    ).toBe(false);
    expect(body()).toBe('abc');
  });
  it('does not pass through storage errors or their signed URL', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('secret origin details', { status: 403 }),
      );
    const { response, body } = responseFixture();
    await expect(
      streamStoryPrivateMedia(
        'https://storage.example/video',
        response as never,
      ),
    ).rejects.toThrow('The story media could not be loaded.');
    expect(body()).toBe('');
  });
});
