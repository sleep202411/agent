import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewComputeRequestsService } from './compute-requests.service';
import { WalletLedgerService } from '../../workspaces/wallet-ledger.service';
import type { AdminActor } from '../../admin-auth';
import { projectPointsSummary } from './project-points-summary';
const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Task top-up atomic approval on owned PostgreSQL',
  () => {
    let db: PrismaClient, service: CrewComputeRequestsService, walletId: string;
    const crewId = randomUUID(),
      workspaceId = randomUUID(),
      owner = randomUUID(),
      creator = randomUUID();
    const admin = {
      id: randomUUID(),
      sessionId: randomUUID(),
      status: 'active',
      siteScope: 'all',
      permissions: ['crew.compute.review'],
      roleKeys: [],
      email: 'topup@fixture.invalid',
      displayName: 'Top-up fixture',
      requireMfa: false,
    } as AdminActor;
    let taskId: string;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw Error('Owned task01 fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 15000 },
      });
      await db.adminUser.create({
        data: {
          id: admin.id,
          email: `${admin.id}@fixture.invalid`,
          displayName: 'Fixture admin',
          passwordHash: 'non-authenticatable-test-fixture',
          status: 'active',
        },
      });
      await db.adminSession.create({
        data: {
          id: admin.sessionId,
          userId: admin.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const ledger = new WalletLedgerService(db as never);
      service = new CrewComputeRequestsService(
        db as never,
        new CrewAuthorizationService(db as never),
        {} as never,
        ledger,
      );
      await db.workspace.create({
        data: {
          id: workspaceId,
          name: 'Top-up fixture',
          ownerUserId: owner,
          createdById: owner,
        },
      });
      await db.crew.create({
        data: {
          id: crewId,
          name: `Top-up ${crewId}`,
          description: '',
          logo: 'test',
          createdByUserId: owner,
          workspaceId,
        },
      });
      const leader = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: owner,
          joinedVia: 'invitation',
        },
      });
      await db.crewOwnership.create({ data: { crewId, memberId: leader.id } });
      const member = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: creator,
          joinedVia: 'invitation',
        },
      });
      const state = await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          createdByUserId: owner,
        },
      });
      const task = await db.crewTask.create({
        data: {
          crewId,
          title: 'Top-up shot',
          number: 1,
          workflowStateId: state.id,
          taskKind: 'script',
          createdByUserId: owner,
        },
      });
      taskId = task.id;
      await db.crewTaskAssignee.create({
        data: {
          crewId,
          taskId,
          crewMemberId: member.id,
          userId: creator,
          currency: 'USD',
        },
      });
      walletId = (
        await ledger.ensureDefaultAccounts('workspace', workspaceId)
      )[0].id;
      const budget = {
        pointsPerMinute: 4460,
        durationSeconds: 60,
        totalPoints: '4460',
        producerTaskId: taskId,
        producerUserId: owner,
        stages: [
          {
            key: randomUUID(),
            points: 1000,
            note: 'Test',
            adminId: admin.id,
            at: new Date().toISOString(),
          },
        ],
        settlement: null,
      };
      await db.$executeRaw`INSERT INTO crew_project_compute_budgets(crew_id,workspace_id,version,data) VALUES(${crewId},${workspaceId}::uuid,1,${JSON.stringify(budget)}::jsonb)`;
    });
    afterAll(async () => {
      if (!db) return;
      try {
        await db.adminAuditLog.deleteMany({ where: { actorUserId: admin.id } });
        await db.crewComputeRequest.deleteMany({ where: { crewId } });
        await db.$executeRaw`DELETE FROM crew_project_compute_budgets WHERE crew_id=${crewId}`;
        await db.crewTaskAssignee.deleteMany({ where: { crewId } });
        await db.crew.deleteMany({ where: { id: crewId } });
        if (walletId) {
          await db.walletCreditAllocation.deleteMany({
            where: { grant: { accountId: walletId } },
          });
          await db.walletCreditGrant.deleteMany({
            where: { accountId: walletId },
          });
          await db.walletLedgerEntry.deleteMany({
            where: { accountId: walletId },
          });
          await db.walletTransaction.deleteMany({ where: { workspaceId } });
          await db.walletAccount.deleteMany({ where: { id: walletId } });
        }
        await db.workspace.deleteMany({ where: { id: workspaceId } });
        await db.adminUser.deleteMany({ where: { id: admin.id } });
      } finally {
        await db.$disconnect();
      }
    });
    it('serializes competing applications and credits an empty wallet once under concurrent approval', async () => {
      const input = {
        taskId,
        beneficiaryUserId: creator,
        points: 500,
        remainingWorkload: 10.5,
        workloadUnit: 'minutes' as const,
        reason: 'Finish shots',
        requestKey: randomUUID(),
      };
      const results = await Promise.allSettled([
        service.create(crewId, owner, input),
        service.create(crewId, owner, { ...input, requestKey: randomUUID() }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const row = await db.crewComputeRequest.findFirstOrThrow({
        where: { crewId },
      });
      const replay = await service.create(crewId, owner, {
        ...input,
        requestKey: row.requestKey,
      });
      expect(replay.id).toBe(row.id);
      await expect(
        service.decideAdmin(
          crewId,
          row.id,
          { ...admin, id: randomUUID() },
          { status: 'approved', note: 'Forced audit failure' },
        ),
      ).rejects.toThrow();
      expect(
        (await db.walletAccount.findUniqueOrThrow({ where: { id: walletId } }))
          .availableBalance,
      ).toBe(0n);
      expect(
        (
          await db.crewComputeRequest.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe('pending');
      expect(
        await db.walletTransaction.count({
          where: { sourceType: 'crew_compute_topup', sourceId: row.id },
        }),
      ).toBe(0);
      await Promise.all([
        service.decideAdmin(crewId, row.id, admin, {
          status: 'approved',
          note: 'Reviewed',
        }),
        service.decideAdmin(crewId, row.id, admin, {
          status: 'approved',
          note: 'Reviewed',
        }),
      ]);
      expect(
        (await db.walletAccount.findUniqueOrThrow({ where: { id: walletId } }))
          .availableBalance,
      ).toBe(500n);
      expect(
        await db.walletTransaction.count({
          where: { sourceType: 'crew_compute_topup', sourceId: row.id },
        }),
      ).toBe(1);
      expect(
        await db.walletCreditGrant.count({
          where: {
            accountId: walletId,
            availableAmount: 500n,
            grantType: 'admin_adjustment',
          },
        }),
      ).toBe(1);
      expect(
        await db.adminAuditLog.count({ where: { actorUserId: admin.id } }),
      ).toBe(1);
      const summary = await projectPointsSummary(db, { search: crewId });
      expect(summary.items).toHaveLength(1);
      expect(summary.items[0]).toMatchObject({
        calculatedPoints: '4460',
        appliedPoints: '500',
        creditedPoints: '500',
        differencePoints: '-3960',
        warning: true,
      });
    });
    it('rolls back wallet and approval together when the enclosing audit write fails', async () => {
      // Reuse the fixture in a separate transaction that deliberately cannot commit.
      const ledger = new WalletLedgerService(db as never);
      const before = await db.walletAccount.findUniqueOrThrow({
        where: { id: walletId },
      });
      const key = `rollback:${randomUUID()}`;
      await expect(
        db.$transaction(async (tx) => {
          await ledger.postEntryTx(tx, {
            accountId: walletId,
            entryType: 'adjustment',
            amount: 50n,
            availableDelta: 50n,
            heldDelta: 0n,
            sourceType: 'crew_compute_topup',
            idempotencyKey: key,
            reason: 'Rollback test',
            creditGrant: { grantType: 'admin_adjustment' },
          });
          throw Error('audit failure');
        }),
      ).rejects.toThrow('audit failure');
      expect(
        (await db.walletAccount.findUniqueOrThrow({ where: { id: walletId } }))
          .availableBalance,
      ).toBe(before.availableBalance);
      expect(
        await db.walletTransaction.count({ where: { idempotencyKey: key } }),
      ).toBe(0);
    });
  },
);
