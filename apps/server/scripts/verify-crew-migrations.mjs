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
        'SELECT points_amount::text,currency FROM crew_earning_entries',
      )
    ).rows,
    [{ points_amount: '1000', currency: 'POINTS' }],
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
    await db.exec(`INSERT INTO crew_earning_entries(id,crew_id,crew_member_id,user_id,source_type,title,points_amount,currency,status,idempotency_key,created_by_user_id)
      VALUES ('${id(n)}','test','member','producer','adjustment','New',125,'${currency}','posted','${currency}','producer')`);
  }
  const payout = (earningId) =>
    db.transaction(async (tx) => {
      await tx.exec(`INSERT INTO crew_payouts(id,crew_id,crew_member_id,user_id,points_amount,net_amount_minor,currency,idempotency_key,created_by_user_id)
      VALUES ('${id(6)}','test','member','producer',125,125,'USD','settlement','producer');
      INSERT INTO crew_payout_allocations(id,crew_id,payout_id,earning_id,points_amount)
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
    'PASS: additive migrations preserve historical balances; qualification approval/revocation/future issuance/restoration/deletion; immutable currency; cross-currency rejection; same-currency payout commit.',
  );
  console.log(
    'Engine: isolated PGlite PostgreSQL. This does not verify deployed authentication or concurrent sessions.',
  );
} finally {
  await db.close();
}
