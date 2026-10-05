import type { Prisma, CreatorWithdrawal } from '@prisma/client';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import { PrismaService } from '../infra/db/db.module';
const recipient = {
  fullName: 'Creator',
  accountNumber: '123456789',
  address: 'Singapore',
  swift: 'DBSSSGSG',
  branchAddress: 'Branch',
};
const request = {
  requestId: '11111111-1111-4111-8111-111111111111',
  currency: 'USD' as const,
  percentageBps: 5000,
  expectedAvailableAmountMinor: '3000',
  recipient,
};
function fixture() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    creatorWithdrawal: {
      findUnique: jest
        .fn<
          Promise<CreatorWithdrawal | null>,
          [Prisma.CreatorWithdrawalFindUniqueArgs]
        >()
        .mockResolvedValue(null),
      create: jest
        .fn<Promise<CreatorWithdrawal>, [Prisma.CreatorWithdrawalCreateArgs]>()
        .mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            status: 'pending',
            version: 1,
            createdAt: new Date(),
          } as CreatorWithdrawal),
        ),
    },
    crewEarningEntry: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([{ crewId: 'crew' }])
        .mockResolvedValueOnce([
          {
            id: 'earning',
            crewId: 'crew',
            crewMemberId: 'member',
            amountMinor: 4000n,
            payoutAllocations: [{ amountMinor: 1000n }],
          },
        ]),
    },
    crewPayout: {
      create: jest
        .fn<Promise<{ id: string }>, [Prisma.CrewPayoutCreateArgs]>()
        .mockResolvedValue({ id: 'payout' }),
    },
    crewPayoutAllocation: { createMany: jest.fn() },
    crewPayoutEvent: { create: jest.fn() },
    creatorPayoutAccount: {
      upsert: jest.fn<void, [Prisma.CreatorPayoutAccountUpsertArgs]>(),
    },
    creatorWithdrawalEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: (fn: (value: typeof tx) => unknown) =>
      Promise.resolve(fn(tx)),
  };
  return {
    tx,
    service: new CreatorWithdrawalsService(prisma as unknown as PrismaService),
  };
}
const old = process.env.CREATOR_PAYOUT_DETAILS_KEY;
beforeEach(() => {
  process.env.CREATOR_PAYOUT_DETAILS_KEY = 'ab'.repeat(32);
});
afterEach(() => {
  if (old === undefined) delete process.env.CREATOR_PAYOUT_DETAILS_KEY;
  else process.env.CREATOR_PAYOUT_DETAILS_KEY = old;
});
it('reserves only the available task earnings and persists no plaintext bank details', async () => {
  const { tx, service } = fixture();
  const result = await service.request('alice', request);
  expect(result.amountMinor).toBe('1500');
  expect(result).not.toHaveProperty('recipientEncrypted');
  expect(tx.crewPayoutAllocation.createMany).toHaveBeenCalledWith({
    data: [
      {
        crewId: 'crew',
        payoutId: 'payout',
        earningId: 'earning',
        amountMinor: 1500n,
      },
    ],
  });
  expect(tx.crewPayout.create.mock.calls[0][0].data).toMatchObject({
    userId: 'alice',
    currency: 'USD',
    amountMinor: 1500n,
    platformWithdrawalId: result.id,
  });
  expect(
    tx.creatorPayoutAccount.upsert.mock.calls[0][0].create.detailsEncrypted,
  ).not.toContain(recipient.accountNumber);
  expect(tx.creatorWithdrawalEvent.create).toHaveBeenCalledTimes(1);
});
it('rejects a stale displayed balance before making reservations', async () => {
  const { tx, service } = fixture();
  await expect(
    service.request('alice', {
      ...request,
      expectedAvailableAmountMinor: '4000',
    }),
  ).rejects.toThrow('earnings changed');
  expect(tx.creatorWithdrawal.create).not.toHaveBeenCalled();
  expect(tx.crewPayout.create).not.toHaveBeenCalled();
});
it('replays the same request without allocating again, but rejects changed recipient details', async () => {
  const { tx, service } = fixture();
  await service.request('alice', request);
  const prior = await (tx.creatorWithdrawal.create.mock.results[0]
    .value as Promise<CreatorWithdrawal>);
  tx.creatorWithdrawal.findUnique.mockResolvedValue(prior);
  await service.request('alice', request);
  expect(tx.crewPayout.create).toHaveBeenCalledTimes(1);
  await expect(
    service.request('alice', {
      ...request,
      recipient: { ...recipient, accountNumber: 'other' },
    }),
  ).rejects.toThrow('different details');
});
