import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { encodeUserId } from '@repo/shared';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { BillingService } from './billing.service';

const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration('Compute member usage rollup (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let workspaces: string[];
  let accounts: string[];
  let transactions: string[];
  let actor: string;
  const service = (contactUserId?: string) =>
    new BillingService(
      db as never,
      {} as never,
      new WorkspacePermissionService(db as never),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findUsersByIds: (ids: string[]) =>
          Promise.resolve(
            contactUserId && ids.includes(encodeUserId(contactUserId))
              ? [
                  {
                    userId: encodeUserId(contactUserId),
                    nickName: 'Correct member',
                  },
                ]
              : [],
          ),
        findUser: () =>
          Promise.resolve(contactUserId ? { userId: contactUserId } : null),
      } as never,
    );
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
      }),
    });
    await db.$connect();
  });
  beforeEach(() => {
    workspaces = [];
    accounts = [];
    transactions = [];
    actor = randomUUID();
  });
  afterEach(async () => {
    await db.walletTransaction.deleteMany({
      where: { id: { in: transactions } },
    });
    await db.walletAccount.deleteMany({ where: { id: { in: accounts } } });
    await db.platformProject.deleteMany({
      where: { workspaceId: { in: workspaces } },
    });
    await db.workspace.deleteMany({ where: { id: { in: workspaces } } });
  });
  afterAll(async () => db?.$disconnect());
  async function workspace(personal = false) {
    const row = await db.workspace.create({
      data: {
        name: 'Fixture',
        ownerUserId: actor,
        createdById: actor,
        ...(personal ? { defaultForUserId: actor } : {}),
      },
    });
    workspaces.push(row.id);
    const account = await db.walletAccount.create({
      data: {
        ownerType: 'workspace',
        ownerId: row.id,
        currency: 'compute_point',
        balanceKind: 'consumable',
      },
    });
    accounts.push(account.id);
    return { id: row.id, accountId: account.id };
  }
  async function debit(
    accountId: string,
    amount: bigint,
    userId: string | null = actor,
    voided = false,
  ) {
    const tx = await db.walletTransaction.create({
      data: {
        sourceType: 'fixture',
        idempotencyKey: randomUUID(),
        actorUserId: userId,
        ...(voided ? { status: 'voided', voidedAt: new Date() } : {}),
        entries: {
          create: {
            accountId,
            entryType: 'debit',
            currency: 'compute_point',
            balanceKind: 'consumable',
            amount,
            availableDelta: -amount,
            heldDelta: 0n,
            availableBalanceAfter: 0n,
            heldBalanceAfter: 0n,
            reason: 'fixture',
          },
        },
      },
    });
    transactions.push(tx.id);
    return tx.id;
  }
  it('uses the raw contact lookup identity without decoding it again', async () => {
    actor = '273848';
    const ws = await workspace();
    await debit(ws.accountId, 20n, actor);
    await debit(ws.accountId, 99n, '18424');
    const result = await service(actor).listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'all',
      workspaceId: ws.id,
      userQuery: '13800138000',
      limit: 100,
    });
    expect(result.totalCredits).toBe('20');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].userId).toBe(encodeUserId(actor));
    expect(result.members[0].nickName).toBe('Correct member');
  });
  it('filters workspace names literally and includes official image/video counts', async () => {
    const ws = await workspace();
    const needle = `Fixture_%_${actor}`;
    await db.workspace.update({ where: { id: ws.id }, data: { name: needle } });
    const jobs: string[] = [];
    try {
      for (const type of ['image', 'video'] as const) {
        const id = randomUUID();
        await db.aiJob.create({
          data: {
            id,
            userId: actor,
            type,
            provider: 'fixture',
            modelId: 'fixture',
            deployment: 'fixture',
            schemaVersion: '1',
            status: 'completed',
            stage: 'completed',
            queueName: 'fixture',
            prompt: '',
            idempotencyKey: id,
            input: {},
            normalizedInput: {},
            logs: [],
            metrics: {},
          },
        });
        jobs.push(id);
        const transactionId = await debit(ws.accountId, 2n);
        await db.walletTransaction.update({
          where: { id: transactionId },
          data: { sourceType: 'ai_job', sourceId: id },
        });
      }
      const other = await workspace();
      await db.workspace.update({
        where: { id: other.id },
        data: { name: needle.replace('_%_', 'xxx') },
      });
      await debit(other.accountId, 100n);
      const result = await service().listAdminComputeMemberUsage({
        days: 30,
        workspaceKind: 'all',
        workspaceQuery: needle,
        limit: 1,
      });
      expect(result.totalCredits).toBe('4');
      expect(result.members[0]).toMatchObject({
        totalJobs: 2,
        totalImageJobs: 1,
        totalVideoJobs: 1,
      });
      expect(result.members[0].workspaces[0]).toMatchObject({
        imageJobs: 1,
        videoJobs: 1,
      });
    } finally {
      await db.aiJob.deleteMany({ where: { id: { in: jobs } } });
    }
  });
  it('joins text wallet owners to UUID workspaces and preserves sums beyond signed bigint', async () => {
    const ws = await workspace();
    await debit(ws.accountId, 9_000_000_000_000_000_000n);
    await debit(ws.accountId, 9_000_000_000_000_000_000n);
    const result = await service().listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'all',
      workspaceId: ws.id,
      limit: 1,
    });
    expect(result.totalCredits).toBe('18000000000000000000');
    expect(result.members[0].totalCredits).toBe(result.totalCredits);
    expect(result.members[0].workspaces[0].credits).toBe(result.totalCredits);
  });
  it('keeps global totals independent of the displayed member limit', async () => {
    const ws = await workspace();
    await debit(ws.accountId, 12n);
    const other = randomUUID();
    await debit(ws.accountId, 8n, other);
    const result = await service().listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'all',
      workspaceId: ws.id,
      limit: 1,
    });
    expect(result).toMatchObject({
      totalCredits: '20',
      memberCount: 2,
      workspaceCount: 1,
    });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toMatchObject({
      userId: encodeUserId(actor),
      totalCredits: '12',
    });
  });
  it('keeps member totals complete when workspace details are capped', async () => {
    for (let i = 0; i < 25; i++) {
      const ws = await workspace();
      await debit(ws.accountId, 1n);
    }
    const result = await service().listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'all',
      userId: actor,
      limit: 1,
    });
    expect(result).toMatchObject({
      totalCredits: '25',
      memberCount: 1,
      workspaceCount: 25,
    });
    expect(result.members[0]).toMatchObject({
      totalCredits: '25',
      totalJobs: 25,
    });
    expect(result.members[0].workspaces).toHaveLength(20);
  });
  it('excludes voided movements and applies workspace-kind filters', async () => {
    const ws = await workspace(true);
    await debit(ws.accountId, 3n);
    await debit(ws.accountId, 50n, actor, true);
    const personal = await service().listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'personal',
      workspaceId: ws.id,
      limit: 10,
    });
    expect(personal.totalCredits).toBe('3');
    const shared = await service().listAdminComputeMemberUsage({
      days: 30,
      workspaceKind: 'shared',
      workspaceId: ws.id,
      limit: 10,
    });
    expect(shared).toMatchObject({
      totalCredits: '0',
      memberCount: 0,
      workspaceCount: 0,
      members: [],
    });
  });
  it('keeps workspace usage exact and excludes voided transactions', async () => {
    const ws = await workspace();
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: actor, role: 'admin' },
    });
    await debit(ws.accountId, 9_000_000_000_000_000_000n);
    await debit(ws.accountId, 9_000_000_000_000_000_000n);
    await debit(ws.accountId, 10n, actor, true);
    const result = await service().walletMemberUsage(
      { userId: actor },
      { days: 30 },
      ws.id,
    );
    expect(result.members).toHaveLength(1);
    const daily = await service().walletDailyUsage(
      { userId: actor },
      { days: 30, currency: 'compute_point', balanceKind: 'consumable' },
      ws.id,
    );
    expect(daily.days).toHaveLength(1);
    expect(daily.days[0].credits).toBe('18000000000000000000');
    expect(result.members[0]).toMatchObject({
      totalCredits: '18000000000000000000',
      totalJobs: 2,
    });
  });
  it('retains project attribution without disclosing names outside the workspace', async () => {
    const ws = await workspace();
    const other = await workspace();
    await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: actor, role: 'admin' },
    });
    const project = await db.platformProject.create({
      data: { workspaceId: ws.id, name: 'Original', createdById: actor },
    });
    await debit(ws.accountId, 5n);
    await db.walletTransaction.update({
      where: { id: transactions[0] },
      data: { projectId: project.id },
    });
    const read = () =>
      service().walletMemberUsage(
        { userId: actor },
        { days: 30, projectId: project.id },
        ws.id,
      );
    expect((await read()).members[0].projects[0].projectName).toBe('Original');
    await db.platformProject.update({
      where: { id: project.id },
      data: { workspaceId: other.id, name: 'Private destination' },
    });
    expect((await read()).members[0].projects[0]).toMatchObject({
      projectId: project.id,
      projectName: null,
      credits: '5',
    });
    await db.platformProject.update({
      where: { id: project.id },
      data: { workspaceId: ws.id, deletedAt: new Date() },
    });
    expect((await read()).members[0].projects[0].projectName).toBeNull();
  });
  it('denies workspace usage to viewers, project-only admins and removed memberships', async () => {
    const ws = await workspace();
    const membership = await db.workspaceMember.create({
      data: { workspaceId: ws.id, userId: actor, role: 'viewer' },
    });
    const read = () =>
      service().walletMemberUsage({ userId: actor }, { days: 30 }, ws.id);
    await expect(read()).rejects.toThrow();
    await db.workspaceMember.update({
      where: { id: membership.id },
      data: { role: 'admin', accessScope: 'project_only' },
    });
    await expect(read()).rejects.toThrow();
    await db.workspaceMember.update({
      where: { id: membership.id },
      data: {
        accessScope: 'workspace',
        status: 'removed',
        removedAt: new Date(),
      },
    });
    await expect(read()).rejects.toThrow();
    await expect(
      service().walletMemberUsage({ userId: actor }, { days: 30 }),
    ).rejects.toThrow();
  });
  it('rolls project spend up by workspace and keeps unassigned jobs', async () => {
    const shared = await workspace();
    const personal = await workspace(true);
    const film = await db.platformProject.create({
      data: { workspaceId: shared.id, name: 'Pilot', createdById: actor },
    });
    const extra = await db.platformProject.create({
      data: { workspaceId: shared.id, name: 'B-roll', createdById: actor },
    });
    const filmTx = await debit(shared.accountId, 40n);
    const extraTx = await debit(shared.accountId, 10n);
    await debit(shared.accountId, 5n);
    await debit(personal.accountId, 7n);
    await db.walletTransaction.update({
      where: { id: filmTx },
      data: { projectId: film.id },
    });
    await db.walletTransaction.update({
      where: { id: extraTx },
      data: { projectId: extra.id },
    });
    const sharedUsage = await service().listAdminComputeProjectUsage({
      days: 30,
      workspaceKind: 'all',
      sort: 'credits',
      workspaceId: shared.id,
      limit: 20,
    });
    expect(sharedUsage).toMatchObject({
      totalCredits: '55',
      workspaceCount: 1,
      projectCount: 3,
    });
    expect(sharedUsage.workspaces[0]).toMatchObject({
      workspaceId: shared.id,
      isPersonal: false,
      totalCredits: '55',
      projectCount: 3,
    });
    expect(sharedUsage.workspaces[0].projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: film.id,
          projectName: 'Pilot',
          credits: '40',
        }),
        expect.objectContaining({
          projectId: extra.id,
          projectName: 'B-roll',
          credits: '10',
        }),
        expect.objectContaining({ projectId: null, credits: '5' }),
      ]),
    );
    const personalUsage = await service().listAdminComputeProjectUsage({
      days: 30,
      workspaceKind: 'personal',
      sort: 'credits',
      workspaceId: personal.id,
      limit: 20,
    });
    expect(personalUsage).toMatchObject({
      totalCredits: '7',
      workspaceCount: 1,
    });
    const named = await service().listAdminComputeProjectUsage({
      days: 30,
      workspaceKind: 'shared',
      sort: 'credits',
      workspaceId: shared.id,
      projectQuery: 'Pilot',
      limit: 20,
    });
    expect(named).toMatchObject({
      totalCredits: '40',
      workspaceCount: 1,
      projectCount: 1,
    });
    expect(named.workspaces[0].projects).toEqual([
      expect.objectContaining({ projectId: film.id, projectName: 'Pilot' }),
    ]);
  });
});
