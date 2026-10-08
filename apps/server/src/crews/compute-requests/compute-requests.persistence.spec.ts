import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

describe('Crew compute request migration', () => {
  let db: import('@electric-sql/pglite').PGlite;
  const task = '01994bd8-0000-7000-8000-000000000001';
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(
      `CREATE TABLE crew_tasks (id uuid, crew_id text, UNIQUE(id, crew_id)); INSERT INTO crew_tasks VALUES ('${task}', 'crew');`,
    );
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../prisma/migrations/20260928160000_crew_compute_requests/migration.sql',
        ),
        'utf8',
      ),
    );
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../prisma/migrations/20260928173000_crew_compute_admin_review/migration.sql',
        ),
        'utf8',
      ),
    );
    await db.exec(
      readFileSync(
        resolve(
          __dirname,
          '../../../prisma/migrations/20261009001000_compute_request_owner/migration.sql',
        ),
        'utf8',
      ),
    );
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec('DELETE FROM crew_compute_requests');
  });
  const insert = (crew = 'crew', points = 50) =>
    db.query(
      `INSERT INTO crew_compute_requests (id, crew_id, task_id, workspace_id, user_id, task_title, points, reason, request_key) VALUES ('01994bd8-0000-7000-8000-000000000002', $1, $2, '01994bd8-0000-7000-8000-000000000003', 'creator', 'Shot', $3, 'Render', '01994bd8-0000-7000-8000-000000000004')`,
      [crew, task, points],
    );
  it('stores the requesting owner separately from the allowance recipient', async () => {
    await insert();
    await db.exec(
      "UPDATE crew_compute_requests SET requested_by_user_id = 'owner'",
    );
    expect(
      (
        await db.query(
          'SELECT user_id, requested_by_user_id FROM crew_compute_requests',
        )
      ).rows,
    ).toEqual([{ user_id: 'creator', requested_by_user_id: 'owner' }]);
  });
  it('rejects cross-Crew task references and invalid amounts', async () => {
    await expect(insert('other')).rejects.toThrow();
    await expect(insert('crew', 0)).rejects.toThrow();
  });
  it('retains requests when task deletion is attempted', async () => {
    await insert();
    await expect(
      db.query('DELETE FROM crew_tasks WHERE id = $1', [task]),
    ).rejects.toThrow();
    expect(
      (await db.query('SELECT points FROM crew_compute_requests')).rows,
    ).toEqual([{ points: 50 }]);
  });
  it('requires a decision actor and timestamp and rejects duplicate keys', async () => {
    await insert();
    await expect(
      db.exec("UPDATE crew_compute_requests SET status = 'approved'"),
    ).rejects.toThrow();
    await db.exec(
      "UPDATE crew_compute_requests SET status = 'approved', decided_by_user_id = 'owner', decided_at = CURRENT_TIMESTAMP",
    );
    await expect(
      db.exec(
        "INSERT INTO crew_compute_requests SELECT '01994bd8-0000-7000-8000-000000000005', crew_id, task_id, workspace_id, user_id, task_title, points, reason, status, decided_by_user_id, decision_note, decided_at, created_at, request_key, NULL FROM crew_compute_requests",
      ),
    ).rejects.toThrow();
  });
  it('stores Admin decisions separately and rejects ambiguous actors', async () => {
    await insert();
    await db.exec(
      "UPDATE crew_compute_requests SET status = 'approved', decided_by_admin_id = '01994bd8-0000-7000-8000-000000000006', decided_at = CURRENT_TIMESTAMP",
    );
    expect(
      (await db.query('SELECT decided_by_user_id FROM crew_compute_requests'))
        .rows,
    ).toEqual([{ decided_by_user_id: null }]);
    await expect(
      db.exec("UPDATE crew_compute_requests SET decided_by_user_id = 'owner'"),
    ).rejects.toThrow();
    await expect(
      db.exec("UPDATE crew_compute_requests SET status = 'pending'"),
    ).rejects.toThrow();
  });
});
