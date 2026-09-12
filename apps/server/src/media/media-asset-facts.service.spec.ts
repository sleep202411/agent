import { MediaAssetFactsService } from './media-asset-facts.service';

it('retains millisecond precision and stored image dimensions for reference billing', async () => {
  const prisma = {
    mediaAsset: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'video',
          kind: 'video',
          durationSeconds: 5,
          variants: [{ durationMs: 5499 }],
          width: 1366,
          height: 768,
          sizeBytes: 1000n,
        },
        {
          id: 'image',
          kind: 'image',
          durationSeconds: null,
          variants: [],
          width: 2048,
          height: 2048,
          sizeBytes: 100n,
        },
      ]),
    },
  };
  const service = new MediaAssetFactsService(prisma as never, {} as never);
  const facts = await service.ensureFacts(['video', 'image']);
  expect(facts.get('video')?.durationSeconds).toBe(5.499);
  expect(facts.get('image')).toMatchObject({ width: 2048, height: 2048 });
});
