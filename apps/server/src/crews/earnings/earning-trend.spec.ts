import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { readEarningTrend } from './earning-trend';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const now = new Date('2026-09-29T12:00:00.000Z');
describe('Full-ledger income trend', () => {
  let db: import('@electric-sql/pglite').PGlite;
  const reader = {
    $queryRaw: async <T>(query: Prisma.Sql): Promise<T> =>
      (
        await db.query(
          query.text,
          query.values.map((value) =>
            value instanceof Date ? value.toISOString() : value,
          ),
        )
      ).rows as T,
  };
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(
      'CREATE TABLE crew_earning_entries(crew_id text,user_id text,currency text,status text,source_type text,posted_at timestamptz,amount_minor bigint,created_at timestamptz)',
    );
  }, 30000);
  beforeEach(async () => {
    await db.exec('DELETE FROM crew_earning_entries');
  });
  afterAll(async () => {
    await db.close();
  });
  async function add(amount: string, overrides: Record<string, string> = {}) {
    const row = {
      crew: 'crew',
      user: 'alice',
      currency: 'USD',
      status: 'posted',
      source: 'task_reward',
      date: '2026-09-29T00:00:00Z',
      recorded: '2026-09-29T00:00:00Z',
      ...overrides,
    };
    await db.query(
      'INSERT INTO crew_earning_entries VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        row.crew,
        row.user,
        row.currency,
        row.status,
        row.source,
        row.date,
        amount,
        row.recorded,
      ],
    );
  }
  it('includes the first instant and last millisecond of selected recorded UTC days only', async () => {
    await add('100', { recorded: '2026-09-27T23:59:59.999Z' });
    await add('200', { recorded: '2026-09-28T00:00:00Z' });
    await add('300', { recorded: '2026-09-28T23:59:59.999Z' });
    await add('400', { recorded: '2026-09-29T00:00:00Z' });
    await add('500', {
      recorded: '2026-09-28T12:00:00Z',
      user: 'someone-else',
    });
    const result = await readEarningTrend(
      reader,
      {
        currency: 'USD',
        userId: 'alice',
        createdAt: {
          gte: new Date('2026-09-28T00:00:00Z'),
          lt: new Date('2026-09-29T00:00:00Z'),
        },
      },
      now,
    );
    expect(result.days[29].amountMinor).toBe('500');
  });
  it('aggregates more than one page exactly, including amounts above safe JS integers', async () => {
    for (let i = 0; i < 55; i++) await add('9007199254740993');
    const result = await readEarningTrend(
      reader,
      { currency: 'USD', crewId: 'crew', userId: 'alice' },
      now,
    );
    expect(result.days).toHaveLength(30);
    expect(result.days[29]).toEqual({
      date: '2026-09-29',
      amountMinor: (9007199254740993n * 55n).toString(),
    });
    expect(result.days[0]).toEqual({ date: '2026-08-31', amountMinor: '0' });
  });
  it('isolates beneficiaries, Crews and currencies while excluding unposted/reversed income', async () => {
    await add('100');
    await add('200', { user: 'bob' });
    await add('300', { crew: 'other' });
    await add('400', { currency: 'CNY' });
    for (const status of ['pending', 'rejected', 'reversed'])
      await add('500', { status });
    expect(
      (
        await readEarningTrend(
          reader,
          { currency: 'USD', crewId: 'crew', userId: 'alice' },
          now,
        )
      ).days[29].amountMinor,
    ).toBe('100');
    expect(
      (await readEarningTrend(reader, { currency: 'USD', crewId: 'crew' }, now))
        .days[29].amountMinor,
    ).toBe('300');
    expect(
      (
        await readEarningTrend(
          reader,
          { currency: 'USD', userId: 'alice' },
          now,
        )
      ).days[29].amountMinor,
    ).toBe('400');
  });
  it('uses UTC posting dates and excludes entries outside the reporting window', async () => {
    await add('10', { date: '2026-08-30T23:59:59Z' });
    await add('20', { date: '2026-08-31T00:00:00Z' });
    await add('30', { date: '2026-09-29T00:30:00+08:00' });
    await add('40', { date: '2026-09-29T12:00:01Z' });
    const result = await readEarningTrend(
      reader,
      { currency: 'USD', userId: 'alice' },
      now,
    );
    expect(result.days[0].amountMinor).toBe('20');
    expect(result.days[28].amountMinor).toBe('30');
    expect(result.days[29].amountMinor).toBe('0');
  });
  it('preserves source/status scope and parameterizes caller-supplied identifiers', async () => {
    await add('100');
    await add('200', { source: 'revenue_share' });
    expect(
      (
        await readEarningTrend(
          reader,
          { currency: 'USD', userId: 'alice', sourceType: 'revenue_share' },
          now,
        )
      ).days[29].amountMinor,
    ).toBe('200');
    expect(
      (
        await readEarningTrend(
          reader,
          { currency: 'USD', userId: 'alice', status: 'pending' },
          now,
        )
      ).days[29].amountMinor,
    ).toBe('0');
    expect(
      (
        await readEarningTrend(
          reader,
          { currency: 'USD', userId: "alice' OR true --" },
          now,
        )
      ).days.every((day) => day.amountMinor === '0'),
    ).toBe(true);
  });
  it('applies both reporting indexes to the ledger schema', async () => {
    await db.exec(
      readFileSync(
        join(
          __dirname,
          '../../../prisma/migrations/20260929221500_crew_earning_trend_indexes/migration.sql',
        ),
        'utf8',
      ),
    );
    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename='crew_earning_entries'",
    );
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
      'crew_earning_entries_crew_posted_trend_idx',
      'crew_earning_entries_user_posted_trend_idx',
    ]);
  });
  it('refuses an unscoped ledger read', async () => {
    await expect(
      readEarningTrend(reader, { currency: 'USD' }, now),
    ).rejects.toThrow('authorized earning scope');
  });
});
