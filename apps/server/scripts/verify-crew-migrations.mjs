// Isolated PostgreSQL verification. No DATABASE_URL is read or contacted.
import { PGlite } from '@electric-sql/pglite';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('../', import.meta.url));
const migration = (name) =>
  readFileSync(`${cwd}/prisma/migrations/${name}/migration.sql`, 'utf8');
const schema = execFileSync(
  process.execPath,
  [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema',
    'prisma/schema.prisma',
    '--script',
  ],
  { cwd, encoding: 'utf8', maxBuffer: 10_000_000 },
);
const db = await PGlite.create();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(schema);
  // Reconstruct the pre-currency financial columns before applying the real migrations.
  await db.exec(`ALTER TABLE crew_task_assignees RENAME COLUMN reward_amount_minor TO reward_points;
    ALTER TABLE crew_earning_entries RENAME COLUMN amount_minor TO points_amount;
    ALTER TABLE crew_payouts RENAME COLUMN amount_minor TO points_amount;
    ALTER TABLE crew_payout_allocations RENAME COLUMN amount_minor TO points_amount;
    ALTER TABLE crew_payout_allocations ADD CONSTRAINT crew_payout_allocations_points_check CHECK (points_amount > 0);`);
  await db.exec(`ALTER TABLE user_certificates DROP COLUMN credential_type;
    ALTER TABLE crew_task_assignees DROP COLUMN currency;
    ALTER TABLE crew_earning_entries DROP COLUMN currency;
    ALTER TABLE crew_payouts DROP COLUMN currency;
    INSERT INTO media_assets(id,kind,storage_provider) VALUES ('${id(1)}','image','external_url');
    INSERT INTO user_certificates(id,user_id,cert_no,title,image_asset_id) VALUES ('${id(2)}','producer','FD-GEN-2609-ABCDEF','FizzDragon Certified AI Producer','${id(1)}');
    INSERT INTO crews(id,name,description,logo,created_by_user_id) VALUES ('test','Test','','','producer');
    INSERT INTO crew_members(id,crew_id,user_id,joined_via) VALUES ('member','test','producer','creation');
    INSERT INTO crew_earning_entries(id,crew_id,crew_member_id,user_id,source_type,title,points_amount,status,idempotency_key,created_by_user_id)
      VALUES ('${id(3)}','test','member','producer','adjustment','Historical',1000,'posted','legacy','producer');`);
  await db.exec(migration('20260802193000_crew_earnings_invariants'));
  await db.exec(migration('20260908120000_producer_credential'));
  await db.exec(migration('20260908121000_crew_ledger_currency'));
  // An assigned task with no reward must remain editable after migration.
  await db.exec(`INSERT INTO crew_task_workflow_states(id,crew_id,name,color,semantic,created_by_user_id)
      VALUES ('${id(20)}','test','Open','#888888','open','producer');
    INSERT INTO crew_tasks(id,crew_id,number,title,workflow_state_id,created_by_user_id)
      VALUES ('${id(21)}','test',1,'Legacy task','${id(20)}','producer');
    INSERT INTO crew_task_assignees(id,crew_id,task_id,crew_member_id,user_id,reward_points)
      VALUES ('${id(22)}','test','${id(21)}','member','producer',NULL);
    INSERT INTO crew_payouts(id,crew_id,crew_member_id,user_id,points_amount,net_amount_minor,idempotency_key,created_by_user_id)
      VALUES ('${id(23)}','test','member','producer',400,400,'old-payout','producer');
    INSERT INTO crew_payout_allocations(id,crew_id,payout_id,earning_id,points_amount)
      VALUES ('${id(24)}','test','${id(23)}','${id(3)}',400);
    INSERT INTO notifications(id,user_id,type,title,body,idempotency_key,meta)
      VALUES ('notice','producer','crew.earning.posted','Historical','1000 points','notice',
        '${JSON.stringify({ earningId: id(3), pointsAmount: '1000', earningTitle: 'Historical' })}');`);
  await db.exec(migration('20260908170000_crew_money'));
  const eligible = async () =>
    (
      await db.query(
        `SELECT id FROM user_certificates WHERE user_id='producer' AND credential_type='fizzdragon_certified_ai_producer' AND revoked_at IS NULL AND issued_at <= CURRENT_TIMESTAMP ORDER BY id LIMIT 1 FOR SHARE`,
      )
    ).rows.length;
  assert.equal(await eligible(), 0, 'Title matching must never grant access');
  await db.exec(
    `UPDATE user_certificates SET credential_type='fizzdragon_certified_ai_producer'`,
  );
  assert.equal(await eligible(), 1);
  await db.exec('UPDATE user_certificates SET revoked_at=now()');
  assert.equal(await eligible(), 0);
  await db.exec(
    `UPDATE user_certificates SET revoked_at=null,issued_at=now()+interval '1 day'`,
  );
  assert.equal(await eligible(), 0);
  await db.exec(
    `UPDATE user_certificates SET issued_at=now()-interval '1 day'`,
  );
  assert.equal(await eligible(), 1);
  await db.exec('DELETE FROM user_certificates');
  assert.equal(await eligible(), 0);
  assert.deepEqual(
    (
      await db.query(
        'SELECT amount_minor::text,currency FROM crew_earning_entries',
      )
    ).rows,
    [{ amount_minor: '1000', currency: 'USD' }],
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT amount_minor::text,net_amount_minor::text,currency,version,status FROM crew_payouts',
      )
    ).rows,
    [
      {
        amount_minor: '400',
        net_amount_minor: '400',
        currency: 'USD',
        version: 1,
        status: 'pending',
      },
    ],
  );
  assert.deepEqual(
    (await db.query('SELECT amount_minor::text FROM crew_payout_allocations'))
      .rows,
    [{ amount_minor: '400' }],
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT reward_amount_minor,currency FROM crew_task_assignees',
      )
    ).rows,
    [{ reward_amount_minor: null, currency: 'USD' }],
  );
  await db.exec(
    "UPDATE crew_task_assignees SET reward_amount_minor=1000,currency='CNY'",
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT reward_amount_minor::text,currency FROM crew_task_assignees',
      )
    ).rows,
    [{ reward_amount_minor: '1000', currency: 'CNY' }],
  );
  assert.deepEqual(
    (await db.query('SELECT meta FROM notifications')).rows[0].meta,
    {
      earningId: id(3),
      earningTitle: 'Historical',
      amountMinor: '1000',
      currency: 'USD',
    },
  );
  for (const currency of ["'POINTS'", "'EUR'", 'DEFAULT']) {
    await assert.rejects(
      db.exec(`INSERT INTO crew_earning_entries(id,crew_id,crew_member_id,user_id,source_type,title,amount_minor,currency,idempotency_key,created_by_user_id)
      VALUES ('${id(30)}','test','member','producer','adjustment','Invalid',100,${currency},'invalid','producer')`),
    );
  }
  await assert.rejects(
    db.exec(
      "UPDATE crew_earning_entries SET amount_minor=1,status='reversed',version=version+1",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.exec(
      "UPDATE crew_payouts SET amount_minor=1,status='voided',version=version+1",
    ),
    /immutable/,
  );
  await assert.rejects(
    db.exec(
      `UPDATE crew_earning_entries SET currency='CNY',status='reversed',version=version+1`,
    ),
    /immutable/,
  );
  for (const [n, currency] of [
    [4, 'CNY'],
    [5, 'USD'],
  ]) {
    await db.exec(`INSERT INTO crew_earning_entries(id,crew_id,crew_member_id,user_id,source_type,title,amount_minor,currency,status,idempotency_key,created_by_user_id)
      VALUES ('${id(n)}','test','member','producer','adjustment','New',125,'${currency}','posted','${currency}','producer')`);
  }
  const payout = (earningId) =>
    db.transaction(async (tx) => {
      await tx.exec(`INSERT INTO crew_payouts(id,crew_id,crew_member_id,user_id,amount_minor,net_amount_minor,currency,idempotency_key,created_by_user_id)
      VALUES ('${id(6)}','test','member','producer',125,125,'USD','settlement','producer');
      INSERT INTO crew_payout_allocations(id,crew_id,payout_id,earning_id,amount_minor)
      VALUES ('${id(7)}','test','${id(6)}','${earningId}',125)`);
    });
  await assert.rejects(payout(id(4)), /currency mismatch/);
  await payout(id(5));
  await assert.rejects(
    db.exec(
      `UPDATE crew_payouts SET currency='CNY',status='voided',version=version+1`,
    ),
    /immutable/,
  );
  console.log(
    'PASS: historical amounts and allocations convert to USD unchanged; no-reward assignee accepts money; required currency; qualification approval/revocation/future issuance/restoration/deletion; immutable currency; cross-currency rejection; same-currency payout commit.',
  );
  console.log(
    'Engine: isolated PGlite PostgreSQL. This does not verify deployed authentication or concurrent sessions.',
  );
} finally {
  await db.close();
}
