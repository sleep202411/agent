/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import { execFile } from 'node:child_process';
import { VideoPosterService } from './video-poster.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));

const assetId = '11111111-1111-7111-9111-111111111111';
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    mediaAsset: { count: jest.fn().mockResolvedValue(1) },
    mediaAssetVariant: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'poster' }),
    },
    mediaObjectPlacement: {
      upsert: jest.fn().mockResolvedValue({ id: 'placement' }),
    },
  };
  const prisma = {
    mediaAsset: {
      findFirstOrThrow: jest
        .fn()
        .mockResolvedValue({ id: assetId, storageProvider: 'azure_blob' }),
    },
    mediaAssetVariant: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const reads = {
    createReadUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://media.test/original.mp4?sig=secret' }),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue({
      provider: 'aliyun_oss',
      bucket: 'cn-media',
      region: 'cn-hangzhou',
      storagePath: 'posters/result.jpg',
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  respond();
  return {
    tx,
    prisma,
    reads,
    storage,
    service: new VideoPosterService(
      prisma as never,
      reads as never,
      storage as never,
    ),
  };
}
function respond(error: Error | null = null) {
  jest
    .mocked(execFile)
    .mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, output: Buffer) => void,
    ) => callback(error, bytes)) as never);
}
afterEach(() => jest.clearAllMocks());

describe('VideoPosterService', () => {
  it('stores a durable JPEG using the destination provider, even for an original in another provider', async () => {
    const { service, tx, storage } = setup();
    await expect(service.generate(assetId)).resolves.toEqual({
      variantId: 'poster',
    });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: bytes,
        contentType: 'image/jpeg',
        key: expect.stringMatching(/^posters\/.+\/[a-f0-9-]{36}\.jpg$/),
      }),
    );
    expect(tx.mediaAssetVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: 'poster',
          status: 'ready',
          contentType: 'image/jpeg',
        }),
      }),
    );
    expect(tx.mediaObjectPlacement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          storageProvider: 'aliyun_oss',
          bucket: 'cn-media',
          region: 'cn-hangzhou',
          objectKey: 'posters/result.jpg',
        }),
      }),
    );
  });
  it('reuses only a ready poster with an active placement on worker retry', async () => {
    const { service, prisma, reads, storage } = setup();
    prisma.mediaAssetVariant.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.generate(assetId)).resolves.toEqual({
      variantId: 'existing',
    });
    expect(prisma.mediaAssetVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placements: {
            some: { role: 'primary', status: 'active', deletedAt: null },
          },
        }),
      }),
    );
    expect(reads.createReadUrl).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it('does not publish empty variants or leak signed URLs when extraction fails', async () => {
    const { service, tx, storage } = setup();
    respond(new Error('https://media.test/original.mp4?sig=secret timed out'));
    await expect(service.generate(assetId)).rejects.toThrow(
      'Could not extract a video preview.',
    );
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.mediaAssetVariant.upsert).not.toHaveBeenCalled();
  });
  it('removes the uploaded poster instead of publishing after asset deletion', async () => {
    const { service, tx, storage } = setup();
    tx.mediaAsset.count.mockResolvedValue(0);
    await expect(service.generate(assetId)).rejects.toThrow(
      'Video is no longer available.',
    );
    expect(tx.mediaAssetVariant.upsert).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'cn-media',
      region: 'cn-hangzhou',
      storageKey: 'posters/result.jpg',
    });
  });
  it('isolates uploaded bytes between overlapping attempts', async () => {
    const { service, storage } = setup();
    await Promise.all([service.generate(assetId), service.generate(assetId)]);
    const keys = storage.upload.mock.calls.map(
      ([input]) => (input as { key: string }).key,
    );
    expect(new Set(keys).size).toBe(2);
  });
  it('keeps the poster another worker published while extraction was running', async () => {
    const { service, tx, storage } = setup();
    tx.mediaAssetVariant.findFirst.mockResolvedValue({ id: 'winner' });
    await expect(service.generate(assetId)).resolves.toEqual({
      variantId: 'winner',
    });
    expect(tx.mediaAssetVariant.upsert).not.toHaveBeenCalled();
    expect(tx.mediaObjectPlacement.upsert).not.toHaveBeenCalled();
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'cn-media',
      region: 'cn-hangzhou',
      storageKey: 'posters/result.jpg',
    });
  });
  it('does not fetch arbitrary external import URLs from the server', async () => {
    const { service, prisma, reads } = setup();
    prisma.mediaAsset.findFirstOrThrow.mockResolvedValue({
      id: assetId,
      storageProvider: 'external_url',
    });
    reads.createReadUrl.mockResolvedValue({ url: 'http://127.0.0.1/private' });
    await expect(service.generate(assetId)).rejects.toThrow(
      'Import the video into media storage',
    );
    expect(execFile).not.toHaveBeenCalled();
  });
});
