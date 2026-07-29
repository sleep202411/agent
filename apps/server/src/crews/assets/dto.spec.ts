import { UpdateCrewAssetNodeSchema } from './dto';

describe('crew asset DTOs', () => {
  it('requires a concurrency token for rename and move operations', () => {
    expect(() =>
      UpdateCrewAssetNodeSchema.parse({ name: 'approved.png' }),
    ).toThrow();
    expect(
      UpdateCrewAssetNodeSchema.parse({
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        name: 'approved.png',
      }),
    ).toEqual({
      expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      name: 'approved.png',
    });
  });

  it('rejects an update that changes no asset metadata', () => {
    expect(() =>
      UpdateCrewAssetNodeSchema.parse({
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
      }),
    ).toThrow('At least one of parentId or name is required');
  });
});
