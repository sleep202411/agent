import { taskComputeUsage } from './task-compute-usage';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
it('separates people/tasks and excludes personal-wallet spending while retaining holds and releases', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE crews(id text,workspace_id uuid);
      CREATE TABLE crew_tasks(id text,crew_id text,title text,number int,canvas_project_id text);
      CREATE TABLE crew_task_assignees(task_id text,user_id text);
      CREATE TABLE crew_compute_requests(task_id text,user_id text,crew_id text,points int,status text);
      CREATE TABLE wallet_accounts(id text,owner_type text,owner_id text);
      CREATE TABLE wallet_transactions(id text,project_id text,source_type text,actor_user_id text);
      CREATE TABLE wallet_ledger_entries(transaction_id text,account_id text,currency text,entry_type text,amount bigint,available_delta bigint);
      INSERT INTO crews VALUES('crew','11111111-1111-4111-8111-111111111111');
      INSERT INTO crew_tasks VALUES('t1','crew','Shot 1',1,'p1'),('t2','crew','Shot 2',2,'p2');
      INSERT INTO crew_task_assignees VALUES('t1','a'),('t1','b'),('t2','a');
      INSERT INTO crew_compute_requests VALUES('t1','a','crew',100,'approved'),('t1','a','crew',20,'pending');
      INSERT INTO wallet_accounts VALUES('w','workspace','11111111-1111-4111-8111-111111111111'),('personal','user','a');
      INSERT INTO wallet_transactions VALUES('x','p1','ai_job','a'),('y','p1','ai_job','b'),('z','p2','ai_job','a');
      INSERT INTO wallet_ledger_entries VALUES
      ('x','w','compute_point','hold',30,-30),('x','w','compute_point','settle',20,0),('x','w','compute_point','release',10,10),
      ('x','personal','compute_point','settle',999,-999),('y','w','compute_point','hold',5,-5),('z','w','compute_point','settle',7,-7);
    `);
    const tx = {
      $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) =>
        (
          await db.query(
            parts.reduce((sql, part, i) => sql + (i ? '$' + i : '') + part, ''),
            values,
          )
        ).rows,
    };
    const owner = await taskComputeUsage(tx as never, 'crew', 'owner', true);
    expect(owner).toHaveLength(3);
    expect(owner[0]).toMatchObject({
      taskId: 't1',
      userId: 'a',
      approvedPoints: '100',
      pendingPoints: '20',
      consumedPoints: '20',
      committedPoints: '20',
    });
    expect(owner[1]).toMatchObject({
      userId: 'b',
      consumedPoints: '0',
      committedPoints: '5',
    });
    const member = await taskComputeUsage(tx as never, 'crew', 'a', false);
    expect(member).toHaveLength(2);
    expect(member.every((r) => r.userId === 'a')).toBe(true);
  } finally {
    await db.close();
  }
}, 30000);
