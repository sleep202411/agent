import { IpCommerceService } from './ip-commerce.service';

function fixture(found = true) {
  const row = {
    id: 'saved',
    targetType: 'ip',
    ipId: 'ip',
    episodeId: null,
    status: 'active',
    addedAt: new Date(),
    lastViewedAt: null,
    removedAt: null,
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    ipCollectionItem: {
      findFirst: jest.fn().mockResolvedValue(found ? row : null),
      update: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: { status: string; removedAt: Date } }) =>
            Promise.resolve({ ...row, ...data }),
        ),
    },
  };
  const service = Object.create(
    IpCommerceService.prototype,
  ) as IpCommerceService;
  const publicLookup = jest.fn().mockResolvedValue(null);
  Object.defineProperties(service, {
    prisma: {
      value: {
        $transaction: async (work: (db: typeof tx) => Promise<unknown>) =>
          work(tx),
        ip: { findFirst: publicLookup },
        ipEpisode: { findFirst: publicLookup },
      },
    },
    viewerBlockWhere: { value: jest.fn().mockResolvedValue({}) },
  });
  return { service, tx, publicLookup };
}

describe('Collection removal after content becomes unavailable', () => {
  it.each(['ip', 'episode'] as const)(
    'removes an owned %s without requiring public visibility',
    async (targetType) => {
      const { service, tx, publicLookup } = fixture();
      const episodeId = targetType === 'episode' ? 'episode' : undefined;
      await expect(
        service.removeCollectionItem(
          { userId: 'owner' },
          { targetType, ipId: 'ip', episodeId },
        ),
      ).resolves.toMatchObject({ item: { status: 'removed' } });
      expect(tx.ipCollectionItem.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'owner',
          ipId: 'ip',
          episodeId: episodeId ?? null,
          targetType,
          removedAt: null,
        },
      });
      expect(publicLookup).not.toHaveBeenCalled();
    },
  );
  it('returns an idempotent empty result when the user has no matching saved record', async () => {
    const { service, tx } = fixture(false);
    await expect(
      service.removeCollectionItem(
        { userId: 'other' },
        { targetType: 'ip', ipId: 'ip' },
      ),
    ).resolves.toEqual({ item: null });
    expect(tx.ipCollectionItem.update).not.toHaveBeenCalled();
  });
  it('still rejects adding unavailable content', async () => {
    const { service, tx } = fixture();
    await expect(
      service.saveCollectionItem(
        { userId: 'owner' },
        { targetType: 'ip', ipId: 'ip' },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(tx.ipCollectionItem.update).not.toHaveBeenCalled();
  });
});
