import { Prisma } from '@prisma/client';
import { requireNoTaskContractReferences } from './task-contract-retention';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

describe('Task contract retention query', () => {
  let db: import('@electric-sql/pglite').PGlite;
  const tx = {
    $queryRaw: async (query: Prisma.Sql) =>
      (await db.query(query.text, query.values)).rows,
  } as unknown as Prisma.TransactionClient;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`CREATE TABLE crew_tasks (
      id text, crew_id text, metadata jsonb, deleted_at timestamptz
    );
    INSERT INTO crew_tasks VALUES
      ('archived','crew','{"contractAssetNodeId":"contract"}',now()),
      ('foreign','other','{"contractAssetNodeId":"foreign-file"}',null),
      ('empty','crew','{}',null);`);
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  it('retains a contract referenced by an archived task inside a folder subtree', async () => {
    await expect(
      requireNoTaskContractReferences(tx, 'crew', ['folder', 'contract']),
    ).rejects.toMatchObject({
      response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
    });
  });
  it('allows unrelated files and ignores references from a different Crew', async () => {
    await expect(
      requireNoTaskContractReferences(tx, 'crew', ['foreign-file', 'unused']),
    ).resolves.toBeUndefined();
  });
  it('allows an empty subtree without producing invalid SQL', async () => {
    await expect(
      requireNoTaskContractReferences(tx, 'crew', []),
    ).resolves.toBeUndefined();
  });
});
