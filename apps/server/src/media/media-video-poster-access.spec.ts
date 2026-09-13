/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import { MediaAccessService } from './media-access.service';
import { VIDEO_POSTER_VARIANT_KEY } from '../infra/storage/media-video-poster';

const id = '11111111-1111-7111-9111-111111111111';
const posterVariant = {
  variantKey: VIDEO_POSTER_VARIANT_KEY,
  status: 'ready',
  contentType: 'image/jpeg',
  placements: [
    {
      role: 'primary',
      status: 'active',
      priority: 0,
      deletedAt: null,
      storageProvider: 's3_compatible',
      bucket: 'media',
      region: 'auto',
      objectKey: 'poster.jpg',
      externalUrl: null,
    },
  ],
};
function setup(variants: unknown[] = []) {
  const asset = {
    id,
    kind: 'video',
    status: 'ready',
    moderationStatus: 'approved',
    visibility: 'private',
    createdByUserId: 'owner',
    workspaceId: null,
    metadata: {},
    variants,
    placements: [],
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ allowed: false }]),
    mediaAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
    mediaProcessingJob: {
      upsert: jest.fn().mockResolvedValue({ status: 'pending' }),
    },
  };
  const storage = {
    createReadUrl: jest.fn().mockResolvedValue({
      url: 'https://media.test/poster.jpg?sig=1',
      expiresAt: '2026-09-08T00:05:00Z',
    }),
  };
  const service = new MediaAccessService(
    prisma as never,
    storage as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { asset, prisma, storage, service };
}
describe('durable video posters', () => {
  it('serves the poster placement using existing media authorization', async () => {
    const { service, storage, prisma } = setup([posterVariant]);
    await expect(
      service.issueVideoPosterUrl('owner', id, { variantKey: 'original' }),
    ).resolves.toMatchObject({
      status: 'ready',
      url: expect.stringContaining('poster.jpg'),
    });
    expect(storage.createReadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: 'poster.jpg',
        contentType: 'image/jpeg',
      }),
      expect.any(Object),
    );
    expect(prisma.mediaProcessingJob.upsert).not.toHaveBeenCalled();
  });
  it('queues missing posters without resetting progress or attempts on polling', async () => {
    const { service, prisma } = setup();
    await expect(
      service.issueVideoPosterUrl('owner', id, { variantKey: 'original' }),
    ).resolves.toEqual({ status: 'pending' });
    expect(prisma.mediaProcessingJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: expect.objectContaining({ assetId: id, jobType: 'poster' }),
      }),
    );
  });
  it('handles a worker completing between the asset read and the job read', async () => {
    const { service, prisma, asset } = setup();
    prisma.mediaAsset.findFirst
      .mockResolvedValueOnce(asset)
      .mockResolvedValueOnce({ ...asset, variants: [posterVariant] });
    prisma.mediaProcessingJob.upsert.mockResolvedValue({ status: 'completed' });
    await expect(
      service.issueVideoPosterUrl('owner', id, { variantKey: 'original' }),
    ).resolves.toMatchObject({ status: 'ready' });
  });
  it('does not return the video URL when a poster placement is missing', async () => {
    const { service, storage, prisma } = setup([
      { ...posterVariant, placements: [] },
    ]);
    prisma.mediaProcessingJob.upsert.mockResolvedValue({ status: 'completed' });
    await expect(
      service.issueVideoPosterUrl('owner', id, { variantKey: 'original' }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
  it('does not enqueue or sign media the viewer cannot access', async () => {
    const { service, prisma, storage } = setup();
    await expect(
      service.issueVideoPosterUrl(undefined, id, { variantKey: 'original' }),
    ).rejects.toThrow();
    expect(prisma.mediaProcessingJob.upsert).not.toHaveBeenCalled();
    expect(storage.createReadUrl).not.toHaveBeenCalled();
  });
});
