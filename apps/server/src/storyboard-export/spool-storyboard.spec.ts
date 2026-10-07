import { access, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spoolStoryboard } from './spool-storyboard';
import type { StoryboardSourceObject } from './authorized-storyboard';
const source: StoryboardSourceObject = {
  assetId: 'asset',
  placementId: null,
  storageProvider: 's3_compatible',
  bucket: 'private',
  region: null,
  objectKey: 'video.mp4',
  contentType: 'video/mp4',
  sizeBytes: '3',
};
const storage = () => ({
  createReadUrl: jest.fn().mockResolvedValue({
    url: 'https://storage.invalid/signed',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }),
});
const signal = () => new AbortController().signal;
const files = async () =>
  (await readdir(tmpdir()))
    .filter((name) => name.startsWith('storyboard-input-'))
    .sort();
describe('private storyboard input spool', () => {
  it('uses signed reads, preserves repeated clips, and owns restrictive files and cleanup', async () => {
    const store = storage();
    const fetcher = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-length': '3' },
        }),
      ),
    );
    const result = await spoolStoryboard(
      [source, source],
      store,
      signal(),
      fetcher,
    );
    try {
      expect(result.filenames).toEqual(['input-0.mp4', 'input-1.mp4']);
      expect((await stat(result.directory)).mode & 0o777).toBe(0o700);
      for (const filename of result.filenames) {
        expect(
          (await stat(join(result.directory, filename))).mode & 0o777,
        ).toBe(0o600);
        expect(await readFile(join(result.directory, filename))).toEqual(
          Buffer.from([1, 2, 3]),
        );
      }
      expect(store.createReadUrl).toHaveBeenCalledWith(
        { ...source, externalUrl: null },
        { expiresInSeconds: 300, cacheControl: 'private, no-store' },
      );
      expect(fetcher).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          redirect: 'error',
          headers: { 'Accept-Encoding': 'identity' },
        }),
      );
    } finally {
      await result.dispose();
    }
    await expect(access(result.directory)).rejects.toThrow();
  });
  it.each([
    [
      'oversized header',
      () =>
        new Response('abc', {
          headers: { 'content-length': String(513 * 1024 * 1024) },
        }),
    ],
    [
      'changed size',
      () => new Response('abc', { headers: { 'content-length': '4' } }),
    ],
    ['short body', () => new Response('ab')],
    ['long body', () => new Response('abcd')],
    [
      'compressed body',
      () => new Response('abc', { headers: { 'content-encoding': 'gzip' } }),
    ],
    ['failed response', () => new Response('no', { status: 403 })],
  ])('cleans the spool after %s', async (_name, response) => {
    const before = await files();
    await expect(
      spoolStoryboard(
        [source],
        storage(),
        signal(),
        jest.fn().mockResolvedValue(response()),
      ),
    ).rejects.toThrow();
    expect(await files()).toEqual(before);
  });
  it('removes earlier clips when a later stream fails', async () => {
    const before = await files();
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response('abc'))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('interrupted'));
            },
          }),
        ),
      );
    await expect(
      spoolStoryboard([source, source], storage(), signal(), fetcher),
    ).rejects.toThrow('interrupted');
    expect(await files()).toEqual(before);
  });
  it('rejects unsigned storage URLs before fetching', async () => {
    const before = await files();
    const fetcher = jest.fn();
    for (const url of [
      'http://storage.invalid/private',
      'https://user:secret@storage.invalid/private',
    ]) {
      const store = storage();
      store.createReadUrl.mockResolvedValue({
        url,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
      await expect(
        spoolStoryboard([source], store, signal(), fetcher),
      ).rejects.toThrow('valid private read URL');
    }
    const store = storage();
    store.createReadUrl.mockResolvedValue({
      url: 'https://storage.invalid/private',
      expiresAt: null,
    });
    await expect(
      spoolStoryboard([source], store, signal(), fetcher),
    ).rejects.toThrow('valid private read URL');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await files()).toEqual(before);
  });
  it('removes partial files on cancellation', async () => {
    const before = await files();
    const controller = new AbortController();
    const fetcher = jest.fn().mockImplementation(() => {
      controller.abort(new Error('cancelled'));
      return Promise.resolve(new Response('abc'));
    });
    await expect(
      spoolStoryboard([source], storage(), controller.signal, fetcher),
    ).rejects.toThrow('cancelled');
    expect(await files()).toEqual(before);
  });
});

it.each([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
] as const)(
  'spools %s with the correct local image extension',
  async (contentType, extension) => {
    const result = await spoolStoryboard(
      [{ ...source, contentType }],
      storage(),
      signal(),
      jest.fn().mockResolvedValue(new Response('abc')),
    );
    try {
      expect(result.filenames).toEqual([`input-0.${extension}`]);
    } finally {
      await result.dispose();
    }
  },
);
