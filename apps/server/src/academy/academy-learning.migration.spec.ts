import { Prisma } from '@prisma/client';
import { CreatorWithdrawalsService } from '../creator-withdrawals/creator-withdrawals.service';
import { PrismaService } from '../infra/db/db.module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
let db: InstanceType<typeof PGlite>;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE creator_withdrawals(id uuid PRIMARY KEY,status text,user_id text,currency text,amount_minor bigint);
 CREATE TABLE crew_payouts(id uuid,platform_withdrawal_id uuid,user_id text,currency text,status text,amount_minor bigint,net_amount_minor bigint,withholding_amount_minor bigint);
 CREATE TABLE crew_earning_entries(id uuid,currency text,amount_minor bigint,status text,user_id text,source_type text,revenue_distribution_id uuid);
 CREATE TABLE crew_payout_allocations(earning_id uuid,payout_id uuid,amount_minor bigint);`);
  await db.exec(`CREATE TABLE referral_rewards(id uuid PRIMARY KEY,user_id text,currency text,status text);
 CREATE TABLE referral_reward_items(id uuid PRIMARY KEY,reward_id uuid REFERENCES referral_rewards(id),amount_minor bigint,currency text,payout_type text,granted_at timestamptz);`);
  await db.exec(
    readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261007150000_academy_learning/migration.sql',
      ),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261007171000_referral_withdrawals/migration.sql',
      ),
      'utf8',
    ),
  );
  await db.exec(
    `CREATE CONSTRAINT TRIGGER creator_withdrawal_test_consistency AFTER INSERT OR UPDATE ON creator_withdrawals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_creator_withdrawal_payouts();`,
  );
});
afterAll(async () => {
  await db.close();
});
async function enroll(studentId: string = randomUUID(), teacherCredits = '50') {
  const id = randomUUID();
  await db.query(
    `INSERT INTO academy_enrollments(id,course_id,student_id,teacher_id,certificate_id,price_credits,teacher_credits,offering_version,updated_at) VALUES($1,'14',$2,'teacher',13,100,$3,1,now())`,
    [id, studentId, teacherCredits],
  );
  return id;
}
it('prevents duplicate purchases at the database boundary', async () => {
  const student = randomUUID();
  await enroll(student);
  await expect(enroll(student)).rejects.toThrow('unique');
});
it('cannot create more teacher income than the purchased credits', async () => {
  await expect(enroll(randomUUID(), '101')).rejects.toThrow('check constraint');
});
it('prevents self-purchases even if the application validation is bypassed', async () => {
  await expect(enroll('teacher')).rejects.toThrow('check constraint');
});
it('rolls back approval when the same review version was already recorded', async () => {
  const id = await enroll();
  await db.query(
    `INSERT INTO academy_enrollment_events(id,enrollment_id,actor_id,version,kind,details) VALUES($1,$2,'teacher',2,'approved','{}')`,
    [randomUUID(), id],
  );
  await expect(
    db.transaction(async (tx) => {
      await tx.query(
        `UPDATE academy_enrollments SET status='approved',version=2 WHERE id=$1`,
        [id],
      );
      await tx.query(
        `INSERT INTO academy_enrollment_events(id,enrollment_id,actor_id,version,kind,details) VALUES($1,$2,'teacher',2,'approved','{}')`,
        [randomUUID(), id],
      );
    }),
  ).rejects.toThrow('unique');
  const result = await db.query<{ status: string; version: number }>(
    `SELECT status,version FROM academy_enrollments WHERE id=$1`,
    [id],
  );
  expect(result.rows).toEqual([{ status: 'enrolled', version: 1 }]);
});

it('reconciles teaching withdrawals and prevents over-allocation', async () => {
  const id = await enroll();
  await db.query(
    `UPDATE academy_enrollments SET status='approved' WHERE id=$1`,
    [id],
  );
  const withdrawal = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO creator_withdrawals VALUES($1,'pending','teacher','USD',30)`,
      [withdrawal],
    );
    await tx.query(
      `INSERT INTO academy_withdrawal_allocations(id,withdrawal_id,enrollment_id,amount_minor) VALUES($1,$2,$3,30)`,
      [randomUUID(), withdrawal, id],
    );
  });
  await expect(
    db.transaction(async (tx) => {
      const second = randomUUID();
      await tx.query(
        `INSERT INTO creator_withdrawals VALUES($1,'pending','teacher','USD',30)`,
        [second],
      );
      await tx.query(
        `INSERT INTO academy_withdrawal_allocations(id,withdrawal_id,enrollment_id,amount_minor) VALUES($1,$2,$3,30)`,
        [randomUUID(), second, id],
      );
    }),
  ).rejects.toThrow('already reserved');
});
it('rejects withdrawals against another teacher or a different currency', async () => {
  for (const [teacher, currency] of [
    ['outsider', 'USD'],
    ['teacher', 'CNY'],
  ]) {
    const id = await enroll();
    await db.query(
      `UPDATE academy_enrollments SET status='approved' WHERE id=$1`,
      [id],
    );
    await expect(
      db.transaction(async (tx) => {
        const withdrawal = randomUUID();
        await tx.query(
          `INSERT INTO creator_withdrawals VALUES($1,'pending',$2,$3,30)`,
          [withdrawal, teacher, currency],
        );
        await tx.query(
          `INSERT INTO academy_withdrawal_allocations(id,withdrawal_id,enrollment_id,amount_minor) VALUES($1,$2,$3,30)`,
          [randomUUID(), withdrawal, id],
        );
      }),
    ).rejects.toThrow('reservations must match');
  }
});
it('keeps purchased financial terms immutable', async () => {
  const id = await enroll();
  await expect(
    db.query(`UPDATE academy_enrollments SET teacher_credits=90 WHERE id=$1`, [
      id,
    ]),
  ).rejects.toThrow('immutable');
});

