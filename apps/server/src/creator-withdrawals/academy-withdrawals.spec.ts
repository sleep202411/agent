import { Prisma } from '@prisma/client';
import {
  availableAcademyIncome,
  academyTotalsSql,
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

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

it('isolates each instructor share and reservation, including legacy enrollments', async () => {
  const sql = new PGlite();
  try {
    await sql.exec(`
      CREATE TABLE academy_enrollments (id text PRIMARY KEY, teacher_id text,
        teacher_credits bigint, instructor_shares jsonb, status text, reviewed_at timestamp);
      CREATE TABLE academy_withdrawal_allocations (enrollment_id text, withdrawal_id text, amount_minor bigint);
      CREATE TABLE creator_withdrawals (id text, user_id text, status text);
      INSERT INTO academy_enrollments VALUES
       ('split','200',50,'[{"teacherId":"200","credits":"40"},{"teacherId":"201","credits":"10"}]','approved',now()),
       ('legacy','200',20,'[]','approved',now()),
       ('pending','201',100,'[]','submitted',now());
      INSERT INTO creator_withdrawals VALUES ('a','200','pending'),('b','201','paid'),('c','201','rejected');
      INSERT INTO academy_withdrawal_allocations VALUES ('split','a',15),('split','b',3),('split','c',7);
    `);
    const tx = {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = Prisma.sql(strings, ...values);
        return (await sql.query(query.text, query.values)).rows;
      },
    } as unknown as Prisma.TransactionClient;
    expect(await availableAcademyIncome(tx, '200', 'USD')).toEqual([
      { id: 'legacy', available: '20' },
      { id: 'split', available: '25' },
    ]);
    expect(await availableAcademyIncome(tx, '201', 'USD')).toEqual([
      { id: 'split', available: '7' },
    ]);
    expect(await availableAcademyIncome(tx, '999', 'USD')).toEqual([]);
    const totals = Prisma.sql`${academyTotalsSql} AND e.teacher_id=${'201'} HAVING COUNT(*)>0`;
    expect((await sql.query(totals.text, totals.values)).rows).toEqual([
      { currency: 'USD', confirmed: '10', reserved: '0', paid: '3' },
    ]);
  } finally {
    await sql.close();
  }
}, 30000);
