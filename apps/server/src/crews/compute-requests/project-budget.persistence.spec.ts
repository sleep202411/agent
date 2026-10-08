import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
it('migrates without rewriting prior payments, retains foreign keys, and permits a fully documented zero-net payment', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE crews(id text PRIMARY KEY, workspace_id uuid); CREATE TABLE workspaces(id uuid PRIMARY KEY);
   CREATE TABLE task_payment_releases(id text PRIMARY KEY,amount_minor bigint NOT NULL CHECK(amount_minor>0));
   INSERT INTO task_payment_releases VALUES('old',100);`);
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../prisma/migrations/20261008110000_project_compute_budgets/migration.sql',
        ),
        'utf8',
      ),
    );
    expect(
      (
        await db.query<{ deduction_minor: number }>(
          'SELECT deduction_minor FROM task_payment_releases',
        )
      ).rows[0].deduction_minor,
    ).toBe(0);
    await db.exec("INSERT INTO task_payment_releases VALUES('net-zero',0,100)");
    await expect(
      db.exec("INSERT INTO task_payment_releases VALUES('invalid',0,0)"),
    ).rejects.toThrow();
    await expect(
      db.exec("INSERT INTO task_payment_releases VALUES('negative',100,-1)"),
    ).rejects.toThrow();
    await db.exec(
      `INSERT INTO workspaces VALUES('11111111-1111-4111-8111-111111111111'); INSERT INTO crews VALUES('crew','11111111-1111-4111-8111-111111111111'); INSERT INTO crew_project_compute_budgets VALUES('crew','11111111-1111-4111-8111-111111111111',1,'{}');`,
    );
    await expect(
      db.exec("UPDATE crews SET workspace_id=NULL WHERE id='crew'"),
    ).rejects.toThrow('pins');
    await expect(
      db.exec(
        `INSERT INTO crew_project_compute_budgets VALUES ('unknown','11111111-1111-4111-8111-111111111111',1,'{}')`,
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);