it('shows source-specific available, reserved and paid teaching cash for only the authenticated teacher', async () => {
  const teacher = randomUUID(),
    id = randomUUID(),
    withdrawal = randomUUID();
  await db.query(
    `INSERT INTO academy_enrollments(id,course_id,student_id,teacher_id,certificate_id,price_credits,teacher_credits,offering_version,status,updated_at) VALUES($1,'14','student',$2,13,100,50,1,'approved',now())`,
    [id, teacher],
  );
  const prisma = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(parts, ...values);
      return (await db.query(sql.text, sql.values)).rows;
    },
  } as unknown as PrismaService;
  const service = new CreatorWithdrawalsService(prisma);
  expect(await service.balances(teacher)).toEqual([
    {
      currency: 'USD',
      pendingAmountMinor: '0',
      confirmedAmountMinor: '50',
      reservedAmountMinor: '0',
      paidAmountMinor: '0',
      availableAmountMinor: '50',
    },
  ]);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO creator_withdrawals VALUES($1,'pending',$2,'USD',30)`,
      [withdrawal, teacher],
    );
    await tx.query(
      `INSERT INTO academy_withdrawal_allocations(id,withdrawal_id,enrollment_id,amount_minor) VALUES($1,$2,$3,30)`,
      [randomUUID(), withdrawal, id],
    );
  });
  expect((await service.balances(teacher))[0]).toMatchObject({
    availableAmountMinor: '20',
    reservedAmountMinor: '30',
    paidAmountMinor: '0',
  });
  await db.query(`UPDATE creator_withdrawals SET status='paid' WHERE id=$1`, [
    withdrawal,
  ]);
  expect((await service.balances(teacher))[0]).toMatchObject({
    availableAmountMinor: '20',
    reservedAmountMinor: '0',
    paidAmountMinor: '30',
  });
  expect(await service.balances('outsider')).toEqual([]);
});

async function referral(
  currency = 'USD',
  amount = 100,
  payoutType = 'cash',
  granted = true,
) {
  const reward = randomUUID(),
    item = randomUUID(),
    user = randomUUID();
  await db.query(`INSERT INTO referral_rewards VALUES($1,$2,$3,'paid_out')`, [
    reward,
    user,
    currency,
  ]);
  await db.query(
    `INSERT INTO referral_reward_items VALUES($1,$2,$3,NULL,$4,$5)`,
    [
      item,
      reward,
      amount,
      payoutType,
      granted ? new Date().toISOString() : null,
    ],
  );
  return { item, user, reward };
}
async function allocateReferral(
  item: string,
  user: string,
  amount: number,
  currency = 'USD',
) {
  const w = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO creator_withdrawals VALUES($1,'pending',$2,$3,$4)`,
      [w, user, currency, amount],
    );
    await tx.query(
      `INSERT INTO referral_withdrawal_allocations(id,withdrawal_id,reward_item_id,amount_minor,currency) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), w, item, amount, currency],
    );
  });
  return w;
}
it('referral allocations cannot overdraw, switch currency or cross beneficiaries', async () => {
  const r = await referral('CNY');
  await allocateReferral(r.item, r.user, 60, 'CNY');
  await expect(allocateReferral(r.item, r.user, 41, 'CNY')).rejects.toThrow(
    'already reserved',
  );
  await expect(allocateReferral(r.item, r.user, 10, 'USD')).rejects.toThrow(
    'must match',
  );
  await expect(allocateReferral(r.item, 'outsider', 10, 'CNY')).rejects.toThrow(
    'must match',
  );
});
it('referral rejection releases source availability; paid allocations remain consumed', async () => {
  const r = await referral();
  const first = await allocateReferral(r.item, r.user, 100);
  await db.query(
    `UPDATE creator_withdrawals SET status='rejected' WHERE id=$1`,
    [first],
  );
  const second = await allocateReferral(r.item, r.user, 100);
  await db.query(`UPDATE creator_withdrawals SET status='paid' WHERE id=$1`, [
    second,
  ]);
  await expect(allocateReferral(r.item, r.user, 1)).rejects.toThrow(
    'already reserved',
  );
});
it('does not accept points or ungranted referral rewards as cash', async () => {
  for (const r of [
    await referral('USD', 100, 'community_points'),
    await referral('USD', 100, 'cash', false),
  ])
    await expect(allocateReferral(r.item, r.user, 10)).rejects.toThrow(
      'must match',
    );
});
it('freezes granted referral source amount and beneficiary', async () => {
  const r = await referral();
  await expect(
    db.query(`UPDATE referral_reward_items SET amount_minor=1000 WHERE id=$1`, [
      r.item,
    ]),
  ).rejects.toThrow('immutable');
  await expect(
    db.query(`UPDATE referral_rewards SET user_id='other' WHERE id=$1`, [
      r.reward,
    ]),
  ).rejects.toThrow('immutable');
});
