// Runs the actual cutover against an isolated PostgreSQL engine. No database URL is used.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'workspace-migration-'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = await PGlite.create();
try {
  // Reconstruct only the columns removed by this migration, using the current
  // full schema for every untouched model and relation.
  let before = readFileSync(`${cwd}/prisma/schema.prisma`, 'utf8')
    .replace(/^\s*defaultForUserId\s+String\?.*$/m, '  type WorkspaceType')
    .replace(
      '@@index([ownerUserId, deletedAt], map: "workspaces_owner_idx")',
      '@@index([ownerUserId, type, deletedAt], map: "workspaces_owner_type_idx")',
    )
    .replace(
      'model StoryProject {',
      'model StoryProject {\n  billingMode StoryProjectBillingMode @default(actor) @map("billing_mode")\n  billingAccountId String? @map("billing_account_id") @db.Uuid\n  billingAccount WalletAccount? @relation("StoryProjectBillingAccount", fields: [billingAccountId], references: [id], onDelete: Restrict)',
    )
    .replace(
      'model WalletAccount {',
      'model WalletAccount {\n  storyProjects StoryProject[] @relation("StoryProjectBillingAccount")',
    );
  before +=
    '\nenum WorkspaceType {\n personal\n team\n}\nenum StoryProjectBillingMode {\n actor\n account\n}\n';
  const schemaPath = join(temporary, 'before.prisma');
  writeFileSync(schemaPath, before);
  const sql = execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      schemaPath,
      '--script',
    ],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10_000_000,
      env: { ...process.env, DEBUG: 'prisma:migrate:diff' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  assert.ok(
    sql.includes('CREATE TABLE "workspaces"'),
    'Prisma must produce the full baseline schema',
  );
  await db.exec('CREATE SEQUENCE ip_room_number_seq START 1;');
  await db.exec(sql);
  // Prisma does not express these existing SQL-only checks.
  await db.exec(`ALTER TABLE story_projects ADD CONSTRAINT story_projects_billing_mode_account_check CHECK (
    (billing_mode = 'actor' AND billing_account_id IS NULL) OR
    (billing_mode = 'account' AND billing_account_id IS NOT NULL)
  );
  ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_billing_subject_pair_check CHECK (
    (billing_subject_type IS NULL AND billing_subject_id IS NULL) OR
    (billing_subject_type IS NOT NULL AND billing_subject_id IS NOT NULL)
  );`);
  await db.exec(`CREATE UNIQUE INDEX workspaces_personal_owner_unique ON workspaces(owner_user_id) WHERE type='personal' AND deleted_at IS NULL;
    INSERT INTO workspaces(id,type,name,owner_user_id,created_by_id) VALUES
      ('${id(1)}','personal','Default A','alice','alice'),
      ('${id(2)}','personal','Default B','bob','bob'),
      ('${id(3)}','team','Shared','alice','alice');
    INSERT INTO wallet_accounts(id,owner_type,owner_id,currency,available_balance,held_balance) VALUES
      ('${id(10)}','workspace','${id(1)}','compute_point',1000,100),
      ('${id(11)}','workspace','${id(3)}','compute_point',2000,200),
      ('${id(12)}','user','legacy','compute_point',300,10);
    INSERT INTO story_projects(id,workspace_id,frame_profile,title,created_by_user_id,billing_mode,billing_account_id) VALUES
      ('${id(20)}','${id(3)}','landscape_16_9','Actor story','alice','actor',NULL),
      ('${id(21)}','${id(3)}','landscape_16_9','Account story','alice','account','${id(10)}');`);
  const walletsBefore = (
    await db.query('SELECT * FROM wallet_accounts ORDER BY id')
  ).rows;
  async function job(
    n,
    { user = 'bob', workspace = id(1), story = null, frozen = null } = {},
  ) {
    await db.query(
      `INSERT INTO ai_jobs(id,user_id,type,provider,model_id,deployment,schema_version,workspace_id,story_project_id,billing_subject_type,billing_subject_id,status,stage,queue_name,prompt,idempotency_key,input,normalized_input,logs,metrics)
      VALUES ($1::uuid,$2,'image','test','test','test','1',$3,$4,$5,$6,'in_queue','queued','test','', $1::uuid::text,'{}','{}','[]','{}')`,
      [id(n), user, workspace, story, frozen?.type ?? null, frozen?.id ?? null],
    );
  }
  await job(30); // invited collaborator in an old personal workspace
  await job(31, { workspace: id(3) }); // old shared pot
  await job(32, { workspace: id(3), story: id(20) }); // actor policy wins over team type
  await job(33, { workspace: id(3), story: id(21) }); // explicit account policy
  await job(34, { user: 'legacy', workspace: null }); // already admitted legacy job
  await job(35, { frozen: { type: 'user', id: 'already-frozen' } });
  await db.exec(
    readFileSync(
      `${cwd}/prisma/migrations/20260913090000_unify_workspaces/migration.sql`,
      'utf8',
    ),
  );
  assert.deepEqual(
    (await db.query('SELECT * FROM wallet_accounts ORDER BY id')).rows,
    walletsBefore,
    'No balance, hold or wallet identity may change',
  );
  assert.deepEqual(
    (
      await db.query('SELECT default_for_user_id FROM workspaces ORDER BY id')
    ).rows.map((row) => row.default_for_user_id),
    ['alice', 'bob', null],
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT billing_subject_type AS type, billing_subject_id AS id FROM ai_jobs ORDER BY ai_jobs.id',
      )
    ).rows,
    [
      { type: 'workspace', id: id(2) },
      { type: 'workspace', id: id(3) },
      { type: 'workspace', id: id(2) },
      { type: 'workspace', id: id(1) },
      { type: 'user', id: 'legacy' },
      { type: 'user', id: 'already-frozen' },
    ],
  );
  await assert.rejects(
    db.query('UPDATE workspaces SET default_for_user_id=$1 WHERE id=$2', [
      'alice',
      id(3),
    ]),
    /unique/i,
  );
  const retired = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE (table_name='workspaces' AND column_name='type') OR (table_name='story_projects' AND column_name IN ('billing_mode','billing_account_id'))`,
  );
  assert.equal(retired.rows.length, 0);
  console.log(
    'Workspace cutover passed: default identities, wallet preservation, six historical payer cases, uniqueness and retired columns.',
  );
} finally {
  await db.close();
  rmSync(temporary, { recursive: true, force: true });
}
