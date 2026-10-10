import { Client } from 'pg';
import { BillingService } from './billing.service';
const url = process.env.DELIVERY_TEST_DATABASE_URL;
(url ? it : it.skip)(
  'paginates all project and workspace details without changing totals',
  async () => {
    const parsed = new URL(url!);
    if (
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== '55443' ||
      parsed.pathname !== '/postgres'
    )
      throw new Error('Owned local fixture required');
    const db = new Client({ connectionString: url });
    await db.connect();
    try {
      await db.query(`CREATE TEMP TABLE workspaces(id uuid,name text,deleted_at timestamptz,default_for_user_id text);
  CREATE TEMP TABLE wallet_accounts(id text,owner_id text,owner_type text,currency text,balance_kind text);
  CREATE TEMP TABLE wallet_transactions(id text,project_id uuid,status text,source_type text,source_id text);
  CREATE TEMP TABLE wallet_ledger_entries(account_id text,transaction_id text,amount bigint,entry_type text,created_at timestamptz);
  CREATE TEMP TABLE ai_jobs(id uuid,type text);
  CREATE TEMP TABLE platform_projects(id uuid,name text,deleted_at timestamptz);
  INSERT INTO workspaces VALUES ('00000000-0000-4000-8000-000000000001','fixture',NULL,NULL);
  INSERT INTO wallet_accounts VALUES ('a','00000000-0000-4000-8000-000000000001','workspace','compute_point','consumable');
  INSERT INTO wallet_transactions SELECT n::text,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'posted','fixture',n::text FROM generate_series(1,41) n;
  INSERT INTO wallet_ledger_entries SELECT 'a',n::text,n,'debit',NOW() FROM generate_series(1,41) n;`);
      const prisma = {
        $queryRaw: async (q: any) => (await db.query(q.text, q.values)).rows,
        workspace: {
          findMany: async () => [
            {
              id: '00000000-0000-4000-8000-000000000001',
              name: 'fixture',
              defaultForUserId: null,
              status: 'active',
            },
          ],
        },
        platformProject: { findMany: async () => [] },
      };
      const s = new BillingService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const r = await s.listAdminComputeProjectUsage({
        days: 30,
        workspaceKind: 'all',
        sort: 'credits',
        limit: 100,
      });
      expect(r.projectCount).toBe(41);
      expect(r.workspaces[0].projectCount).toBe(41);
      expect(r.workspaces[0].projects).toHaveLength(40);
      expect(r.workspaces[0].nextProjectOffset).toBe(40);
      const second = await s.listAdminComputeProjectUsage({
        days: 30,
        workspaceKind: 'all',
        sort: 'credits',
        limit: 100,
        workspaceId: '00000000-0000-4000-8000-000000000001',
        projectOffset: 40,
      });
      expect(second.workspaces[0].projects).toHaveLength(1);
      expect(second.workspaces[0].nextProjectOffset).toBeNull();
      expect(second.totalCredits).toBe(r.totalCredits);
      expect(
        new Set(
          [...r.workspaces[0].projects, ...second.workspaces[0].projects].map(
            (p) => p.projectId,
          ),
        ).size,
      ).toBe(41);
      await db.query(`INSERT INTO workspaces VALUES ('00000000-0000-4000-8000-000000000002','other',NULL,NULL);
   INSERT INTO wallet_accounts VALUES ('b','00000000-0000-4000-8000-000000000002','workspace','compute_point','consumable');
   INSERT INTO wallet_ledger_entries VALUES ('b','1',1,'debit',NOW());`);
      const firstWorkspace = await s.listAdminComputeProjectUsage({
        days: 30,
        workspaceKind: 'all',
        sort: 'credits',
        limit: 1,
      });
      expect(firstWorkspace.nextWorkspaceOffset).toBe(1);
      const secondWorkspace = await s.listAdminComputeProjectUsage({
        days: 30,
        workspaceKind: 'all',
        sort: 'credits',
        limit: 1,
        workspaceOffset: 1,
      });
      expect(secondWorkspace.nextWorkspaceOffset).toBeNull();
      expect(secondWorkspace.workspaces[0].workspaceId).not.toBe(
        firstWorkspace.workspaces[0].workspaceId,
      );
      expect(secondWorkspace.totalCredits).toBe(firstWorkspace.totalCredits);
    } finally {
      await db.end();
    }
  },
);
