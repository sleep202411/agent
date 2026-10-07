import { ForbiddenException, GoneException } from '@nestjs/common';
import { captureAuthorizedStoryboard } from './authorized-storyboard';
import { captureSavedStoryboard } from './saved-storyboard';
jest.mock('./saved-storyboard', () => ({ captureSavedStoryboard: jest.fn() }));
const assetId = '11111111-1111-4111-8111-111111111111';
const capture = jest.mocked(captureSavedStoryboard);
function fixture() {
  const asset = {
    id: assetId,
    kind: 'video',
    status: 'ready',
    deletedAt: null,
    storageProvider: 's3_compatible',
    bucket: 'private',
    objectKey: 'video.mp4',
    region: 'global',
    contentType: 'video/mp4',
    sizeBytes: 100n,
    variants: [],
    placements: [],
  };
  const tx = {
    $executeRaw: jest.fn(),
    mediaAsset: { findMany: jest.fn().mockResolvedValue([asset]) },
  };
  const documents = {
    requireDocumentRef: jest.fn().mockResolvedValue({ id: 'doc' }),
  };
  const media = { denialForUse: jest.fn().mockReturnValue(null) };
  capture.mockReset();
  capture.mockResolvedValue({
    document: {
      id: 'doc',
      workspaceId: 'workspace',
      platformProjectId: 'project',
      storyProjectId: null,
      currentSequence: 3,
    },
    sequence: 3,
    clips: [
      {
        shotId: 'shot',
        sourceNodeId: 'video',
        mediaAssetId: assetId,
        sourceUrl: 'http://127.0.0.1/private',
      },
    ],
  });
  return {
    asset,
    tx,
    documents,
    media,
    run: () =>
      captureAuthorizedStoryboard(
        tx as never,
        documents,
        media,
        'user',
        'doc',
        3,
      ),
  };
}
it('authorizes before capture, locks media and returns only managed identity rather than saved URLs', async () => {
  const h = fixture();
  const result = await h.run();
  expect(result.clips[0].source).toMatchObject({
    assetId,
    bucket: 'private',
    objectKey: 'video.mp4',
    contentType: 'video/mp4',
    sizeBytes: '100',
  });
  expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  expect(h.documents.requireDocumentRef).toHaveBeenCalledTimes(2);
  expect(
    h.documents.requireDocumentRef.mock.invocationCallOrder[0],
  ).toBeLessThan(capture.mock.invocationCallOrder[0]);
  expect(h.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
    h.tx.mediaAsset.findMany.mock.invocationCallOrder[0],
  );
  expect(h.media.denialForUse).toHaveBeenCalledWith('user', h.asset);
});
it('denies unreadable canvases before reading their clips', async () => {
  const h = fixture();
  h.documents.requireDocumentRef.mockRejectedValue(new ForbiddenException());
  await expect(h.run()).rejects.toThrow(ForbiddenException);
  expect(capture).not.toHaveBeenCalled();
});
it('fails if canvas access is revoked during media admission', async () => {
  const h = fixture();
  h.documents.requireDocumentRef
    .mockResolvedValueOnce({ id: 'doc' })
    .mockRejectedValueOnce(new ForbiddenException());
  await expect(h.run()).rejects.toThrow(ForbiddenException);
});
it('applies receipt, lifecycle and moderation denial before returning storage identities', async () => {
  const h = fixture();
  h.media.denialForUse.mockReturnValue(new GoneException('Blocked'));
  await expect(h.run()).rejects.toThrow('Blocked');
});
it.each([
  {
    storageProvider: 'external_url',
    bucket: null,
    externalUrl: 'https://elsewhere.invalid/video.mp4',
  },
  { kind: 'image' },
  { deletedAt: new Date() },
  { contentType: 'application/vnd.apple.mpegurl' },
  { sizeBytes: 0n },
  { sizeBytes: 513n * 1024n * 1024n },
])('rejects unsupported or unavailable media case %#', async (patch) => {
  const h = fixture();
  Object.assign(h.asset, patch);
  await expect(h.run()).rejects.toThrow();
});
it('does not treat an original poster or inactive copy as renderable video', async () => {
  const h = fixture();
  h.tx.mediaAsset.findMany.mockResolvedValue([
    {
      ...h.asset,
      placements: [
        {
          id: 'inactive',
          status: 'quarantined',
          storageProvider: 's3_compatible',
          bucket: 'private',
          objectKey: 'old.mp4',
        },
      ],
    },
  ]);
  await expect(h.run()).rejects.toThrow('No active managed storage copy');
});
it('selects the ready original variant storage identity', async () => {
  const h = fixture();
  h.tx.mediaAsset.findMany.mockResolvedValue([
    {
      ...h.asset,
      variants: [
        {
          status: 'ready',
          contentType: 'video/webm',
          sizeBytes: 200n,
          placements: [
            {
              id: 'original-placement',
              status: 'active',
              storageProvider: 's3_compatible',
              bucket: 'originals',
              region: null,
              objectKey: 'original.webm',
            },
          ],
        },
      ],
    },
  ]);
  expect((await h.run()).clips[0].source).toMatchObject({
    placementId: 'original-placement',
    bucket: 'originals',
    objectKey: 'original.webm',
    contentType: 'video/webm',
  });
});
it('preserves repeated clips and counts their bytes toward the render limit', async () => {
  const h = fixture();
  h.asset.sizeBytes = 512n * 1024n * 1024n;
  const base = await capture({} as never, 'doc', 3);
  capture.mockResolvedValue({
    ...base,
    clips: Array.from({ length: 5 }, (_, i) => ({
      ...base.clips[0],
      shotId: `shot-${i}`,
    })),
  });
  await expect(h.run()).rejects.toThrow('total export size limit');
});
it('requires saved asset identity and does not resolve arbitrary URLs', async () => {
  const h = fixture();
  const base = await capture({} as never, 'doc', 3);
  capture.mockResolvedValue({
    ...base,
    clips: [{ ...base.clips[0], mediaAssetId: null }],
  });
  await expect(h.run()).rejects.toThrow('no saved media identity');
  expect(h.tx.mediaAsset.findMany).not.toHaveBeenCalled();
});

it.each(['image/png', 'image/jpeg', 'image/webp'])(
  'authorizes managed %s images with the same access gates',
  async (contentType) => {
    const h = fixture();
    Object.assign(h.asset, { kind: 'image', contentType });
    expect((await h.run()).clips[0].source.contentType).toBe(contentType);
    h.media.denialForUse.mockReturnValue(new GoneException('Blocked image'));
    await expect(h.run()).rejects.toThrow('Blocked image');
  },
);
