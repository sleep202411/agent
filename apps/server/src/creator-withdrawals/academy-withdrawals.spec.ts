import { Prisma } from '@prisma/client';
import {
  availableAcademyIncome,
  reserveAcademyIncome,
  resolveAcademyIncome,
} from './academy-withdrawals';
import { WalletLedgerService } from '../workspaces/wallet-ledger.service';
function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    academyWithdrawalAllocation: {
      create: jest.fn<
        Promise<void>,
        [{ data: { enrollmentId: string; amountMinor: bigint } }]
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
it('never interprets unrelated CNY cash rewards as Academy dollars', async () => {
  const f = fixture();
  expect(await availableAcademyIncome(f.db, 'teacher', 'CNY')).toEqual([]);
  expect(f.tx.$queryRaw).not.toHaveBeenCalled();
});
it('reserves exact source allocations and holds their earned credits atomically', async () => {
  const f = fixture();
  await reserveAcademyIncome(f.db, f.ledger, 'teacher', 'withdrawal', 30n, [
    { id: 'a', available: '20' },
    { id: 'b', available: '40' },
  ]);
  expect(
    f.tx.academyWithdrawalAllocation.create.mock.calls.map(([args]) => [
      args.data.enrollmentId,
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
      idempotencyKey: 'academy-withdrawal:withdrawal:hold',
      metadata: {
        currency: 'USD',
        amountMinor: '30',
        credits: '30',
        minorUnitsPerCredit: 1,
      },
    }),
  );
});
it('rejects a reservation larger than the course earnings', async () => {
  const f = fixture();
  await expect(
    reserveAcademyIncome(f.db, f.ledger, 'teacher', 'withdrawal', 50n, [
      { id: 'a', available: '20' },
    ]),
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
    await resolveAcademyIncome(f.db, f.ledger, 'teacher', 'withdrawal', action);
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
it('keeps Crew-only requests off the Academy wallet', async () => {
  const f = fixture();
  f.tx.academyWithdrawalAllocation.findMany.mockResolvedValue([]);
  await resolveAcademyIncome(f.db, f.ledger, 'teacher', 'withdrawal', 'pay');
  expect(f.wallet.postEntryTx).not.toHaveBeenCalled();
});
