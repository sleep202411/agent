import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StoryboardExportJob } from '@prisma/client';
import { StoryboardExportOutputService } from './storyboard-export-output.service';

describe('private export upload', () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'export-upload-test-'));
    path = join(directory, 'output.mp4');
    await writeFile(path, Buffer.from([1, 2, 3]));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  function fixture() {
    const prisma = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const storage = {
      providerId: 's3_compatible',
      createPrivateUploadUrl: jest
        .fn()
        .mockImplementation((input: { storageKey: string }) =>
          Promise.resolve({
            url: 'https://private.invalid/upload',
            storageKey: input.storageKey,
            provider: 's3_compatible',
            bucket: 'private',
            region: null,
            headers: {},
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }),
        ),
      headStoredObject: jest.fn().mockResolvedValue({
        exists: true,
        sizeBytes: 3,
        contentType: 'video/mp4',
      }),
    };
    const registry = { forProvider: jest.fn().mockReturnValue(storage) };
    const service = new StoryboardExportOutputService(
      prisma as never,
      registry as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, storage, service };
  }
  const job = {
    id: '00000000-0000-4000-8000-000000000001',
  } as StoryboardExportJob;
  it('records recovery before transferring bytes and verifies stored size', async () => {
    const t = fixture();
    const fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const result = await t.service.upload(
      job,
      path,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ sizeBytes: 3 });
    expect(result.key).toMatch(
      /^storyboard-exports\/00000000-0000-4000-8000-000000000001\/.+\.mp4$/,
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        duplex: 'half',
        headers: { 'content-type': 'video/mp4', 'content-length': '3' },
      }),
    );
    expect(t.storage.headStoredObject).toHaveBeenCalledWith({
      bucket: 'private',
      region: null,
      storageKey: result.key,
    });
  });
  it('never uploads if the recovery record cannot be persisted', async () => {
    const t = fixture();
    t.prisma.$executeRaw.mockRejectedValue(new Error('database unavailable'));
    const fetcher = jest.spyOn(globalThis, 'fetch');
    await expect(
      t.service.upload(job, path, new AbortController().signal),
    ).rejects.toThrow('database unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['put', 'head'])(
    'leaves durable recovery when %s fails',
    async (mode) => {
      const t = fixture();
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(null, { status: mode === 'put' ? 500 : 200 }),
        );
      if (mode === 'head')
        t.storage.headStoredObject.mockResolvedValue({
          exists: true,
          sizeBytes: 2,
          contentType: 'video/mp4',
        });
      await expect(
        t.service.upload(job, path, new AbortController().signal),
      ).rejects.toThrow();
      expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    },
  );
});
