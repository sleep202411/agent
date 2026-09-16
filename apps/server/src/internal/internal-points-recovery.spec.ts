import { Prisma } from '@prisma/client';
import { InternalPointsService } from './internal-points.service';
const marker = {
  userId: 'legacy-user',
  migratedBalance: 50,
  workspaceId: 'accepted-workspace',
};
function fixture(existing: typeof marker | null = marker) {
  const prisma = {
    pointsMigration: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(marker),
    },
    walletAccount: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'wallet', availableBalance: 0n }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const ledger = {
    postEntry: jest.fn().mockResolvedValue({
      account: { availableBalance: 50n },
      deduped: false,
    }),
  };
  const workspaces = {
    ensureDefaultWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'current-workspace' }),
  };
  return {
    prisma,
    ledger,
    service: new InternalPointsService(
      prisma as never,
      ledger as never,
      workspaces as never,
    ),
  };
}
it('recovers the accepted amount and destination after interruption despite a different retry', async () => {
  const { service, ledger } = fixture();
  await expect(
    service.migrate({ userId: marker.userId, balance: 900 }),
  ).resolves.toMatchObject({ workspaceId: marker.workspaceId });
  expect(ledger.postEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      amount: 50n,
      workspaceId: marker.workspaceId,
      metadata: { userId: marker.userId, migratedBalance: 50 },
    }),
  );
});
it('recovers an accepted positive balance even if the retry reports zero', async () => {
  const { service, ledger } = fixture();
  await service.migrate({ userId: marker.userId, balance: 0 });
  expect(ledger.postEntry).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 50n }),
  );
});
it('does not turn an accepted zero migration into a later positive grant', async () => {
  const { service, ledger } = fixture({ ...marker, migratedBalance: 0 });
  await service.migrate({ userId: marker.userId, balance: 900 });
  expect(ledger.postEntry).not.toHaveBeenCalled();
});
it('uses the winner of a concurrent marker insert', async () => {
  const { service, prisma, ledger } = fixture(null);
  prisma.pointsMigration.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValue(marker);
  prisma.pointsMigration.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    }),
  );
  await service.migrate({ userId: marker.userId, balance: 900 });
  expect(ledger.postEntry).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 50n, workspaceId: marker.workspaceId }),
  );
});
it('does not credit after an unrelated marker constraint failure', async () => {
  const { service, prisma, ledger } = fixture(null);
  const failure = new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
  });
  prisma.pointsMigration.create.mockRejectedValue(failure);
  await expect(
    service.migrate({ userId: marker.userId, balance: 900 }),
  ).rejects.toBe(failure);
  expect(ledger.postEntry).not.toHaveBeenCalled();
});
