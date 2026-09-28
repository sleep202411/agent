import { Prisma } from '@prisma/client';
import { IpCommerceService } from './ip-commerce.service';

function fixture(commitFailure = false) {
  const conflict = new Prisma.PrismaClientKnownRequestError('conflict', {
    code: 'P2002',
    clientVersion: 'test',
  });
  const existing = jest.fn().mockResolvedValue(null);
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    ipViewEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'event' }),
    },
    ipEngagementAggregate: { upsert: jest.fn().mockResolvedValue({}) },
  };
  if (!commitFailure) tx.ipViewEvent.create.mockRejectedValue(conflict);
  const transaction = jest.fn(
    async (work: (value: typeof tx) => Promise<unknown>) => {
      const result = await work(tx);
      if (commitFailure) throw conflict;
      return result;
    },
  );
  const service = Object.create(
    IpCommerceService.prototype,
  ) as IpCommerceService;
  Object.defineProperties(service, {
    prisma: {
      value: {
        $transaction: transaction,
        ipViewEvent: { findUnique: existing },
      },
    },
    ensurePublicEngagementTarget: { value: jest.fn().mockResolvedValue({}) },
    engagementStatsForIp: {
      value: jest.fn().mockResolvedValue({
        viewCount: 0,
        likeCount: 0,
        collectionCount: 0,
        viewerHasLiked: false,
      }),
    },
  });
  return { service, conflict, existing, tx };
}

describe('IP view conflict recovery', () => {
  it('propagates an anonymous unkeyed write conflict', async () => {
    const { service, conflict } = fixture();
    await expect(
      service.recordIpView(undefined, 'ip', { source: 'public_api' }),
    ).rejects.toBe(conflict);
  });
  it('propagates a keyed conflict when no committed event exists', async () => {
    const { service, conflict } = fixture();
    await expect(
      service.recordIpView(undefined, 'ip', {
        source: 'public_api',
        idempotencyKey: 'view-key',
      }),
    ).rejects.toBe(conflict);
  });
  it('returns a duplicate only after recovering a committed keyed event', async () => {
    const { service, existing } = fixture();
    existing.mockResolvedValue({ id: 'winner' });
    await expect(
      service.recordIpView(undefined, 'ip', {
        source: 'public_api',
        idempotencyKey: 'view-key',
      }),
    ).resolves.toMatchObject({ recorded: false });
    expect(existing).toHaveBeenCalledWith({
      where: { idempotencyKey: 'view-key' },
      select: { id: true },
    });
  });
  it('does not report rolled-back writes as recorded after a commit conflict', async () => {
    const { service, existing } = fixture(true);
    existing.mockResolvedValue({ id: 'winner' });
    await expect(
      service.recordIpView(undefined, 'ip', {
        source: 'public_api',
        idempotencyKey: 'view-key',
      }),
    ).resolves.toMatchObject({ recorded: false });
  });
});
