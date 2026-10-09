import { USD_ACADEMY_QUOTE, type AcademyQuote } from './academy-fx';
import { Prisma } from '@prisma/client';
import {
  availableAcademyIncome,
  academyTotals,
  planAcademyIncome,
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
        credits: '30',
        settlement:
          'Per-source currency and exchange-rate snapshots are retained in Academy allocations.',
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
      CREATE TABLE academy_withdrawal_allocations (enrollment_id text, withdrawal_id text, amount_minor bigint, source_credits bigint, currency text DEFAULT 'USD');
      CREATE TABLE creator_withdrawals (id text, user_id text, status text);
      INSERT INTO academy_enrollments VALUES
       ('split','200',50,'[{"teacherId":"200","credits":"40"},{"teacherId":"201","credits":"10"}]','approved',now()),
       ('legacy','200',20,'[]','approved',now()),
       ('pending','201',100,'[]','submitted',now());
      INSERT INTO creator_withdrawals VALUES ('a','200','pending'),('b','201','paid'),('c','201','rejected');
      INSERT INTO academy_withdrawal_allocations (enrollment_id,withdrawal_id,amount_minor) VALUES ('split','a',15),('split','b',3),('split','c',7);
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
      {
        id: 'legacy',
        available: '20',
        availableCredits: '20',
        quote: USD_ACADEMY_QUOTE,
      },
      {
        id: 'split',
        available: '25',
        availableCredits: '25',
        quote: USD_ACADEMY_QUOTE,
      },
    ]);
    expect(await availableAcademyIncome(tx, '201', 'USD')).toEqual([
      {
        id: 'split',
        available: '7',
        availableCredits: '7',
        quote: USD_ACADEMY_QUOTE,
      },
    ]);
    expect(await availableAcademyIncome(tx, '999', 'USD')).toEqual([]);
    const totals = Prisma.sql`${academyTotals(USD_ACADEMY_QUOTE)} AND e.teacher_id=${'201'} GROUP BY e.currency HAVING COUNT(*)>0`;
    expect((await sql.query(totals.text, totals.values)).rows).toEqual([
      { currency: 'USD', confirmed: '10', reserved: '0', paid: '3' },
    ]);
  } finally {
    await sql.close();
  }
}, 30000);

const cnyQuote: AcademyQuote = {
  currency: 'CNY',
  rate: '7.123456',
  source: 'Bank quote test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  version: 2,
};
it('snapshots RMB cash separately from the original points held and released', async () => {
  const f = fixture();
  const income = [
    { id: 'e', available: '712', availableCredits: '100', quote: cnyQuote },
  ];
  const plan = planAcademyIncome(356n, income);
  expect(plan.amount).toBe(356n);
  expect(plan.allocations[0].credits).toBe(50n);
  await reserveAcademyIncome(
    f.db,
    f.ledger,
    'teacher',
    'withdrawal',
    plan.amount,
    income,
  );
  expect(f.tx.academyWithdrawalAllocation.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      amountMinor: 356n,
      sourceCredits: 50n,
      currency: 'CNY',
      exchangeRate: cnyQuote,
    }) as unknown,
  });
  expect(f.wallet.postEntryTx).toHaveBeenCalledWith(
    f.db,
    expect.objectContaining({ amount: 50n, heldDelta: 50n }),
  );
  f.tx.academyWithdrawalAllocation.findMany.mockResolvedValue([
    { amountMinor: 356n, sourceCredits: 50n },
  ]);
  await resolveAcademyIncome(f.db, f.ledger, 'teacher', 'withdrawal', 'reject');
  expect(f.wallet.postEntryTx).toHaveBeenLastCalledWith(
    f.db,
    expect.objectContaining({
      amount: 50n,
      availableDelta: 50n,
      heldDelta: -50n,
    }),
  );
});
it('rounds cash down without discarding unconsumed points or exceeding the request', () => {
  const income = [
    { id: 'e', available: '712', availableCredits: '100', quote: cnyQuote },
  ];
  expect(planAcademyIncome(100n, income).amount).toBe(99n);
  expect(planAcademyIncome(100n, income).allocations[0].credits).toBe(14n);
  expect(planAcademyIncome(712n, income).allocations[0].credits).toBe(100n);
  expect(planAcademyIncome(1n, income).amount).toBe(0n);
});
it('does not use expired exchange quotes', () => {
  expect(() =>
    planAcademyIncome(100n, [
      {
        id: 'e',
        available: '100',
        quote: { ...cnyQuote, expiresAt: '2020-01-01T00:00:00Z' },
      },
    ]),
  ).toThrow('expired');
});

it('preserves historical USD and CNY settlements when the current RMB rate changes or expires', async () => {
  const sql = new PGlite();
  try {
    await sql.exec(`
      CREATE TABLE academy_enrollments (id text PRIMARY KEY, teacher_id text, teacher_credits bigint, instructor_shares jsonb, status text, reviewed_at timestamp);
      CREATE TABLE academy_withdrawal_allocations (enrollment_id text, withdrawal_id text, amount_minor bigint, source_credits bigint, currency text);
      CREATE TABLE creator_withdrawals (id text, user_id text, status text);
      INSERT INTO academy_enrollments VALUES ('e','teacher',100,'[]','approved',now());
      INSERT INTO creator_withdrawals VALUES ('old','teacher','paid'),('new','teacher','pending'),('rejected','teacher','rejected'),('other','other','paid');
      INSERT INTO academy_withdrawal_allocations VALUES ('e','old',10,NULL,'USD'),('e','new',140,20,'CNY'),('e','rejected',70,10,'CNY'),('e','other',99,99,'USD');
    `);
    const totals = async (quote: AcademyQuote | null) => {
      const q = Prisma.sql`${academyTotals(quote)} AND e.teacher_id=${'teacher'} GROUP BY e.currency ORDER BY e.currency`;
      return (await sql.query(q.text, q.values)).rows;
    };
    expect(await totals({ ...cnyQuote, rate: '8.000000' })).toEqual([
      { currency: 'CNY', confirmed: '700', reserved: '140', paid: '0' },
      { currency: 'USD', confirmed: '10', reserved: '0', paid: '10' },
    ]);
    expect(await totals(null)).toEqual([
      { currency: 'CNY', confirmed: '140', reserved: '140', paid: '0' },
      { currency: 'USD', confirmed: '10', reserved: '0', paid: '10' },
    ]);
  } finally {
    await sql.close();
  }
}, 30000);

it('does not consume additional points hidden by minor-unit rounding', () => {
  const plan = planAcademyIncome(1n, [
    {
      id: 'e',
      available: '5',
      availableCredits: '10',
      quote: { ...cnyQuote, rate: '0.500000' },
    },
  ]);
  expect(plan.amount).toBe(1n);
  expect(plan.allocations[0].credits).toBe(2n);
});
