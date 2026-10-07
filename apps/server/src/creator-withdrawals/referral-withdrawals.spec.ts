import { Prisma } from '@prisma/client';
import {
  reserveReferralIncome,
  resolveReferralIncome,
} from './referral-withdrawals';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';
function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    referralWithdrawalAllocation: {
      create: jest.fn<
        Promise<void>,
        [{ data: { rewardItemId: string; amountMinor: bigint } }]
      >(),
      findMany: jest.fn().mockResolvedValue([{ amountMinor: 30n }]),
    },
    walletAccount: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'wallet' }),
    },
  };
  const wallet = { postEntryTx: jest.fn() };
  return {
    tx,
    wallet,
    db: tx as unknown as Prisma.TransactionClient,
    ledger: wallet as unknown as WalletLedgerService,
  };
}
it('reserves exact source allocations and holds their earned credits atomically', async () => {
  const f = fixture();
  await reserveReferralIncome(
    f.db,
    f.ledger,
    'referrer',
    'withdrawal',
    30n,
    'CNY',
    [
      { id: 'a', available: '20' },
      { id: 'b', available: '40' },
    ],
  );
  expect(
    f.tx.referralWithdrawalAllocation.create.mock.calls.map(([args]) => [
      args.data.rewardItemId,
      args.data.amountMinor,
    ]),
  ).toEqual([
    ['a', 20n],
    ['b', 10n],
  ]);
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({
      entryType: 'hold',
      amount: 30n,
      availableDelta: -30n,
      heldDelta: 30n,
      idempotencyKey: 'referral-withdrawal:withdrawal:hold',
      metadata: {
        currency: 'CNY',
        amountMinor: '30',
        credits: '30',
        minorUnitsPerCredit: 1,
      },
    }),
  );
});
it('rejects a reservation larger than the referral cash earnings', async () => {
  const f = fixture();
  await expect(
    reserveReferralIncome(
      f.db,
      f.ledger,
      'referrer',
      'withdrawal',
      50n,
      'CNY',
      [{ id: 'a', available: '20' }],
    ),
  ).rejects.toThrow('changed');
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
it.each([
  ['pay', 'settle', 0n],
  ['reject', 'release', 30n],
] as const)(
  'resolves the wallet hold on %s without crediting earnings again',
  async (action, entryType, availableDelta) => {
    const f = fixture();
    await resolveReferralIncome(
      f.db,
      f.ledger,
      'referrer',
      'withdrawal',
      'CNY',
      action,
    );
    expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
      f.db,
      expect.objectContaining({
        entryType,
        amount: 30n,
        availableDelta,
        heldDelta: -30n,
      }),
    );
  },
);
it('keeps Crew-only requests off the Referral wallet', async () => {
  const f = fixture();
  f.tx.referralWithdrawalAllocation.findMany.mockResolvedValue([]);
  await resolveReferralIncome(
    f.db,
    f.ledger,
    'referrer',
    'withdrawal',
    'CNY',
    'pay',
  );
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
