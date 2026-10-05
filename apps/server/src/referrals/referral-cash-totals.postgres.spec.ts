import { Client } from 'pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { referralCashTotalsQuery } from './referral-cash-totals';
const databaseUrl = process.env.LOCAL_AUDIT_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('Referral bundle totals (owned PostgreSQL)', () => {
  let db: Client;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`
      CREATE TEMP TABLE referral_rewards (
        id text, user_id text, status text, payout_type text, amount_minor bigint, currency text
      );
      CREATE TEMP TABLE referral_reward_items (
        reward_id text, payout_type text, amount_minor bigint, currency text
      );
      INSERT INTO referral_rewards VALUES
        ('bundle','owner','accrued','points_compute',50,NULL),
        ('cash-first','owner','paid_out','cash',200,'USD'),
        ('old','owner','pending','cash',75,'USD'),
        ('reversed','owner','reversed','points_compute',20,NULL),
        ('euro','owner','qualified','cash',400,'EUR'),
        ('foreign','other','accrued','cash',999999,'USD');
      INSERT INTO referral_reward_items VALUES
        ('bundle','points_compute',50,NULL),('bundle','cash',1250,'USD'),
        ('cash-first','cash',200,'USD'),('cash-first','membership_compute',0,NULL),
        ('reversed','cash',300,'USD'),('euro','cash',400,'EUR');
    `);
  });
  afterAll(async () => {
    await db?.end();
  });
  it('includes secondary cash, counts snapshots once, isolates users and separates currency/status', async () => {
    const query = referralCashTotalsQuery('owner');
    const result = await db.query(query.text, query.values);
    expect(result.rows).toEqual([
      { status: 'qualified', currency: 'EUR', amount: '400' },
      { status: 'accrued', currency: 'USD', amount: '1250' },
      { status: 'paid_out', currency: 'USD', amount: '200' },
      { status: 'pending', currency: 'USD', amount: '75' },
      { status: 'reversed', currency: 'USD', amount: '300' },
    ]);
  });
});
