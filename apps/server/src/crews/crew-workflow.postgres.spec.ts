import { CrewApplicationAmendmentsService } from './application-amendments';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { CrewTaskFeedbackAppealsService } from './accountability/task-feedback-appeals';
import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { CrewTaskOverdueWorker } from './tasks/task-overdue.worker';
import { NotificationService } from '../notification';
import { ListCrewTasksQuerySchema } from './tasks/project-dto';
import { defaultCrewTaskView } from './tasks/task-defaults';
import type {
  CreateUploadUrlInput,
  CreateUploadUrlResult,
  CreateReadUrlInput,
  CreateReadUrlResult,
} from '../infra/storage/storage.types';
import {
  CrewDisputeAttachmentsService,
  DisputeUpload,
} from './tasks/dispute-attachments';
import { CrewTaskDisputesService } from './tasks/task-disputes';
import { ADMIN_PERMISSION_KEYS, type AdminActor } from '../admin-auth';
import {
  CrewTaskExtensionsService,
  ExtensionRequestInput,
} from './tasks/task-extensions';
import { CrewApplicationInterviewsService } from './application-interviews';
import { CrewPositionInvitationsService } from './position-invitations';
import { CrewQualificationsService } from './crew-qualifications.service';
import { PositionsService } from './positions.service';
import {
  CreatePositionSchema,
  ListPublicPositionsQuerySchema,
  UpdateCrewTaskSchema,
} from './dto';
import {
  ApplicationTermsInput,
  CrewApplicationTermsService,
} from './application-terms';
import { crewCurrency } from './earnings/ledger-currency';
import { CrewTaskFeedbackService } from './accountability/task-feedback';
import { CrewStudioWorkspaceService } from './production/studio-workspace.service';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { CrewTrustAppealService } from './tasks/trust-appeals';
import { CreatorTrustController } from '../ip-commerce/creator-trust.controller';
import { postApprovedTaskTrustTx } from './tasks/task-timeliness';
import { randomUUID } from 'node:crypto';
import { PrismaClient, CrewMembershipStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConversationsService } from '../conversations/conversations.service';
import { CrewAuthorizationService } from './crew-authorization.service';
import { CrewCollaborationService } from './collaboration/crew-collaboration.service';
import { CrewAssetAccessService } from './assets/asset-access.service';
import { CrewAssetsService } from './assets/assets.service';
import { ApplicationsService } from './applications.service';
import { MembersService } from './members.service';
import { CrewsService } from './crews.service';
import { CrewTasksService } from './tasks/tasks.service';
import { CrewEarningsService } from './earnings/earnings.service';
import { CrewPayoutsService } from './earnings/payouts.service';
import { joinCrewInTransaction } from './invitations/join-crew';
import { CreateCrewTaskSchema } from './dto';

const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Crew operational lifecycle on isolated PostgreSQL',
  () => {
    let db: PrismaClient;
    let authorization: CrewAuthorizationService;
    let collaboration: CrewCollaborationService;
    let conversations: ConversationsService;
    let members: MembersService;
    let crews: CrewsService;
    let applications: ApplicationsService;
    let assets: CrewAssetsService;
    let access: CrewAssetAccessService;
    let tasks: CrewTasksService;
    let earnings: CrewEarningsService;
    let payouts: CrewPayoutsService;
    let crewId: string;
    let owner: string;
    let worker: string;
    let finance: string;
    let positionId: string;
    let workerMemberId: string;
    const notifications = { send: jest.fn().mockResolvedValue(undefined) };

    async function confirmFixtureOffer(applicationId: string) {
      const app = await db.crewApplication.findUniqueOrThrow({
        where: { id: applicationId },
      });
      const terms = new CrewApplicationTermsService(db as never, authorization);
      await terms.propose(applicationId, owner, {
        expectedVersion: 0,
        scope: 'Fixture work',
        feeAmount: '0',
        currency: crewCurrency(),
        feePeriod: 'project',
        revenueShareBp: 0,
        shareBasis: null,
      });
      await terms.confirm(applicationId, app.applicantId, 1);
    }
    beforeAll(() => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        !(
          (target.port === '55439' && target.pathname === '/task01') ||
          (target.port === '5433' &&
            target.pathname === '/fizzdragon_outbox_test')
        )
      ) {
        throw new Error(
          'Use an explicitly allowed local Crew fixture database.',
        );
      }
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 15000 },
      });
      authorization = new CrewAuthorizationService(db as never);
      conversations = new ConversationsService(
        db as never,
        {
          publishUserFrame: jest.fn().mockResolvedValue(undefined),
          publishCrewMessage: jest.fn().mockResolvedValue(undefined),
        } as never,
        notifications as never,
      );
      collaboration = new CrewCollaborationService(
        db as never,
        {
          ensureDefaultAccounts: jest.fn().mockResolvedValue(undefined),
        } as never,
        authorization,
      );
      access = new CrewAssetAccessService(db as never, authorization);
      assets = new CrewAssetsService(
        db as never,
        {} as never,
        authorization,
        access,
        {} as never,
        {} as never,
        conversations,
      );
      members = new MembersService(
        db as never,
        notifications as never,
        conversations,
        collaboration,
        authorization,

        { revoke: jest.fn().mockResolvedValue(undefined) } as never,
      );
      crews = new CrewsService(
        db as never,
        conversations,
        authorization,
        collaboration,
        { ensureDefaultAccounts: jest.fn().mockResolvedValue([]) } as never,

        { revoke: jest.fn().mockResolvedValue(undefined) } as never,
      );
      applications = new ApplicationsService(
        db as never,
        notifications as never,
        conversations,
        collaboration,
        authorization,
      );
      earnings = new CrewEarningsService(
        db as never,
        authorization,
        notifications as never,
      );
      payouts = new CrewPayoutsService(
        db as never,
        authorization,
        notifications as never,
      );
      tasks = new CrewTasksService(
        db as never,
        authorization,
        access,
        notifications as never,
        conversations,
        earnings,
      );
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    beforeEach(async () => {
      crewId = `workflow-${randomUUID()}`;
      owner = `owner-${randomUUID()}`;
      worker = `worker-${randomUUID()}`;
      finance = `finance-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Workflow fixture',
          description: '',
          logo: 'test.png',
          createdByUserId: owner,
        },
      });
      const ownerMember = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: owner,
          joinedVia: 'creation',
        },
      });
      await db.crewOwnership.create({
        data: { crewId, memberId: ownerMember.id },
      });
      await collaboration.ensureCrewSpace(crewId);
      await db.$transaction((tx) =>
        joinCrewInTransaction(
          tx,
          { conversations, collaboration },
          {
            crewId,
            userId: finance,
            policyKeys: ['finance'],
            grantedByUserId: owner,
            action: 'invitation.accepted',
          },
        ),
      );
      positionId = randomUUID();
      await db.crewPosition.create({
        data: {
          id: positionId,
          crewId,
          positionType: 'animator',
          description: 'Animation',
          targetCount: 1,
        },
      });
      const application = await db.crewApplication.create({
        data: { id: randomUUID(), crewId, positionId, applicantId: worker },
      });
      await confirmFixtureOffer(application.id);
      await applications.approve(application.id, owner);
      workerMemberId = (await authorization.requireMembership(crewId, worker))
        .memberId;
    });
    afterEach(async () => {
      notifications.send.mockReset().mockResolvedValue(undefined);
      await db.$executeRaw`DELETE FROM crew_trust_appeals WHERE task_id IN (SELECT id FROM crew_tasks WHERE crew_id=${crewId})`;
      await db.$executeRaw`DELETE FROM crew_creator_trust_entries WHERE task_id IN (SELECT id FROM crew_tasks WHERE crew_id=${crewId})`;
      // Posted ledger rows are deliberately immutable. Keep the unique fixtures
      // in this disposable test database rather than disabling audit triggers.
      await db.crew.updateMany({
        where: { id: crewId },
        data: { deletedAt: new Date() },
      });
    });

    describe('Cash balance reconciliation', () => {
      it('tracks reservations, gross paid allocations and voids independently of history filters', async () => {
        const currency = crewCurrency();
        const earning = await earnings.create(crewId, finance, {
          crewMemberId: workerMemberId,
          sourceType: 'adjustment',
          title: 'Cash balance',
          amountMinor: '1000',
          currency,
          idempotencyKey: 'cash-balance-test',
        });
        await earnings.approve(earning.id, finance, {
          expectedVersion: earning.version,
        });
        const paid = await payouts.create(crewId, finance, {
          crewMemberId: workerMemberId,
          currency,
          amountMinor: '300',
          withholdingAmountMinor: '50',
          idempotencyKey: 'cash-balance-paid',
        });
        await payouts.pay(paid.id, finance, {
          expectedVersion: paid.version,
          paymentMethod: 'bank_transfer',
          paymentReference: 'LOCAL-ONLY',
        });
        const pending = await payouts.create(crewId, finance, {
          crewMemberId: workerMemberId,
          currency,
          amountMinor: '200',
          withholdingAmountMinor: '0',
          idempotencyKey: 'cash-balance-pending',
        });
        const summary = {
          confirmedAmountMinor: '1000',
          paidAmountMinor: '300',
          reservedAmountMinor: '200',
          availableAmountMinor: '500',
        };
        expect(
          (
            await payouts.listMine(worker, {
              currency,
              limit: 1,
              status: 'paid',
            })
          ).summary,
        ).toMatchObject(summary);
        expect(
          (
            await payouts.list(crewId, finance, {
              currency,
              scope: 'crew',
              limit: 1,
            })
          ).summary,
        ).toMatchObject(summary);
        expect(
          (await payouts.listMine(finance, { currency, limit: 50 })).summary
            .availableAmountMinor,
        ).toBe('0');
        expect(
          (
            await payouts.listMine(worker, {
              currency: currency === 'USD' ? 'CNY' : 'USD',
              limit: 50,
            })
          ).summary.confirmedAmountMinor,
        ).toBe('0');
        await expect(
          payouts.list(crewId, worker, { currency, scope: 'crew', limit: 50 }),
        ).rejects.toThrow();
        await payouts.void(pending.id, finance, {
          expectedVersion: pending.version,
          reason: 'Cancelled local reservation',
        });
        expect(
          (await payouts.listMine(worker, { currency, limit: 50 })).summary,
        ).toMatchObject({
          ...summary,
          reservedAmountMinor: '0',
          availableAmountMinor: '700',
        });
        await members.remove(crewId, workerMemberId, owner);
        expect(
          (await payouts.listMine(worker, { currency, limit: 50 })).summary
            .availableAmountMinor,
        ).toBe('700');
      });

      it('filters a former contributor’s records and totals by Crew without exposing another beneficiary', async () => {
        const currency = crewCurrency();
        const otherCrew = `balance-${randomUUID()}`;
        const otherOwner = randomUUID();
        const otherMember = randomUUID();
        await db.crew.create({
          data: {
            id: otherCrew,
            name: 'Second cash project',
            description: '',
            logo: '',
            createdByUserId: finance,
          },
        });
        try {
          await db.crewMember.createMany({
            data: [
              {
                id: otherOwner,
                crewId: otherCrew,
                userId: finance,
                joinedVia: 'creation',
              },
              {
                id: otherMember,
                crewId: otherCrew,
                userId: worker,
                joinedVia: 'invitation',
              },
            ],
          });
          await db.crewOwnership.create({
            data: { crewId: otherCrew, memberId: otherOwner },
          });
          const records: Array<{
            earning: { id: string };
            payout: { id: string };
          }> = [];
          for (const [project, member, amount] of [
            [crewId, workerMemberId, '1000'],
            [otherCrew, otherMember, '2000'],
          ]) {
            const earning = await earnings.create(project, finance, {
              crewMemberId: member,
              currency,
              amountMinor: amount,
              sourceType: 'adjustment',
              title: 'Project income',
              idempotencyKey: 'project-income-filter',
            });
            await earnings.approve(earning.id, finance, {
              expectedVersion: earning.version,
            });
            const payout = await payouts.create(project, finance, {
              crewMemberId: member,
              currency,
              amountMinor: '100',
              withholdingAmountMinor: '0',
              idempotencyKey: 'project-payout-filter',
            });
            records.push({ earning, payout });
          }
          await members.remove(crewId, workerMemberId, owner);
          const own = await earnings.listMine(worker, {
            currency,
            crewId,
            limit: 50,
          });
          expect(own.items.map((row) => row.id)).toEqual([
            records[0].earning.id,
          ]);
          expect(own.summary.byStatus.posted.amountMinor).toBe('1000');
          const selected = await payouts.listMine(worker, {
            currency,
            crewId,
            limit: 50,
          });
          expect(selected.items.map((row) => row.id)).toEqual([
            records[0].payout.id,
          ]);
          expect(selected.summary).toMatchObject({
            confirmedAmountMinor: '1000',
            reservedAmountMinor: '100',
            availableAmountMinor: '900',
          });
          expect(
            (await payouts.listMine(worker, { currency, limit: 50 })).summary
              .availableAmountMinor,
          ).toBe('2800');
          expect(
            (await payouts.listMine(finance, { currency, crewId, limit: 50 }))
              .items,
          ).toEqual([]);
          expect(
            (await earnings.listMine(finance, { currency, crewId, limit: 50 }))
              .items,
          ).toEqual([]);
          await expect(
            earnings.listMine(worker, {
              currency,
              crewId,
              limit: 50,
              cursor: records[1].earning.id,
            }),
          ).rejects.toThrow();
          await expect(
            payouts.listMine(worker, {
              currency,
              crewId,
              limit: 50,
              cursor: records[1].payout.id,
            }),
          ).rejects.toThrow();
        } finally {
          await db.crew.update({
            where: { id: otherCrew },
            data: { deletedAt: new Date() },
          });
        }
      });

      it('keeps pending/rejected/reversed earnings out of available cash', async () => {
        const currency = crewCurrency();
        const input = {
          crewMemberId: workerMemberId,
          sourceType: 'adjustment' as const,
          title: 'Excluded cash',
          amountMinor: '999',
          currency,
        };
        const pending = await earnings.create(crewId, finance, {
          ...input,
          idempotencyKey: 'balance-pending',
        });
        expect(
          (await payouts.listMine(worker, { currency, limit: 50 })).summary
            .confirmedAmountMinor,
        ).toBe('0');
        await earnings.reject(pending.id, finance, {
          expectedVersion: pending.version,
          reason: 'Not earned',
        });
        const reverse = await earnings.create(crewId, finance, {
          ...input,
          idempotencyKey: 'balance-reversed',
        });
        const posted = await earnings.approve(reverse.id, finance, {
          expectedVersion: reverse.version,
        });
        await earnings.reverse(reverse.id, finance, {
          expectedVersion: posted.version,
          reason: 'Correction',
        });
        expect(
          (await payouts.listMine(worker, { currency, limit: 50 })).summary,
        ).toMatchObject({
          confirmedAmountMinor: '0',
          reservedAmountMinor: '0',
          paidAmountMinor: '0',
          availableAmountMinor: '0',
        });
      });
    });

    describe('Overdue task reminders', () => {
      const createOverdue = async () => {
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Overdue reminder fixture',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        // Model work that became overdue; creation correctly rejects past deadlines.
        await db.crewTask.update({
          where: { id: task.id },
          data: { dueAt: new Date(Date.now() - 86400000) },
        });
        return task;
      };
      const makeWorker = (sender = new NotificationService(db as never)) =>
        new CrewTaskOverdueWorker(db as never, sender, authorization);
      const notices = () =>
        db.notification.findMany({
          where: {
            userId: worker,
            idempotencyKey: { startsWith: 'crew.task.overdue:' },
          },
          include: { outbox: true },
        });

      it('warns at the 72-hour boundary once, then separately warns when overdue', async () => {
        const task = await createOverdue();
        const due = new Date('2035-03-12T00:00:00Z');
        await db.crewTask.update({
          where: { id: task.id },
          data: { dueAt: due },
        });
        const warnings = () =>
          db.notification.findMany({
            where: {
              userId: worker,
              idempotencyKey: { startsWith: 'crew.task.due-soon-72h:' },
            },
          });
        await makeWorker().drainOnce(
          new Date(due.getTime() - 72 * 3600000 - 1),
        );
        expect(await warnings()).toHaveLength(0);
        await Promise.all([
          makeWorker().drainOnce(new Date(due.getTime() - 72 * 3600000)),
          makeWorker().drainOnce(new Date(due.getTime() - 72 * 3600000)),
        ]);
        expect(await warnings()).toHaveLength(1);
        await makeWorker().drainOnce(due);
        expect(await warnings()).toHaveLength(1);
        expect(await notices()).toHaveLength(0);
        await makeWorker().drainOnce(new Date(due.getTime() + 1));
        expect(await notices()).toHaveLength(1);
        const next = new Date(due.getTime() + 96 * 3600000);
        await db.crewTask.update({
          where: { id: task.id },
          data: { dueAt: next },
        });
        await makeWorker().drainOnce(due);
        expect(await warnings()).toHaveLength(1);
        await makeWorker().drainOnce(new Date(next.getTime() - 72 * 3600000));
        expect(await warnings()).toHaveLength(2);
      });

      it('queues one durable notice across replicas/restarts and another only for a changed overdue deadline', async () => {
        const task = await createOverdue();
        await Promise.all([makeWorker().drainOnce(), makeWorker().drainOnce()]);
        await makeWorker().drainOnce();
        let rows = await notices();
        expect(rows).toHaveLength(1);
        expect(rows[0].meta).toMatchObject({ taskId: task.id, crewId });
        expect(rows[0].outbox).toHaveLength(1);
        await tasks.update(
          task.id,
          owner,
          UpdateCrewTaskSchema.parse({
            expectedVersion: task.version,
            dueAt: new Date(Date.now() + 86400000).toISOString(),
          }),
        );
        await makeWorker().drainOnce();
        expect(await notices()).toHaveLength(1);
        await db.crewTask.update({
          where: { id: task.id },
          data: { dueAt: new Date(Date.now() - 3600000) },
        });
        await makeWorker().drainOnce();
        rows = await notices();
        expect(rows).toHaveLength(2);
      });

      it('excludes review/completed/cancelled work, removed members and deleted crews', async () => {
        for (const semantic of [
          'submitted',
          'approved',
          'cancelled',
        ] as const) {
          const task = await createOverdue();
          const state = await db.crewTaskWorkflowState.findFirstOrThrow({
            where: { crewId, semantic },
          });
          await db.crewTask.update({
            where: { id: task.id },
            data: { workflowStateId: state.id },
          });
        }
        await makeWorker().drainOnce();
        expect(await notices()).toHaveLength(0);
        await createOverdue();
        await db.crewMember.update({
          where: { id: workerMemberId },
          data: { status: 'removed', removedAt: new Date() },
        });
        await makeWorker().drainOnce();
        expect(await notices()).toHaveLength(0);
        await db.crewMember.update({
          where: { id: workerMemberId },
          data: { status: 'active', removedAt: null },
        });
        await db.crew.update({
          where: { id: crewId },
          data: { deletedAt: new Date() },
        });
        await makeWorker().drainOnce();
        expect(await notices()).toHaveLength(0);
      });

      it('rechecks a deadline changed after discovery and respects revoked task access', async () => {
        const task = await createOverdue();
        const discovered = extendPrismaQueries(db, {
          query: {
            crewTask: {
              async findMany({ args, query }) {
                const candidates = await query(args);
                await db.crewTask.update({
                  where: { id: task.id },
                  data: { dueAt: new Date(Date.now() + 86400000) },
                });
                return candidates;
              },
            },
          },
        });
        await new CrewTaskOverdueWorker(
          discovered as never,
          new NotificationService(db as never),
          authorization,
        ).drainOnce();
        expect(await notices()).toHaveLength(0);
        await db.crewTask.update({
          where: { id: task.id },
          data: { dueAt: new Date(Date.now() - 3600000) },
        });
        await db.crewMemberPermissionOverride.create({
          data: {
            memberId: workerMemberId,
            permissionKey: 'tasks.view',
            effect: 'deny',
            changedByUserId: owner,
          },
        });
        await makeWorker().drainOnce();
        expect(await notices()).toHaveLength(0);
      });

      it('rolls back a failed outbox write and retries without losing the reminder', async () => {
        await createOverdue();
        await createOverdue();
        const sender = new NotificationService(db as never);
        const actualSender = new NotificationService(db as never);
        const fail = jest
          .spyOn(sender, 'send')
          .mockImplementationOnce(async (...args) => {
            await actualSender.send(...args);
            throw new Error('Simulated transaction failure');
          });
        const reminder = makeWorker(sender);
        await expect(reminder.drainOnce()).rejects.toThrow(
          'Simulated transaction failure',
        );
        expect(await notices()).toHaveLength(1);
        fail.mockRestore();
        await reminder.drainOnce();
        expect(await notices()).toHaveLength(2);
        await reminder.onModuleDestroy();
        await createOverdue();
        await reminder.drainOnce();
        expect(await notices()).toHaveLength(2);
      });
    });

    describe('Consistent deadline progress', () => {
      it('aligns saved overdue views, Crew counts and the personal task centre', async () => {
        const past = new Date(Date.now() - 86400000).toISOString();
        const expected: string[] = [];
        const noRisk: string[] = [];
        for (const status of [
          'open',
          'in_progress',
          'revision_requested',
          'submitted',
          'approved',
          'cancelled',
        ] as const) {
          const task = await tasks.create(
            crewId,
            owner,
            CreateCrewTaskSchema.parse({
              ...{
                description: 'Deliver reviewable work',
                taskKind: 'script',
                dueAt: '2099-10-03T00:00:00.000Z',
                rewardUsdMinor: 0,
              },
              title: `Deadline ${status}`,
              assignees: [{ userId: worker, currency: crewCurrency() }],
            }),
          );
          const state = await db.crewTaskWorkflowState.findFirstOrThrow({
            where: { crewId, semantic: status },
          });
          await db.crewTask.update({
            where: { id: task.id },
            data: { workflowStateId: state.id, dueAt: new Date(past) },
          });
          if (['submitted', 'approved', 'cancelled'].includes(status))
            noRisk.push(task.id);
          else expected.push(task.id);
        }
        const unassigned = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Unassigned overdue',
          }),
        );
        await db.crewTask.update({
          where: { id: unassigned.id },
          data: { dueAt: new Date(past) },
        });
        const future = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Future deadline',
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        const missing = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'No deadline',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        // Historical tasks can predate the required-deadline create contract.
        await db.crewTask.update({
          where: { id: missing.id },
          data: { dueAt: null },
        });
        const view = await db.crewTaskView.create({
          data: defaultCrewTaskView(crewId, owner),
        });
        await db.crewTaskView.update({
          where: { id: view.id },
          data: {
            filters: { overdue: true },
            completedMode: 'all',
            showSubIssues: true,
          },
        });
        const listed = await tasks.list(
          crewId,
          owner,
          ListCrewTasksQuerySchema.parse({ viewId: view.id }),
        );
        expect(listed.items.map((task) => task.id).sort()).toEqual(
          [...expected, unassigned.id].sort(),
        );
        expect(listed.total).toBe(4);
        expect(
          Object.values(listed.workflowCounts).reduce(
            (total, count) => total + count,
            0,
          ),
        ).toBe(4);
        expect(await tasks.summary(crewId, worker)).toMatchObject({
          overdue: 4,
          myOverdue: 3,
          pendingReview: 1,
        });
        const center = await tasks.listCenter(worker, {
          scope: 'mine',
          status: 'all',
          limit: 100,
        });
        expect(
          center.items
            .filter((task) => task.deadlineRisk?.overdue)
            .map((task) => task.id)
            .sort(),
        ).toEqual(expected.sort());
        for (const id of [...noRisk, missing.id])
          expect(
            center.items.find((task) => task.id === id)?.deadlineRisk,
          ).toBeNull();
        expect(
          center.items.find((task) => task.id === future.id)?.deadlineRisk
            ?.overdue,
        ).toBe(false);
        const current = await db.crewTask.findUniqueOrThrow({
          where: { id: expected[0] },
        });
        await tasks.update(
          current.id,
          owner,
          UpdateCrewTaskSchema.parse({
            expectedVersion: current.version,
            dueAt: new Date(Date.now() + 172800000).toISOString(),
          }),
        );
        expect(await tasks.summary(crewId, worker)).toMatchObject({
          overdue: 3,
          myOverdue: 2,
        });
        expect(
          (
            await tasks.list(
              crewId,
              owner,
              ListCrewTasksQuerySchema.parse({ viewId: view.id }),
            )
          ).total,
        ).toBe(3);
        await tasks.delete(unassigned.id, owner, unassigned.version);
        expect(await tasks.summary(crewId, worker)).toMatchObject({
          overdue: 2,
          myOverdue: 2,
        });
      });
    });

    describe('Task dispute cases', () => {
      let svc: CrewTaskDisputesService;
      let taskId: string;
      let admin: AdminActor;
      const participant = () => ({ kind: 'user' as const, id: worker });
      const operations = () => ({ kind: 'admin' as const, admin });
      const opening = () => ({
        id: randomUUID(),
        respondentUserId: owner,
        title: 'Delivery scope disagreement',
        message: 'Please review the agreed scope.',
        submissionIds: [],
      });
      const event = (
        expectedVersion: number,
        action: 'message' | 'claim' | 'resolve' | 'appeal',
      ) => ({
        expectedVersion,
        action,
        requestKey: randomUUID(),
        message: 'Recorded explanation and next action',
        submissionIds: [],
      });
      beforeEach(async () => {
        svc = new CrewTaskDisputesService(db as never, notifications as never);
        admin = {
          id: randomUUID(),
          email: 'fixture@example.invalid',
          displayName: 'Operations fixture',
          status: 'active',
          siteScope: 'all',
          sessionId: randomUUID(),
          roleKeys: [],
          requireMfa: false,
          permissions: [ADMIN_PERMISSION_KEYS.CrewManage],
        };
        const permission = await db.adminPermission.upsert({
          where: { key: ADMIN_PERMISSION_KEYS.CrewManage },
          update: {},
          create: {
            key: ADMIN_PERMISSION_KEYS.CrewManage,
            description: 'Crew operations fixture',
          },
        });
        const role = await db.adminRole.create({
          data: {
            key: randomUUID(),
            name: 'Dispute operations fixture',
            permissions: { create: { permissionId: permission.id } },
          },
        });
        await db.adminUser.create({
          data: {
            id: admin.id,
            email: `${admin.id}@example.invalid`,
            displayName: admin.displayName,
            passwordHash: 'local-fixture-only',
            roles: { create: { roleId: role.id } },
            status: 'active',
          },
        });
        await db.adminSession.create({
          data: {
            id: admin.sessionId,
            userId: admin.id,
            tokenHash: randomUUID(),
            expiresAt: new Date('2100-01-01T00:00:00Z'),
          },
        });
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Disputed task',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        taskId = task.id;
      });
      describe('Private evidence attachments', () => {
        let attachments: CrewDisputeAttachmentsService;
        let caseId: string;
        const upload = {
          name: 'evidence.pdf',
          contentType: 'application/pdf' as const,
          sizeBytes: 123,
        };
        const objects = new Map<
          string,
          { exists: boolean; sizeBytes: number; contentType: string }
        >();
        const sign = jest.fn<
          Promise<CreateUploadUrlResult>,
          [CreateUploadUrlInput]
        >();
        const promote = jest.fn();
        const readUrl = jest.fn<
          Promise<CreateReadUrlResult>,
          [CreateReadUrlInput]
        >();
        beforeEach(async () => {
          objects.clear();
          sign.mockReset();
          promote.mockReset();
          readUrl.mockReset();
          sign.mockImplementation(
            (input: { storageKey: string; contentType: string }) =>
              Promise.resolve({
                url: 'https://fixture.invalid/put',
                method: 'PUT',
                headers: { 'Content-Type': input.contentType },
                storageKey: input.storageKey,
                provider: 'aliyun_oss',
                bucket:
                  crewCurrency() === 'CNY'
                    ? 'cn-private-fixture'
                    : 'global-private-fixture',
                region:
                  crewCurrency() === 'CNY' ? 'cn-hangzhou' : 'ap-southeast-1',
                expiresAt: new Date(Date.now() + 900000).toISOString(),
              }),
          );
          promote.mockImplementation(
            (input: {
              source: { storageKey: string };
              destination: { storageKey: string };
            }) => {
              objects.set(
                input.destination.storageKey,
                objects.get(input.source.storageKey)!,
              );
              return Promise.resolve({});
            },
          );
          readUrl.mockResolvedValue({
            url: 'https://fixture.invalid/private-read',
            provider: 'aliyun_oss',
            bucket: 'private-fixture',
            storageKey: 'final-fixture',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          });
          attachments = new CrewDisputeAttachmentsService(
            db as never,
            svc,
            { createPrivateUploadUrl: sign } as never,
            {
              forProvider: () => ({
                headStoredObject: (ref: { storageKey: string }) =>
                  Promise.resolve(
                    objects.get(ref.storageKey) ?? { exists: false },
                  ),
                promoteObject: promote,
                createReadUrl: readUrl,
              }),
            } as never,
          );
          caseId = (await svc.open(taskId, worker, opening())).id;
        });
        const uploaded = async () => {
          const id = randomUUID();
          const placement = await attachments.issue(caseId, id, worker, upload);
          objects.set(placement.storageKey, {
            exists: true,
            sizeBytes: upload.sizeBytes,
            contentType: upload.contentType,
          });
          await attachments.confirm(caseId, id, worker);
          return id;
        };
        it('keeps uploads private until an explicit event shares the verified final copy', async () => {
          const id = await uploaded();
          await expect(
            attachments.read(caseId, id, { kind: 'user', id: owner }),
          ).rejects.toThrow('not found');
          await expect(
            attachments.read(caseId, id, operations()),
          ).rejects.toThrow('not found');
          expect(
            (await attachments.list(caseId, operations())).items,
          ).toHaveLength(0);
          await svc.update(caseId, participant(), {
            ...event(1, 'message'),
            attachmentIds: [id],
          });
          expect(
            (await svc.history(caseId, participant())).events[0].attachmentIds,
          ).toEqual([id]);
          await attachments.read(caseId, id, { kind: 'user', id: owner });
          await attachments.read(caseId, id, operations());
          const readInput = readUrl.mock.calls.at(
            -1,
          )?.[0] as CreateReadUrlInput;
          expect(readInput?.storageKey).toMatch(/^dispute-evidence\/final\//);
          expect(readUrl).toHaveBeenLastCalledWith(
            expect.objectContaining({
              expiresInSeconds: 60,
              cacheControl: 'private, no-store',
              bucket:
                crewCurrency() === 'CNY'
                  ? 'cn-private-fixture'
                  : 'global-private-fixture',
            }),
          );
          expect(
            (await attachments.list(caseId, operations())).items[0],
          ).toMatchObject({ id, shared: true, ready: true });
        });
        it('rejects outsider uploads, unconfirmed sharing and another party using the uploader identity', async () => {
          const id = randomUUID();
          await expect(
            attachments.issue(caseId, id, randomUUID(), upload),
          ).rejects.toThrow('not found');
          await attachments.issue(caseId, id, worker, upload);
          await expect(attachments.confirm(caseId, id, owner)).rejects.toThrow(
            'not found',
          );
          await expect(
            svc.update(caseId, participant(), {
              ...event(1, 'message'),
              attachmentIds: [id],
            }),
          ).rejects.toThrow('unavailable');
          const ready = await uploaded();
          await expect(
            svc.update(
              caseId,
              { kind: 'user', id: owner },
              { ...event(1, 'message'), attachmentIds: [ready] },
            ),
          ).rejects.toThrow('unavailable');
        });
        it('rejects altered upload metadata, oversized files and mismatched stored bytes', async () => {
          expect(
            DisputeUpload.safeParse({ ...upload, name: 'evidence".pdf' })
              .success,
          ).toBe(false);
          expect(
            DisputeUpload.safeParse({ ...upload, sizeBytes: 11 * 1024 * 1024 })
              .success,
          ).toBe(false);
          expect(
            DisputeUpload.safeParse({ ...upload, contentType: 'text/html' })
              .success,
          ).toBe(false);
          const id = randomUUID();
          const placement = await attachments.issue(caseId, id, worker, upload);
          expect(await attachments.issue(caseId, id, worker, upload)).toEqual(
            placement,
          );
          await expect(
            attachments.issue(caseId, id, worker, {
              ...upload,
              name: 'changed.pdf',
            }),
          ).rejects.toThrow('different details');
          objects.set(placement.storageKey, {
            exists: true,
            sizeBytes: 1,
            contentType: upload.contentType,
          });
          await expect(attachments.confirm(caseId, id, worker)).rejects.toThrow(
            'size and type',
          );
          expect(promote).not.toHaveBeenCalled();
        });
        it('recovers a completed copy after an ambiguous promotion failure without duplicate media', async () => {
          const id = randomUUID();
          const placement = await attachments.issue(caseId, id, worker, upload);
          objects.set(placement.storageKey, {
            exists: true,
            sizeBytes: upload.sizeBytes,
            contentType: upload.contentType,
          });
          promote.mockImplementationOnce(
            (input: {
              source: { storageKey: string };
              destination: { storageKey: string };
            }) => {
              objects.set(
                input.destination.storageKey,
                objects.get(input.source.storageKey)!,
              );
              return Promise.reject(new Error('copy response lost'));
            },
          );
          await expect(attachments.confirm(caseId, id, worker)).rejects.toThrow(
            'response lost',
          );
          await attachments.confirm(caseId, id, worker);
          await attachments.confirm(caseId, id, worker);
          expect(promote).toHaveBeenCalledTimes(1);
          expect(
            await db.mediaAsset.count({
              where: { metadata: { path: ['disputeId'], equals: caseId } },
            }),
          ).toBe(1);
        });
        it('does not publish private attachments when the case event rolls back', async () => {
          const id = await uploaded();
          const input = { ...event(1, 'message'), attachmentIds: [id] };
          notifications.send.mockRejectedValueOnce(
            new Error('outbox unavailable'),
          );
          await expect(
            svc.update(caseId, participant(), input),
          ).rejects.toThrow('outbox unavailable');
          expect(
            (await attachments.list(caseId, { kind: 'user', id: owner })).items,
          ).toHaveLength(0);
          await svc.update(caseId, participant(), input);
          await svc.update(caseId, participant(), input);
          expect(
            (await svc.history(caseId, participant())).events,
          ).toHaveLength(2);
        });
        it('enforces moderation and keeps shared evidence readable after departure', async () => {
          const id = await uploaded();
          await svc.update(caseId, participant(), {
            ...event(1, 'message'),
            attachmentIds: [id],
          });
          await members.remove(crewId, workerMemberId, owner);
          await attachments.read(caseId, id, participant());
          const row = await db.crewDisputeAttachment.findUniqueOrThrow({
            where: { id },
          });
          await db.mediaAsset.update({
            where: { id: row.mediaAssetId! },
            data: { moderationStatus: 'blocked' },
          });
          await expect(
            attachments.read(caseId, id, participant()),
          ).rejects.toThrow('unavailable');
          await expect(
            attachments.read(caseId, id, operations()),
          ).rejects.toThrow('unavailable');
          await expect(
            svc.update(caseId, participant(), {
              ...event(2, 'message'),
              attachmentIds: [id],
            }),
          ).rejects.toThrow('unavailable');
        });
        it('keeps a finalized copy stable even if the staging upload changes', async () => {
          const id = randomUUID();
          const placement = await attachments.issue(caseId, id, worker, upload);
          objects.set(placement.storageKey, {
            exists: true,
            sizeBytes: upload.sizeBytes,
            contentType: upload.contentType,
          });
          await attachments.confirm(caseId, id, worker);
          const row = await db.crewDisputeAttachment.findUniqueOrThrow({
            where: { id },
          });
          objects.set(placement.storageKey, {
            exists: true,
            sizeBytes: 9,
            contentType: 'text/html',
          });
          await attachments.confirm(caseId, id, worker);
          expect(objects.get(row.finalKey)).toMatchObject({
            sizeBytes: upload.sizeBytes,
            contentType: upload.contentType,
          });
          await expect(
            attachments.issue(caseId, id, worker, upload),
          ).rejects.toThrow('already confirmed');
        });
        it('allows private evidence preparation for an appeal but not discussion on a resolved case', async () => {
          await svc.update(caseId, operations(), event(1, 'claim'));
          await svc.update(caseId, operations(), event(2, 'resolve'));
          const id = await uploaded();
          await expect(
            svc.update(caseId, participant(), {
              ...event(3, 'message'),
              attachmentIds: [id],
            }),
          ).rejects.toThrow('Appeal');
          expect(
            (await attachments.list(caseId, operations())).items,
          ).toHaveLength(0);
          await svc.update(caseId, participant(), {
            ...event(3, 'appeal'),
            attachmentIds: [id],
          });
          expect(
            (await attachments.list(caseId, operations())).items,
          ).toHaveLength(1);
        });
        it('rejects cross-case evidence and private attachment cursors', async () => {
          const id = await uploaded();
          await expect(
            attachments.list(
              caseId,
              { kind: 'user', id: owner },
              { limit: 1, beforeId: id },
            ),
          ).rejects.toThrow('cursor');
          await svc.update(caseId, operations(), event(1, 'claim'));
          await svc.update(caseId, operations(), event(2, 'resolve'));
          const other = await svc.open(taskId, worker, opening());
          await expect(
            svc.update(other.id, participant(), {
              ...event(1, 'message'),
              attachmentIds: [id],
            }),
          ).rejects.toThrow('unavailable');
          await expect(
            attachments.read(other.id, id, participant()),
          ).rejects.toThrow('not found');
        });
      });
      it('records a case, operations ownership, resolution and participant appeal without changing work or money', async () => {
        const before = await db.crewTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        const input = opening();
        const row = await svc.open(taskId, worker, input);
        expect((await svc.open(taskId, worker, input)).id).toBe(row.id);
        await svc.update(row.id, operations(), event(1, 'claim'));
        await svc.update(
          row.id,
          { kind: 'user', id: owner },
          event(2, 'message'),
        );
        expect(
          (await svc.update(row.id, operations(), event(3, 'resolve'))).status,
        ).toBe('resolved');
        const reopened = await svc.update(
          row.id,
          participant(),
          event(4, 'appeal'),
        );
        expect(reopened).toMatchObject({
          status: 'appealed',
          ownerAdminId: null,
          version: 5,
        });
        expect((await svc.history(row.id, participant())).events).toHaveLength(
          5,
        );
        expect(
          await db.crewTask.findUniqueOrThrow({ where: { id: taskId } }),
        ).toEqual(before);
        expect(await db.crewEarningEntry.count({ where: { taskId } })).toBe(0);
      });
      it('rechecks persisted operations access rather than trusting stale session claims', async () => {
        const row = await svc.open(taskId, worker, opening());
        await db.adminUserRole.deleteMany({ where: { userId: admin.id } });
        await expect(
          svc.update(row.id, operations(), event(1, 'claim')),
        ).rejects.toThrow('Current Crew administration');
        expect((await svc.history(row.id, participant())).version).toBe(1);
      });
      it('retains task submission references and rejects evidence from another task', async () => {
        const submission = await db.crewTaskSubmission.create({
          data: { taskId, versionNumber: 1, submittedByUserId: worker },
        });
        const row = await svc.open(taskId, worker, {
          ...opening(),
          submissionIds: [submission.id],
        });
        expect(
          (await svc.history(row.id, participant())).events[0].submissionIds,
        ).toEqual([submission.id]);
        const other = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Other task',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        await expect(
          svc.open(other.id, worker, {
            ...opening(),
            submissionIds: [submission.id],
          }),
        ).rejects.toThrow('Evidence');
      });
      it('audits ownership and resolution, enforces region scope and gates closed-case discussion', async () => {
        const row = await svc.open(taskId, worker, opening());
        await expect(
          svc.history(row.id, {
            kind: 'admin',
            admin: {
              ...admin,
              siteScope: crewCurrency() === 'USD' ? 'cn' : 'global',
            },
          }),
        ).rejects.toThrow('permission');
        const claim = event(1, 'claim');
        await svc.update(row.id, operations(), claim);
        await svc.update(row.id, operations(), claim);
        expect(
          await db.adminAuditLog.count({ where: { resourceId: row.id } }),
        ).toBe(1);
        await svc.update(row.id, operations(), event(2, 'resolve'));
        await expect(
          svc.update(row.id, participant(), event(3, 'message')),
        ).rejects.toThrow('Appeal');
        await expect(
          svc.update(row.id, operations(), event(3, 'appeal')),
        ).rejects.toThrow('participant');
        await expect(
          svc.update(row.id, participant(), event(2, 'appeal')),
        ).rejects.toThrow('Dispute changed');
        expect(
          await db.adminAuditLog.count({ where: { resourceId: row.id } }),
        ).toBe(2);
      });
      it('restricts private case access and cursor use to its parties and authorized operations', async () => {
        const row = await svc.open(taskId, worker, opening());
        const outsider = { kind: 'user' as const, id: randomUUID() };
        await expect(svc.history(row.id, outsider)).rejects.toThrow(
          'not found',
        );
        await expect(
          svc.update(row.id, outsider, event(1, 'message')),
        ).rejects.toThrow('not found');
        expect((await svc.list(outsider)).items).toHaveLength(0);
        await expect(
          svc.list(outsider, { limit: 20, beforeId: row.id }),
        ).rejects.toThrow('cursor');
        await expect(
          svc.history(row.id, {
            kind: 'admin',
            admin: { ...admin, permissions: [] },
          }),
        ).rejects.toThrow('permission');
      });
      it('rejects self cases, unrelated respondents and cross-task evidence', async () => {
        await expect(
          svc.open(taskId, worker, { ...opening(), respondentUserId: worker }),
        ).rejects.toThrow('another task participant');
        await expect(
          svc.open(taskId, worker, {
            ...opening(),
            respondentUserId: randomUUID(),
          }),
        ).rejects.toThrow('participated');
        await expect(
          svc.open(taskId, worker, {
            ...opening(),
            submissionIds: [randomUUID()],
          }),
        ).rejects.toThrow('Evidence');
        await expect(
          svc.open(taskId, randomUUID(), opening()),
        ).rejects.toThrow();
      });
      it('retains participant access after Crew membership is removed without granting task access', async () => {
        const input = opening();
        const row = await svc.open(taskId, worker, input);
        await members.remove(crewId, workerMemberId, owner);
        expect((await svc.history(row.id, participant())).id).toBe(row.id);
        expect((await svc.open(taskId, worker, input)).id).toBe(row.id);
        await svc.update(row.id, participant(), event(1, 'message'));
        await expect(
          authorization.requireMembership(crewId, worker),
        ).rejects.toThrow();
      });
      it('lets an evidenced former participant open a case after removal', async () => {
        const submission = await db.crewTaskSubmission.create({
          data: { taskId, versionNumber: 1, submittedByUserId: worker },
        });
        await members.remove(crewId, workerMemberId, owner);
        const row = await svc.open(taskId, worker, {
          ...opening(),
          submissionIds: [submission.id],
        });
        expect(row.openedByUserId).toBe(worker);
        await expect(
          authorization.requireMembership(crewId, worker),
        ).rejects.toThrow();
      });
      it('requires an operations owner and disallows participant adjudication', async () => {
        const otherAdmin = {
          ...admin,
          id: randomUUID(),
          sessionId: randomUUID(),
        };
        const role = await db.adminUserRole.findFirstOrThrow({
          where: { userId: admin.id },
        });
        await db.adminUser.create({
          data: {
            id: otherAdmin.id,
            email: `${otherAdmin.id}@example.invalid`,
            displayName: 'Other operations reviewer',
            passwordHash: 'fixture-only',
            status: 'active',
            roles: { create: { roleId: role.roleId } },
          },
        });
        await db.adminSession.create({
          data: {
            id: otherAdmin.sessionId,
            userId: otherAdmin.id,
            tokenHash: randomUUID(),
            expiresAt: new Date('2100-01-01T00:00:00Z'),
          },
        });
        const row = await svc.open(taskId, worker, opening());
        await expect(
          svc.update(row.id, participant(), event(1, 'claim')),
        ).rejects.toThrow('Only operations');
        await expect(
          svc.update(row.id, operations(), event(1, 'resolve')),
        ).rejects.toThrow('assigned operations owner');
        await svc.update(row.id, operations(), event(1, 'claim'));
        await expect(
          svc.update(
            row.id,
            { kind: 'admin', admin: otherAdmin },
            event(2, 'resolve'),
          ),
        ).rejects.toThrow('assigned operations owner');
        await expect(
          svc.update(row.id, participant(), event(2, 'resolve')),
        ).rejects.toThrow('assigned operations owner');
      });
      it('rejects duplicate open pairs and changed retries, including reversed parties', async () => {
        const input = opening();
        await svc.open(taskId, worker, input);
        await expect(
          svc.open(taskId, worker, { ...input, message: 'Changed' }),
        ).rejects.toThrow('different details');
        await expect(svc.open(taskId, worker, opening())).rejects.toThrow(
          'already open',
        );
        await expect(
          svc.open(taskId, owner, { ...opening(), respondentUserId: worker }),
        ).rejects.toThrow('already open');
      });
      it('serializes concurrent events and retries without duplicate history', async () => {
        const row = await svc.open(taskId, worker, opening());
        const input = event(1, 'message');
        const results = await Promise.allSettled([
          svc.update(row.id, participant(), input),
          svc.update(row.id, operations(), event(1, 'claim')),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const latest = await svc.history(row.id, participant());
        if (latest.events[0].action === 'message') {
          await svc.update(row.id, participant(), input);
          await expect(
            svc.update(row.id, participant(), { ...input, message: 'Changed' }),
          ).rejects.toThrow('already used');
        }
        expect((await svc.history(row.id, participant())).events).toHaveLength(
          2,
        );
      });
      it('rolls back a case and update when notification enqueueing fails', async () => {
        const input = opening();
        notifications.send.mockRejectedValueOnce(
          new Error('outbox unavailable'),
        );
        await expect(svc.open(taskId, worker, input)).rejects.toThrow(
          'outbox unavailable',
        );
        expect(
          await db.crewTaskDispute.findUnique({ where: { id: input.id } }),
        ).toBeNull();
        const row = await svc.open(taskId, worker, input);
        notifications.send.mockRejectedValueOnce(
          new Error('outbox unavailable'),
        );
        await expect(
          svc.update(row.id, operations(), event(1, 'claim')),
        ).rejects.toThrow('outbox unavailable');
        expect((await svc.history(row.id, participant())).version).toBe(1);
      });
      it('keeps immutable history and validates history pagination', async () => {
        const row = await svc.open(taskId, worker, opening());
        await svc.update(row.id, operations(), event(1, 'claim'));
        const page = await svc.history(row.id, participant(), { limit: 1 });
        expect(page.nextBeforeVersion).toBe(2);
        expect(
          (
            await svc.history(row.id, participant(), {
              limit: 1,
              beforeVersion: page.nextBeforeVersion!,
            })
          ).events[0].action,
        ).toBe('open');
        await expect(
          db.crewTaskDisputeEvent.update({
            where: { id: page.events[0].id },
            data: { message: 'Rewrite history' },
          }),
        ).rejects.toThrow('immutable');
      });
    });

    describe('Creator deadline extensions', () => {
      let svc: CrewTaskExtensionsService;
      let taskId: string;
      let version: number;
      let dueAt: string;
      const later = () => new Date(Date.now() + 7 * 86400000).toISOString();
      const request = () => ({
        requestId: randomUUID(),
        expectedVersion: version,
        requestedDueAt: later(),
        reason: 'Need more time for the agreed deliverable',
      });
      beforeEach(async () => {
        svc = new CrewTaskExtensionsService(
          db as never,
          authorization,
          notifications as never,
          conversations,
        );
        dueAt = new Date(Date.now() + 86400000).toISOString();
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Creator extension',
            dueAt,
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        taskId = task.id;
        version = task.version;
      });
      it('records consent, changes only the deadline and version, and retries without duplicate history', async () => {
        const input = request();
        const row = await svc.request(taskId, worker, input);
        expect(
          (
            await db.crewTask.findUniqueOrThrow({ where: { id: taskId } })
          ).dueAt?.toISOString(),
        ).toBe(dueAt);
        expect((await svc.request(taskId, worker, input)).id).toBe(row.id);
        const decision = {
          action: 'approve' as const,
          reason: 'Revised delivery plan accepted',
        };
        expect((await svc.decide(taskId, row.id, owner, decision)).status).toBe(
          'approved',
        );
        await svc.decide(taskId, row.id, owner, decision);
        const task = await db.crewTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        expect(task.version).toBe(version + 1);
        expect(task.dueAt?.toISOString()).toBe(input.requestedDueAt);
        expect(
          await db.crewTaskTimelineItem.count({
            where: {
              taskId,
              payload: { path: ['extensionRequestId'], equals: row.id },
            },
          }),
        ).toBe(1);
        expect((await svc.list(taskId, worker)).items[0]).toMatchObject({
          reason: input.reason,
          previousDueAt: new Date(dueAt),
          decidedByUserId: owner,
        });
        expect((await svc.request(taskId, worker, input)).status).toBe(
          'approved',
        );
      });
      it('closes with a recorded reason and preserves assignment and agreed rewards', async () => {
        const before = await db.crewTaskAssignee.findMany({
          where: { taskId },
        });
        const input = {
          requestId: randomUUID(),
          expectedVersion: version,
          reason: 'Project scope was cancelled by the producer',
        };
        const result = await tasks.close(taskId, owner, input);
        expect(result.version).toBe(version + 1);
        expect((await tasks.close(taskId, owner, input)).version).toBe(
          result.version,
        );
        expect(
          await db.crewTaskAssignee.findMany({ where: { taskId } }),
        ).toEqual(before);
        const events = await db.crewTaskTimelineItem.findMany({
          where: {
            taskId,
            payload: {
              path: ['closure', 'requestId'],
              equals: input.requestId,
            },
          },
        });
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({
          closure: input,
          closureOutcome: 'cancelled_without_financial_settlement',
        });
        await expect(
          tasks.close(taskId, owner, { ...input, reason: 'Changed reason' }),
        ).rejects.toThrow('different details');
        await expect(
          svc.request(taskId, worker, {
            ...request(),
            expectedVersion: result.version,
          }),
        ).rejects.toThrow('unfinished work');
      });
      it('returns the recorded closure on retry after its column is archived', async () => {
        const input = {
          requestId: randomUUID(),
          expectedVersion: version,
          reason: 'Project cancelled',
        };
        await tasks.close(taskId, owner, input);
        const closed = await db.crewTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        await db.crewTaskWorkflowState.update({
          where: { id: closed.workflowStateId },
          data: { archived: true },
        });
        expect((await tasks.close(taskId, owner, input)).version).toBe(
          closed.version,
        );
      });
      it('requires closure authority, a reason and the current version', async () => {
        const input = {
          requestId: randomUUID(),
          expectedVersion: version,
          reason: 'Project cancelled',
        };
        await expect(tasks.close(taskId, worker, input)).rejects.toThrow();
        await expect(
          tasks.close(taskId, owner, { ...input, reason: '  ' }),
        ).rejects.toThrow();
        await expect(
          tasks.close(taskId, owner, {
            ...input,
            expectedVersion: version + 1,
          }),
        ).rejects.toThrow('task changed');
        expect(
          (await db.crewTask.findUniqueOrThrow({ where: { id: taskId } }))
            .cancelledAt,
        ).toBeNull();
      });
      it('serializes closure with extension approval', async () => {
        const row = await svc.request(taskId, worker, request());
        const outcomes = await Promise.allSettled([
          tasks.close(taskId, owner, {
            requestId: randomUUID(),
            expectedVersion: version,
            reason: 'Project cancelled',
          }),
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Extend instead',
          }),
        ]);
        expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(
          1,
        );
      });
      it('rolls back closure and its recorded reason if notification delivery cannot be queued', async () => {
        const input = {
          requestId: randomUUID(),
          expectedVersion: version,
          reason: 'Project cancelled',
        };
        notifications.send.mockRejectedValueOnce(
          new Error('outbox unavailable'),
        );
        await expect(tasks.close(taskId, owner, input)).rejects.toThrow(
          'outbox unavailable',
        );
        expect(
          (await db.crewTask.findUniqueOrThrow({ where: { id: taskId } }))
            .cancelledAt,
        ).toBeNull();
        expect(
          await db.crewTaskTimelineItem.count({
            where: {
              taskId,
              payload: {
                path: ['closure', 'requestId'],
                equals: input.requestId,
              },
            },
          }),
        ).toBe(0);
      });
      it('requires decision evidence at the database boundary', async () => {
        const row = await svc.request(taskId, worker, request());
        await expect(
          db.crewTaskExtensionRequest.update({
            where: { id: row.id },
            data: {
              status: 'approved',
              decidedByUserId: owner,
              decidedAt: new Date(),
              decisionReason: null,
            },
          }),
        ).rejects.toThrow();
        expect(
          (
            await db.crewTaskExtensionRequest.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).status,
        ).toBe('pending');
      });
      it('requires an existing deadline and rejects dates that have elapsed', async () => {
        await expect(
          svc.request(taskId, worker, {
            ...request(),
            requestedDueAt: new Date(0).toISOString(),
          }),
        ).rejects.toThrow('future deadline');
        await db.crewTask.update({
          where: { id: taskId },
          data: { dueAt: null },
        });
        await expect(svc.request(taskId, worker, request())).rejects.toThrow(
          'existing deadline',
        );
      });
      it('rejects outsiders, unassigned requests, creator review and another creator withdrawal', async () => {
        await expect(svc.list(taskId, randomUUID())).rejects.toThrow();
        await expect(svc.request(taskId, owner, request())).rejects.toThrow(
          'assigned creator',
        );
        const row = await svc.request(taskId, worker, request());
        await expect(
          svc.decide(taskId, row.id, worker, {
            action: 'approve',
            reason: 'Self review',
          }),
        ).rejects.toThrow('own extension');
        await expect(
          svc.decide(taskId, row.id, owner, {
            action: 'withdraw',
            reason: 'Wrong actor',
          }),
        ).rejects.toThrow('Only the requester');
      });
      it('rejects reused IDs, stale versions, missing reasons, shortened deadlines and duplicate pending requests', async () => {
        expect(
          ExtensionRequestInput.safeParse({ ...request(), reason: '  ' })
            .success,
        ).toBe(false);
        await expect(
          svc.request(taskId, worker, {
            ...request(),
            expectedVersion: version + 1,
          }),
        ).rejects.toThrow('Task changed');
        await expect(
          svc.request(taskId, worker, { ...request(), requestedDueAt: dueAt }),
        ).rejects.toThrow('later than');
        const input = request();
        await svc.request(taskId, worker, input);
        await expect(
          svc.request(taskId, worker, { ...input, reason: 'Different' }),
        ).rejects.toThrow('already used');
        await expect(svc.request(taskId, worker, request())).rejects.toThrow(
          'pending extension',
        );
      });
      it('retains rejection and withdrawal history without changing the deadline', async () => {
        const first = await svc.request(taskId, worker, request());
        await svc.decide(taskId, first.id, owner, {
          action: 'reject',
          reason: 'Keep the agreed deadline',
        });
        const second = await svc.request(taskId, worker, request());
        const input = {
          action: 'withdraw' as const,
          reason: 'The blocker was resolved',
        };
        await svc.decide(taskId, second.id, worker, input);
        await svc.decide(taskId, second.id, worker, input);
        expect(
          (
            await db.crewTask.findUniqueOrThrow({ where: { id: taskId } })
          ).dueAt?.toISOString(),
        ).toBe(dueAt);
        const page = await svc.list(taskId, owner, { limit: 1 });
        expect(page.items).toHaveLength(1);
        expect(
          (
            await svc.list(taskId, worker, {
              limit: 1,
              beforeId: page.nextBeforeId!,
            })
          ).items,
        ).toHaveLength(1);
        await expect(
          svc.list(taskId, owner, { limit: 1, beforeId: randomUUID() }),
        ).rejects.toThrow('cursor');
      });
      it('does not overwrite changes made after the request', async () => {
        const row = await svc.request(taskId, worker, request());
        await tasks.update(
          taskId,
          owner,
          UpdateCrewTaskSchema.parse({
            expectedVersion: version,
            title: 'Changed scope',
          }),
        );
        await expect(
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Approve stale request',
          }),
        ).rejects.toThrow('Task changed');
        expect(
          (
            await db.crewTaskExtensionRequest.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).status,
        ).toBe('pending');
        await svc.decide(taskId, row.id, owner, {
          action: 'reject',
          reason: 'Please request against the current task',
        });
      });
      it('serializes competing approval and withdrawal', async () => {
        const row = await svc.request(taskId, worker, request());
        const results = await Promise.allSettled([
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Accepted',
          }),
          svc.decide(taskId, row.id, worker, {
            action: 'withdraw',
            reason: 'No longer needed',
          }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const final = await db.crewTaskExtensionRequest.findUniqueOrThrow({
          where: { id: row.id },
        });
        const task = await db.crewTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        expect(task.version).toBe(
          version + (final.status === 'approved' ? 1 : 0),
        );
      });
      it('rolls back a decision and deadline when its notification fails', async () => {
        const row = await svc.request(taskId, worker, request());
        notifications.send.mockRejectedValueOnce(
          new Error('outbox unavailable'),
        );
        await expect(
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Accepted',
          }),
        ).rejects.toThrow('outbox unavailable');
        expect(
          (
            await db.crewTaskExtensionRequest.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).status,
        ).toBe('pending');
        expect(
          (await db.crewTask.findUniqueOrThrow({ where: { id: taskId } }))
            .version,
        ).toBe(version);
        expect(
          await db.crewTaskTimelineItem.count({
            where: {
              taskId,
              payload: { path: ['extensionRequestId'], equals: row.id },
            },
          }),
        ).toBe(0);
      });
      it('serializes approval with ordinary task edits', async () => {
        const row = await svc.request(taskId, worker, request());
        const results = await Promise.allSettled([
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Accepted',
          }),
          tasks.update(
            taskId,
            owner,
            UpdateCrewTaskSchema.parse({
              expectedVersion: version,
              title: 'New scope',
            }),
          ),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
          (await db.crewTask.findUniqueOrThrow({ where: { id: taskId } }))
            .version,
        ).toBe(version + 1);
      });
      it('blocks approval while a delivery is awaiting review', async () => {
        const row = await svc.request(taskId, worker, request());
        const state = await db.crewTaskWorkflowState.findFirstOrThrow({
          where: { crewId, semantic: 'submitted' },
        });
        await db.crewTask.update({
          where: { id: taskId },
          data: { workflowStateId: state.id },
        });
        await expect(
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Too late',
          }),
        ).rejects.toThrow('awaiting review');
        await svc.decide(taskId, row.id, worker, {
          action: 'withdraw',
          reason: 'Delivery is already submitted',
        });
      });
      it('does not approve requests after membership revocation', async () => {
        const row = await svc.request(taskId, worker, request());
        await db.crewMember.update({
          where: { id: workerMemberId },
          data: { status: CrewMembershipStatus.removed, removedAt: new Date() },
        });
        await expect(
          svc.decide(taskId, row.id, owner, {
            action: 'approve',
            reason: 'Inactive creator',
          }),
        ).rejects.toThrow();
        expect(
          (
            await db.crewTaskExtensionRequest.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).status,
        ).toBe('pending');
      });
    });

    describe('Task-linked recruitment', () => {
      let taskId: string;
      let openingId: string;
      let appId: string;
      let terms: CrewApplicationTermsService;
      let positions: PositionsService;
      const offer = () => ({
        expectedVersion: 0,
        scope: 'Create the agreed episode asset',
        feeAmount: '12345',
        currency: crewCurrency(),
        feePeriod: 'project' as const,
        revenueShareBp: 0,
        shareBasis: null,
      });
      beforeEach(async () => {
        terms = new CrewApplicationTermsService(db as never, authorization);
        positions = new PositionsService(db as never, authorization);
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Recruit a task creator',
            assignees: [],
          }),
        );
        taskId = task.id;
        const position = await positions.create(
          crewId,
          owner,
          CreatePositionSchema.parse({
            taskId,
            positionType: 'animator',
            description: 'Task work',
            targetCount: 1,
          }),
          [13],
        );
        openingId = position.id;
        expect(position.taskId).toBe(taskId);
        const app = await applications.apply(crewId, openingId, worker, {});
        appId = app.id;
      });
      async function assign(amount: number | null = 12345, userId = worker) {
        const task = await db.crewTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        return tasks.update(
          taskId,
          owner,
          UpdateCrewTaskSchema.parse({
            expectedVersion: task.version,
            assignees: [
              { userId, currency: crewCurrency(), rewardAmountMinor: amount },
            ],
          }),
        );
      }
      describe('Private task invitations', () => {
        let invites: CrewPositionInvitationsService;
        beforeEach(async () => {
          invites = new CrewPositionInvitationsService(
            db as never,
            authorization,
            applications,
          );
          const privatePosition = await positions.create(
            crewId,
            owner,
            CreatePositionSchema.parse({
              taskId,
              recruitmentVisibility: 'private',
              positionType: 'animator',
              description: 'Private task',
              targetCount: 1,
            }),
            [13],
          );
          openingId = privatePosition.id;
          expect(privatePosition.recruitmentVisibility).toBe('private');
        });
        const invite = (userId = finance) =>
          invites.create(openingId, owner, {
            inviteeUserId: userId,
            expiresInDays: 7,
          });
        it('hides private positions and requires a recipient-bound invitation', async () => {
          await db.crew.update({
            where: { id: crewId },
            data: { listingStatus: 'listed' },
          });
          expect(
            (
              await positions.listPublic(
                ListPublicPositionsQuerySchema.parse({ crewId }),
              )
            ).items.some((row) => row.position.id === openingId),
          ).toBe(false);
          expect(
            (await positions.list(crewId, null, { limit: 50 })).items.some(
              (row) => row.id === openingId,
            ),
          ).toBe(false);
          await expect(
            applications.apply(crewId, openingId, finance, {}),
          ).rejects.toThrow('Position not found');
          expect((await crews.detail(crewId, null)).openPositionCount).toBe(1);
          const row = await invite();
          await expect(invites.get(row.id, worker)).rejects.toThrow();
          await expect(invites.accept(row.id, owner, {})).rejects.toThrow(
            'Only the invited creator',
          );
          const app = await invites.accept(row.id, finance, {});
          expect(app.status).toBe('pending');
          await expect(applications.approve(app.id, owner)).rejects.toThrow(
            'confirmed final terms',
          );
          await terms.propose(app.id, owner, offer());
          await terms.confirm(app.id, finance, 1);
          await applications.approve(app.id, owner);
          await expect(assign(12345, finance)).resolves.toMatchObject({
            id: taskId,
          });
        });
        it('does not grant an invited outsider membership or workspace access on acceptance', async () => {
          const outsider = `invited-${randomUUID()}`;
          const row = await invite(outsider);
          const app = await invites.accept(row.id, outsider, {});
          expect(app.status).toBe('pending');
          expect(
            await db.crewMember.count({ where: { crewId, userId: outsider } }),
          ).toBe(0);
          expect(
            await db.workspaceMember.count({ where: { userId: outsider } }),
          ).toBe(0);
        });

        it('makes duplicate creation and acceptance safe without reserving a vacancy', async () => {
          const rows = await Promise.all([invite(), invite()]);
          expect(rows[0].id).toBe(rows[1].id);
          const accepted = await Promise.all([
            invites.accept(rows[0].id, finance, {}),
            invites.accept(rows[0].id, finance, {}),
          ]);
          expect(accepted[0].id).toBe(accepted[1].id);
          expect(
            (
              await db.crewPosition.findUniqueOrThrow({
                where: { id: openingId },
              })
            ).recruitedCount,
          ).toBe(0);
          expect(
            await db.crewApplication.count({
              where: { positionId: openingId, applicantId: finance },
            }),
          ).toBe(1);
        });
        it.each(['declined', 'revoked'] as const)(
          'rejects acceptance after %s',
          async (status) => {
            const row = await invite();
            await invites.close(
              row.id,
              status === 'declined' ? finance : owner,
              status,
            );
            await expect(invites.accept(row.id, finance, {})).rejects.toThrow(
              'no longer pending',
            );
            expect(
              await db.crewApplication.count({
                where: { positionId: openingId },
              }),
            ).toBe(0);
          },
        );
        it('rejects expired or closed invitations without creating applications', async () => {
          const row = await invite();
          await db.crewPositionInvitation.update({
            where: { id: row.id },
            data: { expiresAt: new Date(0) },
          });
          await expect(invites.accept(row.id, finance, {})).rejects.toThrow(
            'expired',
          );
          const next = await invite();
          await positions.update(crewId, openingId, owner, {
            status: 'frozen',
          });
          await expect(invites.accept(next.id, finance, {})).rejects.toThrow(
            'not accepting applications',
          );
        });
        it('cannot bypass qualification checks and preserves the invitation after failure', async () => {
          const row = await invite();
          const check = jest
            .spyOn(CrewQualificationsService.prototype, 'assertEligible')
            .mockRejectedValueOnce(new Error('Missing required certificates'));
          try {
            await expect(
              invites.accept(row.id, finance, {}, 'recipient-session'),
            ).rejects.toThrow('Missing required certificates');
            expect(check).toHaveBeenCalledWith(
              finance,
              'recipient-session',
              expect.objectContaining({ id: openingId }),
            );
            expect(
              (
                await db.crewPositionInvitation.findUniqueOrThrow({
                  where: { id: row.id },
                })
              ).status,
            ).toBe('pending');
            expect(
              await db.crewApplication.count({
                where: { positionId: openingId },
              }),
            ).toBe(0);
          } finally {
            check.mockRestore();
          }
        });
        it('reuses an existing pending application and scopes paginated invitations to the recipient', async () => {
          const first = await invite();
          const app = await invites.accept(first.id, finance, {});
          const second = await invite();
          expect((await invites.accept(second.id, finance, {})).id).toBe(
            app.id,
          );
          const page = await invites.list(finance, { limit: 1 });
          expect(page.items).toHaveLength(1);
          expect(page.nextCursor).toBeTruthy();
          expect(
            (
              await invites.list(finance, {
                limit: 1,
                cursor: page.nextCursor!,
              })
            ).items,
          ).toHaveLength(1);
          await expect(
            invites.list(worker, { limit: 1, cursor: first.id }),
          ).rejects.toThrow('Invalid invitation cursor');
          expect(
            (await invites.list(owner, { limit: 20 }, openingId)).items,
          ).toHaveLength(2);
          await expect(
            invites.list(worker, { limit: 20 }, openingId),
          ).rejects.toThrow();
        });
        it('rolls back invitation acceptance when application notification recording fails', async () => {
          const row = await invite();
          notifications.send.mockRejectedValueOnce(new Error('Outbox failure'));
          await expect(invites.accept(row.id, finance, {})).rejects.toThrow(
            'Outbox failure',
          );
          expect(
            (
              await db.crewPositionInvitation.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).status,
          ).toBe('pending');
          expect(
            await db.crewApplication.count({
              where: { positionId: openingId },
            }),
          ).toBe(0);
          await expect(
            invites.accept(row.id, finance, {}),
          ).resolves.toMatchObject({ status: 'pending' });
        });
        it('rejects an invitation when its issuer has lost recruitment permission', async () => {
          const member = await db.crewMember.findFirstOrThrow({
            where: { crewId, userId: finance, status: 'active' },
          });
          const permission = await db.crewMemberPermissionOverride.create({
            data: {
              memberId: member.id,
              permissionKey: 'openings.manage',
              effect: 'allow',
              changedByUserId: owner,
            },
          });
          const row = await invites.create(openingId, finance, {
            inviteeUserId: worker,
            expiresInDays: 7,
          });
          await db.crewMemberPermissionOverride.delete({
            where: { id: permission.id },
          });
          await expect(invites.accept(row.id, worker, {})).rejects.toThrow();
          expect(
            (
              await db.crewPositionInvitation.findUniqueOrThrow({
                where: { id: row.id },
              })
            ).status,
          ).toBe('pending');
        });

        it('serializes revocation against acceptance', async () => {
          const row = await invite();
          const results = await Promise.allSettled([
            invites.accept(row.id, finance, {}),
            invites.close(row.id, owner, 'revoked'),
          ]);
          expect(
            results.filter((result) => result.status === 'fulfilled'),
          ).toHaveLength(1);
          const stored = await db.crewPositionInvitation.findUniqueOrThrow({
            where: { id: row.id },
          });
          expect(stored.applicationId !== null).toBe(
            stored.status === 'accepted',
          );
          expect(
            await db.crewApplication.count({
              where: { positionId: openingId },
            }),
          ).toBe(stored.status === 'accepted' ? 1 : 0);
        });
      });

      describe('Post-approval amendment consent', () => {
        let amendments: CrewApplicationAmendmentsService;
        beforeEach(async () => {
          amendments = new CrewApplicationAmendmentsService(
            db as never,
            authorization,
            notifications as never,
          );
          await terms.propose(appId, owner, offer());
          await terms.confirm(appId, worker, 1);
          await applications.approve(appId, owner);
          await assign();
        });
        async function proposal() {
          return {
            ...offer(),
            id: randomUUID(),
            expectedVersion: 1,
            expectedTaskVersion: (
              await db.crewTask.findUniqueOrThrow({ where: { id: taskId } })
            ).version,
            feeAmount: '15000',
            reason: 'Additional agreed work',
          };
        }
        it('pages immutable history beyond 100 with timestamp ties and private cursors', async () => {
          const input = await proposal();
          const ids = Array.from({ length: 105 }, () => randomUUID())
            .sort()
            .reverse();
          await db.$executeRaw`
            INSERT INTO crew_application_amendments
              (id,application_id,task_id,proposer_id,applicant_id,proposal,baseline,status,created_at)
            SELECT id,${appId},${taskId}::uuid,${owner},${worker},${JSON.stringify(input)}::jsonb,
              '{}'::jsonb,'rejected','2026-09-24T00:00:00.123456Z'::timestamptz
            FROM unnest(${ids}::uuid[]) AS id`;
          const first = await amendments.list(appId, worker, { limit: 100 });
          expect(first.items.map((row) => row.id)).toEqual(ids.slice(0, 100));
          expect(first.nextCursor).toBe(ids[99]);
          expect(first.items[0]).not.toHaveProperty('baseline');
          expect(first.items[0]).not.toHaveProperty('settlement');
          const other = await db.crewApplication.create({
            data: {
              id: randomUUID(),
              crewId,
              positionId,
              applicantId: finance,
            },
          });
          await expect(
            amendments.list(other.id, finance, { limit: 20, cursor: ids[0] }),
          ).rejects.toThrow('Invalid amendment history cursor');
          // A newly inserted proposal must not shift the continuation page.
          await amendments.propose(appId, owner, input);

          await members.remove(crewId, workerMemberId, owner);
          const last = await amendments.list(appId, worker, {
            limit: 100,
            cursor: first.nextCursor!,
          });
          expect(last.items.map((row) => row.id)).toEqual(ids.slice(100));
          expect(last.nextCursor).toBeNull();
          expect((await amendments.list(appId, owner)).items).toHaveLength(20);
          await expect(
            amendments.list(appId, finance, { limit: 20, cursor: ids[0] }),
          ).rejects.toThrow();
          await expect(
            amendments.list(appId, worker, { limit: 20, cursor: randomUUID() }),
          ).rejects.toThrow('Invalid amendment history cursor');
          await expect(
            amendments.list(appId, worker, { limit: 101 }),
          ).rejects.toThrow();
          await expect(
            authorization.requireMembership(crewId, worker),
          ).rejects.toThrow();
        });
        it('keeps pending offers separate and activates submitted work only with creator consent', async () => {
          await tasks.submit(taskId, worker, {
            note: 'Work submitted',
            assetNodeIds: [],
          });
          const input = await proposal();
          await amendments.propose(appId, owner, input);
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
          await expect(
            amendments.decide(appId, input.id, owner, 'confirm'),
          ).rejects.toThrow();
          const results = await Promise.all([
            amendments.decide(appId, input.id, worker, 'confirm'),
            amendments.decide(appId, input.id, worker, 'confirm'),
          ]);
          expect(results.map((r) => r.status)).toEqual([
            'effective',
            'effective',
          ]);
          expect((await terms.list(appId, worker)).currentVersion).toBe(2);
          expect(
            (
              await db.crewTaskAssignee.findFirstOrThrow({
                where: { taskId, userId: worker },
              })
            ).rewardAmountMinor,
          ).toBe(15000n);
          expect(await db.crewTaskSubmission.count({ where: { taskId } })).toBe(
            1,
          );
          expect(await db.crewEarningEntry.count({ where: { taskId } })).toBe(
            0,
          );
          expect((await amendments.propose(appId, owner, input)).status).toBe(
            'effective',
          );
        });
        it('rejects stale confirmation and retains immutable rejected evidence', async () => {
          const input = await proposal();
          await amendments.propose(appId, owner, input);
          await tasks.submit(taskId, worker, {
            note: 'Later submission',
            assetNodeIds: [],
          });
          await expect(
            amendments.decide(appId, input.id, worker, 'confirm'),
          ).rejects.toThrow('Settlement state changed');
          expect(
            (await amendments.decide(appId, input.id, worker, 'reject')).status,
          ).toBe('rejected');
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
          await expect(
            db.$executeRaw`UPDATE crew_application_amendments SET proposal='{}'::jsonb WHERE id=${input.id}::uuid`,
          ).rejects.toThrow('immutable');
          await expect(amendments.list(appId, finance)).rejects.toThrow();
        });
        it('keeps posted earnings unchanged while confirmed amendments await finance', async () => {
          await tasks.submit(taskId, worker, {
            note: 'Finished',
            assetNodeIds: [],
          });
          const submission = await db.crewTaskSubmission.findFirstOrThrow({
            where: { taskId },
          });
          await tasks.review(taskId, owner, {
            expectedSubmissionId: submission.id,
            decision: 'approve',
            note: 'Accepted',
          });
          const before = await db.crewEarningEntry.findMany({
            where: { taskId },
          });
          const input = await proposal();
          await amendments.propose(appId, owner, input);
          expect(
            (await amendments.decide(appId, input.id, worker, 'confirm'))
              .status,
          ).toBe('awaiting_settlement');
          expect(
            await db.crewEarningEntry.findMany({ where: { taskId } }),
          ).toEqual(before);
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
        });
        async function completeWork() {
          await tasks.submit(taskId, worker, {
            note: 'Completed work',
            assetNodeIds: [],
          });
          const submitted = await db.crewTaskSubmission.findFirstOrThrow({
            where: { taskId },
          });
          await tasks.review(taskId, owner, {
            expectedSubmissionId: submitted.id,
            decision: 'approve',
            note: 'Accepted',
          });
        }
        async function agreed(amount: string) {
          const input = {
            ...(await proposal()),
            expectedVersion: (await terms.list(appId, worker)).currentVersion,
            feeAmount: amount,
          };
          await amendments.propose(appId, owner, input);
          await amendments.decide(appId, input.id, worker, 'confirm');
          return input;
        }
        it('exposes a private finance queue with separate manual requests and stable cursors', async () => {
          await completeWork();
          const input = await agreed('14000');
          const ids = Array.from({ length: 3 }, () => randomUUID())
            .sort()
            .reverse();
          await db.$executeRaw`
            INSERT INTO crew_application_amendments
              (id,application_id,task_id,proposer_id,applicant_id,proposal,baseline,status,created_at)
            SELECT id,${appId},${taskId}::uuid,${owner},${worker},${JSON.stringify(input)}::jsonb,
              '{}'::jsonb,'settlement_requested','2026-09-24T00:00:00.123456Z'::timestamptz
            FROM unnest(${ids}::uuid[]) AS id`;
          expect(
            (await amendments.listSettlementQueue(crewId, finance)).items.map(
              (r) => r.id,
            ),
          ).toEqual([input.id]);
          await expect(amendments.list(appId, finance)).rejects.toThrow();
          await expect(
            amendments.listSettlementQueue(crewId, worker),
          ).rejects.toThrow();
          const first = await amendments.listSettlementQueue(crewId, finance, {
            limit: 2,
            status: 'settlement_requested',
          });
          expect(first.items.map((r) => r.id)).toEqual(ids.slice(0, 2));
          expect(first.items[0]).not.toHaveProperty('baseline');
          expect(first.items[0]).not.toHaveProperty('settlement');
          const last = await amendments.listSettlementQueue(crewId, finance, {
            limit: 2,
            status: 'settlement_requested',
            cursor: first.nextCursor!,
          });
          expect(last.items.map((r) => r.id)).toEqual(ids.slice(2));
          expect(last.nextCursor).toBeNull();
          await amendments.settle(appId, input.id, finance);
          expect(
            (
              await amendments.listSettlementQueue(crewId, finance, {
                limit: 20,
                status: 'awaiting_settlement',
                cursor: input.id,
              })
            ).items,
          ).toEqual([]);
          await expect(
            amendments.listSettlementQueue(crewId, finance, {
              limit: 20,
              status: 'awaiting_settlement',
              cursor: randomUUID(),
            }),
          ).rejects.toThrow('Invalid settlement queue cursor');
          const financeMember = await authorization.requireMembership(
            crewId,
            finance,
          );
          await members.remove(crewId, financeMember.memberId, owner);
          await expect(
            amendments.listSettlementQueue(crewId, finance),
          ).rejects.toThrow();
        });
        it('isolates foreign Crew cases and rejects settlement after finance access is revoked', async () => {
          await completeWork();
          const input = await agreed('14000');
          const otherCrewId = `workflow-${randomUUID()}`;
          await db.crew.create({
            data: {
              id: otherCrewId,
              name: 'Other finance scope',
              description: '',
              logo: 'test.png',
              createdByUserId: owner,
            },
          });
          try {
            const otherOwner = await db.crewMember.create({
              data: {
                id: randomUUID(),
                crewId: otherCrewId,
                userId: owner,
                joinedVia: 'creation',
              },
            });
            await db.crewOwnership.create({
              data: { crewId: otherCrewId, memberId: otherOwner.id },
            });
            await collaboration.ensureCrewSpace(otherCrewId);
            const otherTask = await tasks.create(
              otherCrewId,
              owner,
              CreateCrewTaskSchema.parse({
                ...{
                  description: 'Deliver reviewable work',
                  taskKind: 'script',
                  dueAt: '2099-10-03T00:00:00.000Z',
                  rewardUsdMinor: 0,
                },
                title: 'Other Crew work',
              }),
            );
            const otherPosition = await db.crewPosition.create({
              data: {
                id: randomUUID(),
                crewId: otherCrewId,
                taskId: otherTask.id,
                positionType: 'animator',
                description: 'Other opening',
                targetCount: 1,
              },
            });
            const otherApp = await db.crewApplication.create({
              data: {
                id: randomUUID(),
                crewId: otherCrewId,
                positionId: otherPosition.id,
                applicantId: worker,
                status: 'approved',
                termsVersion: 1,
              },
            });
            await db.crewApplicationTerms.create({
              data: {
                id: randomUUID(),
                applicationId: otherApp.id,
                version: 1,
                revenueShareBp: input.revenueShareBp,
                shareBasis: input.shareBasis,
                scope: input.scope,
                feeAmount: 12345n,
                currency: input.currency,
                feePeriod: 'project',
                proposedByUserId: owner,
                confirmedAt: new Date(),
              },
            });
            const foreignId = randomUUID();
            await db.$executeRaw`
              INSERT INTO crew_application_amendments (id,application_id,task_id,proposer_id,applicant_id,proposal,baseline,status,confirmed_at)
              VALUES (${foreignId}::uuid,${otherApp.id},${otherTask.id}::uuid,${owner},${worker},${JSON.stringify(input)}::jsonb,'{}'::jsonb,'awaiting_settlement',now())`;
            expect(
              (await amendments.listSettlementQueue(crewId, finance)).items.map(
                (r) => r.id,
              ),
            ).toEqual([input.id]);
            expect(
              (
                await amendments.listSettlementQueue(otherCrewId, owner)
              ).items.map((r) => r.id),
            ).toEqual([foreignId]);
            await expect(
              amendments.listSettlementQueue(otherCrewId, finance),
            ).rejects.toThrow();
            await expect(
              amendments.listSettlementQueue(crewId, finance, {
                limit: 20,
                status: 'awaiting_settlement',
                cursor: foreignId,
              }),
            ).rejects.toThrow('Invalid settlement queue cursor');
            await expect(
              amendments.settle(otherApp.id, foreignId, finance),
            ).rejects.toThrow();
            await expect(
              amendments.settle(appId, foreignId, finance),
            ).rejects.toThrow('Amendment not found');
            const before = await db.crewEarningEntry.findMany({
              where: { taskId },
            });
            const member = await authorization.requireMembership(
              crewId,
              finance,
            );
            await members.remove(crewId, member.memberId, owner);
            await expect(
              amendments.settle(appId, input.id, finance),
            ).rejects.toThrow();
            expect(
              await db.crewEarningEntry.findMany({ where: { taskId } }),
            ).toEqual(before);
            expect((await terms.list(appId, worker)).currentVersion).toBe(1);
            expect((await amendments.list(appId, worker)).items[0].status).toBe(
              'awaiting_settlement',
            );
            expect(
              await db.crewEarningEntry.count({
                where: { taskId: otherTask.id },
              }),
            ).toBe(0);
          } finally {
            await db.crew.update({
              where: { id: otherCrewId },
              data: { deletedAt: new Date() },
            });
          }
        });
        it('atomically replaces unallocated rewards repeatedly and supports zero compensation', async () => {
          await completeWork();
          const first = await agreed('14000');
          await expect(
            amendments.settle(appId, first.id, worker),
          ).rejects.toThrow();
          const results = await Promise.all([
            amendments.settle(appId, first.id, finance),
            amendments.settle(appId, first.id, finance),
          ]);
          expect(results.map((r) => r.status)).toEqual([
            'effective',
            'effective',
          ]);
          expect(
            await db.crewEarningEntry.count({
              where: { taskId, status: 'posted' },
            }),
          ).toBe(1);
          expect(
            await db.crewEarningEntry.findFirstOrThrow({
              where: { taskId, sourceType: 'task_reward' },
            }),
          ).toMatchObject({ amountMinor: 12345n, status: 'reversed' });
          const second = await agreed('15000');
          await amendments.settle(appId, second.id, finance);
          expect(
            await db.crewEarningEntry.findFirstOrThrow({
              where: { taskId, status: 'posted' },
            }),
          ).toMatchObject({ amountMinor: 15000n, amendmentId: second.id });
          const zero = await agreed('0');
          await amendments.settle(appId, zero.id, finance);
          expect(
            await db.crewEarningEntry.count({
              where: { taskId, status: 'posted' },
            }),
          ).toBe(0);
          expect((await terms.list(appId, worker)).items[0].feeAmount).toBe(
            '0',
          );
        });
        it('preserves partially paid earnings, supplements increases and records reductions without debits', async () => {
          await completeWork();
          const pending = await payouts.create(crewId, finance, {
            crewMemberId: workerMemberId,
            currency: crewCurrency(),
            amountMinor: '5000',
            withholdingAmountMinor: '0',
            idempotencyKey: randomUUID(),
          });
          await payouts.pay(pending.id, finance, {
            expectedVersion: pending.version,
            paymentMethod: 'bank_transfer',
            paymentReference: 'LOCAL-AMENDMENT',
          });
          const original = await db.crewEarningEntry.findFirstOrThrow({
            where: { taskId },
          });
          const increase = await agreed('15000');
          await amendments.settle(appId, increase.id, finance);
          expect(
            await db.crewEarningEntry.findUniqueOrThrow({
              where: { id: original.id },
            }),
          ).toEqual(original);
          expect(
            await db.crewEarningEntry.findFirstOrThrow({
              where: { amendmentId: increase.id },
            }),
          ).toMatchObject({ amountMinor: 2655n, status: 'posted' });
          const reduction = await agreed('10000');
          expect(
            (await amendments.settle(appId, reduction.id, finance)).status,
          ).toBe('settlement_requested');
          expect((await terms.list(appId, worker)).items[0].feeAmount).toBe(
            '15000',
          );
          expect(await db.crewEarningEntry.count({ where: { taskId } })).toBe(
            2,
          );
          expect(
            (
              await db.crewPayout.findUniqueOrThrow({
                where: { id: pending.id },
              })
            ).status,
          ).toBe('paid');
        });
        it('blocks pending payouts and requires fresh consent after voiding them', async () => {
          await completeWork();
          const pending = await payouts.create(crewId, finance, {
            crewMemberId: workerMemberId,
            currency: crewCurrency(),
            amountMinor: '5000',
            withholdingAmountMinor: '0',
            idempotencyKey: randomUUID(),
          });
          const input = await agreed('11000');
          await expect(
            amendments.settle(appId, input.id, finance),
          ).rejects.toThrow('pending payouts');
          await payouts.void(pending.id, finance, {
            expectedVersion: pending.version,
            reason: 'Review changed fee',
          });
          await expect(
            amendments.settle(appId, input.id, finance),
          ).rejects.toThrow('Settlement state changed');
          await amendments.decide(appId, input.id, owner, 'withdraw');
          const refreshed = await agreed('11000');
          await amendments.settle(appId, refreshed.id, finance);
          expect((await terms.list(appId, worker)).items[0].feeAmount).toBe(
            '11000',
          );
        });
        it('serializes payout reservation with a downward correction without overspending', async () => {
          await completeWork();
          const input = await agreed('11000');
          const results = await Promise.allSettled([
            amendments.settle(appId, input.id, finance),
            payouts.create(crewId, finance, {
              crewMemberId: workerMemberId,
              currency: crewCurrency(),
              amountMinor: '12000',
              withholdingAmountMinor: '0',
              idempotencyKey: randomUUID(),
            }),
          ]);
          expect(
            results.filter((result) => result.status === 'fulfilled'),
          ).toHaveLength(1);
          const rows = await db.crewEarningEntry.findMany({
            where: { taskId, status: 'posted' },
          });
          const total = rows.reduce((sum, row) => sum + row.amountMinor, 0n);
          const summary = (
            await payouts.listMine(worker, {
              currency: crewCurrency(),
              limit: 50,
            })
          ).summary;
          expect(BigInt(summary.availableAmountMinor)).toBeGreaterThanOrEqual(
            0n,
          );
          expect(total).toBe(
            results[0].status === 'fulfilled' ? 11000n : 12345n,
          );
        });
        it('rolls settlement earnings and effective terms back when the outbox fails', async () => {
          await completeWork();
          const input = await agreed('11000');
          const before = await db.crewEarningEntry.findMany({
            where: { taskId },
          });
          notifications.send.mockRejectedValueOnce(
            new Error('Settlement outbox failed'),
          );
          await expect(
            amendments.settle(appId, input.id, finance),
          ).rejects.toThrow('Settlement outbox failed');
          expect(
            await db.crewEarningEntry.findMany({ where: { taskId } }),
          ).toEqual(before);
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
          expect((await amendments.list(appId, worker)).items[0].status).toBe(
            'awaiting_settlement',
          );
          expect(
            (await amendments.settle(appId, input.id, finance)).status,
          ).toBe('effective');
        });
        it('retains departed creator consent without restoring membership or activating a fee', async () => {
          await members.remove(crewId, workerMemberId, owner);
          const input = await proposal();
          await amendments.propose(appId, owner, input);
          expect(
            (await amendments.decide(appId, input.id, worker, 'confirm'))
              .status,
          ).toBe('awaiting_settlement');
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
          await expect(
            authorization.requireMembership(crewId, worker),
          ).rejects.toThrow();
          expect(
            (await amendments.list(appId, worker)).items[0],
          ).not.toHaveProperty('baseline');
        });
        it('serializes conflicting proposals, supports withdrawal and rejects changed retry payloads', async () => {
          const input = await proposal();
          const results = await Promise.allSettled([
            amendments.propose(appId, owner, input),
            amendments.propose(appId, owner, { ...input, id: randomUUID() }),
          ]);
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
            1,
          );
          const current = (await amendments.list(appId, worker)).items[0];
          await expect(
            amendments.propose(appId, owner, {
              ...current.proposal,
              reason: 'Changed request',
            }),
          ).rejects.toThrow('different details');
          expect(
            (await amendments.decide(appId, current.id, owner, 'withdraw'))
              .status,
          ).toBe('withdrawn');
          await expect(
            amendments.decide(appId, current.id, worker, 'confirm'),
          ).rejects.toThrow('no longer pending');
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
        });
        it('rolls consent and fee activation back when notification persistence fails', async () => {
          const input = await proposal();
          await amendments.propose(appId, owner, input);
          notifications.send.mockRejectedValueOnce(
            new Error('Outbox unavailable'),
          );
          await expect(
            amendments.decide(appId, input.id, worker, 'confirm'),
          ).rejects.toThrow('Outbox unavailable');
          expect((await amendments.list(appId, worker)).items[0].status).toBe(
            'pending',
          );
          expect((await terms.list(appId, worker)).currentVersion).toBe(1);
          expect(
            (
              await db.crewTaskAssignee.findFirstOrThrow({
                where: { taskId, userId: worker },
              })
            ).rewardAmountMinor,
          ).toBe(12345n);
          expect(
            (await amendments.decide(appId, input.id, worker, 'confirm'))
              .status,
          ).toBe('effective');
        });
      });

      it('requires negotiated consent and matching reward before assigning the task', async () => {
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'confirmed final terms',
        );
        await expect(assign()).rejects.toThrow('approved recruitment');
        await terms.propose(appId, owner, offer());
        await terms.confirm(appId, worker, 1);
        await expect(assign()).rejects.toThrow('approved recruitment');
        await applications.approve(appId, owner);
        await expect(assign(12000)).rejects.toThrow(
          'matching the assigned reward',
        );
        await expect(assign(12345, finance)).rejects.toThrow(
          'approved recruitment',
        );
        const assigned = await assign();
        expect(assigned.assignees[0].rewardAmountMinor).toBe(12345);
        await expect(assign(13000)).rejects.toThrow(
          'matching the assigned reward',
        );
      });
      it('retains agreed compensation even when a recruitment posting is deleted', async () => {
        await terms.propose(appId, owner, offer());
        await terms.confirm(appId, worker, 1);
        await applications.approve(appId, owner);
        await positions.delete(crewId, openingId, owner);
        await expect(assign(1)).rejects.toThrow('matching the assigned reward');
        await expect(assign()).resolves.toMatchObject({ id: taskId });
      });
      it('does not reuse approval after the recruited role has been removed', async () => {
        await terms.propose(appId, owner, offer());
        await terms.confirm(appId, worker, 1);
        await applications.approve(appId, owner);
        await db.crewMemberPosition.deleteMany({
          where: { sourcePositionId: openingId },
        });
        await expect(assign()).rejects.toThrow('approved recruitment');
      });

      it('supports agreed work without a fixed cash reward', async () => {
        await terms.propose(appId, owner, { ...offer(), feeAmount: '0' });
        await terms.confirm(appId, worker, 1);
        await applications.approve(appId, owner);
        await expect(assign(null)).resolves.toMatchObject({ id: taskId });
      });
      it('rejects recurring compensation that cannot settle as a task reward', async () => {
        await expect(
          terms.propose(appId, owner, { ...offer(), feePeriod: 'month' }),
        ).rejects.toThrow('project fee');
        await expect(
          terms.propose(appId, owner, { ...offer(), feeAmount: '10000000001' }),
        ).rejects.toThrow('reward limit');
      });
      it('rejects unknown task links and does not retrofit recruitment over assigned work', async () => {
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Assigned already',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        const input = CreatePositionSchema.parse({
          taskId: task.id,
          positionType: 'animator',
          description: 'Task work',
          targetCount: 1,
        });
        await expect(
          positions.create(crewId, owner, input, [13]),
        ).rejects.toThrow('before assigning work');
        await expect(
          positions.create(
            crewId,
            owner,
            { ...input, taskId: randomUUID() },
            [13],
          ),
        ).rejects.toThrow('Recruitment task not found');
        await expect(positions.create(crewId, worker, input)).rejects.toThrow();
      });
      it('serializes first recruitment with first assignment so neither route bypasses consent', async () => {
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Concurrent recruitment',
            assignees: [],
          }),
        );
        const results = await Promise.allSettled([
          positions.create(
            crewId,
            owner,
            CreatePositionSchema.parse({
              taskId: task.id,
              positionType: 'animator',
              description: 'Task work',
              targetCount: 1,
            }),
            [13],
          ),
          tasks.update(
            task.id,
            owner,
            UpdateCrewTaskSchema.parse({
              expectedVersion: task.version,
              assignees: [
                {
                  userId: worker,
                  currency: crewCurrency(),
                  rewardAmountMinor: 12345,
                },
              ],
            }),
          ),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const linked = await db.crewPosition.count({
          where: { taskId: task.id },
        });
        const assigned = await db.crewTaskAssignee.count({
          where: { taskId: task.id },
        });
        expect(linked + assigned).toBe(1);
      });

      it('rejects further recruitment after the task is cancelled', async () => {
        await db.crew.update({
          where: { id: crewId },
          data: { listingStatus: 'listed' },
        });
        const before = await positions.listPublic(
          ListPublicPositionsQuerySchema.parse({ crewId }),
        );
        expect(before.items.some((row) => row.position.id === openingId)).toBe(
          true,
        );
        const state = await db.crewTaskWorkflowState.findFirstOrThrow({
          where: { crewId, semantic: 'cancelled' },
        });
        await db.crewTask.update({
          where: { id: taskId },
          data: { workflowStateId: state.id },
        });
        await expect(
          applications.apply(crewId, openingId, finance, {}),
        ).rejects.toThrow('no longer accepting recruitment');
        const discovery = await positions.listPublic(
          ListPublicPositionsQuerySchema.parse({ crewId }),
        );
        expect(
          discovery.items.some((row) => row.position.id === openingId),
        ).toBe(false);
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'no longer accepting recruitment',
        );
      });
    });

    describe('Application interview progress', () => {
      let interviews: CrewApplicationInterviewsService;
      let appId: string;
      const change = (
        expectedVersion: number,
        action: 'schedule' | 'confirm' | 'complete' | 'cancel' | 'message',
        message = 'Review the agreed portfolio and task scope',
      ) => ({
        expectedVersion,
        action,
        message,
        requestKey: randomUUID(),
        ...(action === 'schedule'
          ? { scheduledAt: new Date(Date.now() + 3600000).toISOString() }
          : {}),
      });
      beforeEach(async () => {
        interviews = new CrewApplicationInterviewsService(
          db as never,
          authorization,
        );
        const opening = await db.crewPosition.create({
          data: {
            id: randomUUID(),
            crewId,
            positionType: 'editor',
            description: 'Interview role',
            targetCount: 1,
          },
        });
        appId = (await applications.apply(crewId, opening.id, worker, {})).id;
        await confirmFixtureOffer(appId);
      });
      it('requires applicant confirmation and resolves an interview before approval', async () => {
        expect((await interviews.list(appId, worker)).state).toBe(
          'not_started',
        );
        await interviews.update(appId, owner, change(0, 'schedule'));
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'pending interview',
        );
        await expect(
          interviews.update(appId, owner, change(1, 'confirm')),
        ).rejects.toThrow('Only the applicant');
        await interviews.update(appId, worker, change(1, 'confirm'));
        await expect(
          interviews.update(appId, worker, change(2, 'complete')),
        ).rejects.toThrow('Only a reviewer');
        await expect(
          interviews.update(appId, owner, change(2, 'complete')),
        ).rejects.toThrow('has started');
        const completion = change(2, 'complete');
        jest.useFakeTimers({
          now: Date.now() + 7200000,
          doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setTimeout',
            'clearTimeout',
            'setInterval',
            'clearInterval',
            'queueMicrotask',
            'performance',
            'hrtime',
          ],
        });
        try {
          await interviews.update(appId, owner, completion);
        } finally {
          jest.useRealTimers();
        }
        await applications.approve(appId, owner);
        expect((await interviews.list(appId, worker)).state).toBe('completed');
        expect(await interviews.list(appId, worker)).toMatchObject({
          canUpdate: false,
          canMessage: true,
        });
        await interviews.update(
          appId,
          worker,
          change(3, 'message', 'Ready to start work'),
        );
        await interviews.update(
          appId,
          owner,
          change(4, 'message', 'Welcome to the crew'),
        );
        await expect(
          interviews.update(appId, owner, change(5, 'schedule')),
        ).rejects.toThrow('Reviewed applications');
        await db.crewMember.updateMany({
          where: { crewId, userId: worker },
          data: { status: 'removed', removedAt: new Date() },
        });
        expect((await interviews.list(appId, worker)).canMessage).toBe(false);
        await expect(
          interviews.update(appId, worker, change(5, 'message')),
        ).rejects.toThrow('Active crew membership');
      });
      it('allows reasoned cancellation by the applicant without changing application status', async () => {
        await interviews.update(appId, owner, change(0, 'schedule'));
        await interviews.update(
          appId,
          worker,
          change(
            1,
            'cancel',
            'Please reschedule because the proposed time is unavailable.',
          ),
        );
        expect((await interviews.list(appId, owner)).state).toBe('cancelled');
        expect(
          (await db.crewApplication.findUniqueOrThrow({ where: { id: appId } }))
            .status,
        ).toBe('pending');
        await applications.approve(appId, owner);
      });
      it('rescheduling requires renewed confirmation and preserves prior messages', async () => {
        await interviews.update(appId, owner, change(0, 'schedule'));
        await interviews.update(appId, worker, change(1, 'confirm'));
        await interviews.update(
          appId,
          worker,
          change(2, 'message', 'My portfolio is available in the application.'),
        );
        await interviews.update(appId, owner, change(3, 'schedule'));
        const first = await interviews.list(appId, worker, { limit: 2 });
        expect(first.state).toBe('proposed');
        expect(
          (await applications.listMine(worker, { limit: 20 })).items.find(
            (row) => row.id === appId,
          )?.interview,
        ).toMatchObject({ state: 'proposed', version: 4 });
        expect(
          (await applications.getForOwner(crewId, appId, owner)).interview,
        ).toMatchObject({ state: 'proposed', version: 4 });
        expect(first.items.map((row) => row.version)).toEqual([4, 3]);
        const next = await interviews.list(appId, worker, {
          limit: 2,
          beforeVersion: first.nextBeforeVersion!,
        });
        expect(next.items.map((row) => row.version)).toEqual([2, 1]);
        await expect(
          interviews.update(appId, worker, change(2, 'confirm')),
        ).rejects.toThrow('progress changed');
      });
      it('recovers duplicate messages even after later updates and rejects changed request keys', async () => {
        const input = change(0, 'message');
        const rows = await Promise.all([
          interviews.update(appId, worker, input),
          interviews.update(appId, worker, input),
        ]);
        expect(rows[0]).toEqual(rows[1]);
        await interviews.update(appId, owner, change(1, 'message'));
        expect(await interviews.update(appId, worker, input)).toEqual(rows[0]);
        await expect(
          interviews.update(appId, worker, {
            ...input,
            message: 'Changed message',
          }),
        ).rejects.toThrow('request key');
        expect(
          await db.crewApplicationInterviewEvent.count({
            where: { applicationId: appId },
          }),
        ).toBe(2);
      });
      it('protects applicant discussions from other members and applicants', async () => {
        await expect(interviews.list(appId, finance)).rejects.toThrow();
        await expect(
          interviews.update(appId, finance, change(0, 'message')),
        ).rejects.toThrow();
        await expect(
          interviews.update(appId, worker, change(0, 'schedule')),
        ).rejects.toThrow('Only a reviewer');
      });
      it('prevents self-approval even when the applicant has review permission', async () => {
        await db.crewMemberPermissionOverride.create({
          data: {
            memberId: workerMemberId,
            permissionKey: 'applications.review',
            effect: 'allow',
            changedByUserId: owner,
          },
        });
        await expect(applications.approve(appId, worker)).rejects.toThrow(
          'cannot approve their own',
        );
      });

      it('serializes scheduling against approval', async () => {
        const results = await Promise.allSettled([
          interviews.update(appId, owner, change(0, 'schedule')),
          applications.approve(appId, owner),
        ]);
        expect(
          results.filter((row) => row.status === 'fulfilled'),
        ).toHaveLength(1);
        const app = await db.crewApplication.findUniqueOrThrow({
          where: { id: appId },
        });
        expect((await interviews.list(appId, worker)).state).toBe(
          app.status === 'approved' ? 'not_started' : 'proposed',
        );
      });
      it('keeps rejected application history readable and forbids further writes', async () => {
        await interviews.update(appId, worker, change(0, 'message'));
        await applications.reject(appId, owner);
        expect((await interviews.list(appId, worker)).items).toHaveLength(1);
        await expect(
          interviews.update(appId, owner, change(1, 'schedule')),
        ).rejects.toThrow('Reviewed applications');
      });
    });

    it('persists saved jobs per account and excludes unpublished jobs from saved discovery', async () => {
      const positions = new PositionsService(db as never, authorization);
      await db.crew.update({
        where: { id: crewId },
        data: { listingStatus: 'listed' },
      });
      const id = randomUUID();
      await db.crewPosition.create({
        data: {
          id,
          crewId,
          positionType: 'editor',
          description: 'Saved opening',
          targetCount: 1,
        },
      });
      await Promise.all([
        positions.save(id, worker, true),
        positions.save(id, worker, true),
      ]);
      expect(await positions.saved(id, worker)).toEqual({ saved: true });
      expect(await positions.saved(id, finance)).toEqual({ saved: false });
      const query = ListPublicPositionsQuerySchema.parse({
        saved: 'true',
        crewId,
      });
      expect(
        (await positions.listPublic(query, worker)).items.map(
          (row) => row.position.id,
        ),
      ).toEqual([id]);
      expect((await positions.listPublic(query, finance)).items).toEqual([]);
      await db.crew.update({
        where: { id: crewId },
        data: { listingStatus: 'unlisted' },
      });
      expect((await positions.listPublic(query, worker)).items).toEqual([]);
      await expect(positions.save(id, finance, true)).rejects.toThrow(
        'Position not found',
      );
      expect(await positions.save(id, worker, false)).toEqual({ saved: false });
      expect(await positions.save(id, worker, false)).toEqual({ saved: false });
    });

    describe('Versioned recruitment terms', () => {
      let terms: CrewApplicationTermsService;
      let appId: string;
      let extraId: string;
      const offer = () => ({
        expectedVersion: 0,
        scope: 'Deliver the approved animation scope',
        feeAmount: '12345',
        currency: crewCurrency(),
        feePeriod: 'month' as const,
        revenueShareBp: 250,
        shareBasis:
          'Share of the project receipts explicitly approved in Crew Finance.',
      });
      beforeEach(async () => {
        terms = new CrewApplicationTermsService(db as never, authorization);
        extraId = randomUUID();
        await db.crewPosition.create({
          data: {
            id: extraId,
            crewId,
            positionType: 'editor',
            description: 'Terms fixture',
            targetCount: 2,
          },
        });
        const application = await applications.apply(
          crewId,
          extraId,
          worker,
          {},
        );
        appId = application.id;
      });
      it('does not admit applicants without final terms, even for a non-task position', async () => {
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'accepted final offer',
        );
        expect(
          (await db.crewApplication.findUniqueOrThrow({ where: { id: appId } }))
            .status,
        ).toBe('pending');
        expect(
          (await db.crewPosition.findUniqueOrThrow({ where: { id: extraId } }))
            .recruitedCount,
        ).toBe(0);
      });
      it('accepts an offer and joins atomically, with retry recovery and no duplicate seat', async () => {
        await terms.propose(appId, owner, offer());
        await expect(applications.acceptOffer(appId, owner, 1)).rejects.toThrow(
          'Only the applicant',
        );
        await expect(
          applications.acceptOffer(appId, worker, 2),
        ).rejects.toThrow('Terms changed');
        const results = await Promise.all([
          applications.acceptOffer(appId, worker, 1),
          applications.acceptOffer(appId, worker, 1),
        ]);
        expect(results.every((result) => result.status === 'approved')).toBe(
          true,
        );
        expect((await applications.acceptOffer(appId, worker, 1)).status).toBe(
          'approved',
        );
        expect(
          (await db.crewPosition.findUniqueOrThrow({ where: { id: extraId } }))
            .recruitedCount,
        ).toBe(1);
        expect(
          (await terms.list(appId, worker)).items[0].confirmedAt,
        ).toBeTruthy();
      });
      it('rolls back offer confirmation when the vacancy is unavailable', async () => {
        await terms.propose(appId, owner, offer());
        await db.crewPosition.update({
          where: { id: extraId },
          data: { status: 'frozen' },
        });
        await expect(
          applications.acceptOffer(appId, worker, 1),
        ).rejects.toThrow('no longer accepting');
        expect(
          (await db.crewApplication.findUniqueOrThrow({ where: { id: appId } }))
            .status,
        ).toBe('pending');
        expect(
          (await terms.list(appId, worker)).items[0].confirmedAt,
        ).toBeNull();
      });
      it('loads a private thread only for its applicant or an authorized reviewer', async () => {
        expect((await applications.getThread(appId, worker)).id).toBe(appId);
        expect((await applications.getThread(appId, owner)).id).toBe(appId);
        await expect(
          applications.getThread(appId, 'unrelated-viewer'),
        ).rejects.toThrow();
      });
      it('blocks approval until the applicant confirms and keeps the exact accepted version', async () => {
        const proposed = await terms.propose(appId, owner, offer());
        expect(proposed.feeAmount).toBe('12345');
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'confirm the latest terms',
        );
        expect(
          (await db.crewApplication.findUniqueOrThrow({ where: { id: appId } }))
            .status,
        ).toBe('pending');
        expect(
          (await db.crewPosition.findUniqueOrThrow({ where: { id: extraId } }))
            .recruitedCount,
        ).toBe(0);
        await expect(terms.confirm(appId, owner, 1)).rejects.toThrow(
          'Only the applicant',
        );
        const accepted = await terms.confirm(appId, worker, 1);
        await applications.approve(appId, owner);
        expect(await terms.confirm(appId, worker, 1)).toEqual(accepted);
        await expect(
          terms.propose(appId, owner, { ...offer(), expectedVersion: 1 }),
        ).rejects.toThrow('Only pending');
        expect(
          (await terms.list(appId, worker)).items[0].confirmedAt,
        ).toBeTruthy();
      });
      it('retains old evidence and requires renewed confirmation after an amendment', async () => {
        await terms.propose(appId, owner, offer());
        await terms.confirm(appId, worker, 1);
        await terms.propose(appId, owner, {
          ...offer(),
          expectedVersion: 1,
          feeAmount: '23456',
        });
        await expect(terms.confirm(appId, worker, 1)).rejects.toThrow(
          'Terms changed',
        );
        await expect(applications.approve(appId, owner)).rejects.toThrow(
          'confirm the latest terms',
        );
        const history = await terms.list(appId, worker);
        expect(history.currentVersion).toBe(2);
        expect(history.items.map((row) => row.feeAmount)).toEqual([
          '23456',
          '12345',
        ]);
        expect(history.items[0].confirmedAt).toBeNull();
        expect(history.items[1].confirmedAt).toBeTruthy();
      });
      it('recovers duplicate proposals and confirmations without extra versions', async () => {
        const rows = await Promise.all([
          terms.propose(appId, owner, offer()),
          terms.propose(appId, owner, offer()),
        ]);
        expect(rows[0]).toEqual(rows[1]);
        const confirmations = await Promise.all([
          terms.confirm(appId, worker, 1),
          terms.confirm(appId, worker, 1),
        ]);
        expect(confirmations[0]).toEqual(confirmations[1]);
        expect(await terms.propose(appId, owner, offer())).toEqual(
          confirmations[0],
        );
        expect(
          await db.crewApplicationTerms.count({
            where: { applicationId: appId },
          }),
        ).toBe(1);
      });
      it('rejects competing edits from the same base version', async () => {
        const results = await Promise.allSettled([
          terms.propose(appId, owner, offer()),
          terms.propose(appId, owner, { ...offer(), feeAmount: '999' }),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          await db.crewApplicationTerms.count({
            where: { applicationId: appId },
          }),
        ).toBe(1);
      });
      it('serializes approval with amendment without accepting an unconfirmed revision', async () => {
        await terms.propose(appId, owner, offer());
        await terms.confirm(appId, worker, 1);
        const results = await Promise.allSettled([
          applications.approve(appId, owner),
          terms.propose(appId, owner, {
            ...offer(),
            expectedVersion: 1,
            feeAmount: '999',
          }),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const current = await db.crewApplication.findUniqueOrThrow({
          where: { id: appId },
        });
        if (current.status === 'approved') expect(current.termsVersion).toBe(1);
        else {
          expect(current.status).toBe('pending');
          expect(current.termsVersion).toBe(2);
        }
      });
      it('recovers an identical proposal after approval without reopening negotiation', async () => {
        const original = await terms.propose(appId, owner, offer());
        const confirmed = await terms.confirm(appId, worker, 1);
        await applications.approve(appId, owner);
        const before = await db.crewApplication.findUniqueOrThrow({
          where: { id: appId },
        });
        const recovered = await terms.propose(appId, owner, offer());
        expect(recovered.id).toBe(original.id);
        expect(recovered.confirmedAt).toBe(confirmed.confirmedAt);
        await expect(
          terms.propose(appId, owner, { ...offer(), feeAmount: '999' }),
        ).rejects.toThrow();
        await expect(
          terms.propose(appId, owner, { ...offer(), expectedVersion: 1 }),
        ).rejects.toThrow('Only pending');
        await expect(terms.propose(appId, worker, offer())).rejects.toThrow();
        expect(
          await db.crewApplication.findUniqueOrThrow({ where: { id: appId } }),
        ).toEqual(before);
        expect(
          await db.crewApplicationTerms.count({
            where: { applicationId: appId },
          }),
        ).toBe(1);
      });
      it('protects private terms and rejects invalid money or unspecified share basis', async () => {
        await expect(terms.propose(appId, worker, offer())).rejects.toThrow();
        await expect(terms.list(appId, 'unrelated-user')).rejects.toThrow();
        await expect(
          terms.propose(appId, owner, {
            ...offer(),
            currency: crewCurrency() === 'USD' ? 'CNY' : 'USD',
          }),
        ).rejects.toThrow('integer minor units');
        for (const feeAmount of ['-1', '1.2', '01', '10000000000000000'])
          expect(
            ApplicationTermsInput.safeParse({ ...offer(), feeAmount }).success,
          ).toBe(false);
        expect(
          ApplicationTermsInput.safeParse({ ...offer(), shareBasis: null })
            .success,
        ).toBe(false);
        expect(
          ApplicationTermsInput.safeParse({
            ...offer(),
            revenueShareBp: 0,
            shareBasis: null,
            feeAmount: '0',
          }).success,
        ).toBe(true);
      });
      it('paginates private history and supports the established recruitment pay periods', async () => {
        for (const [expectedVersion, feePeriod] of [
          'month',
          'episode',
          'project',
        ].entries()) {
          await terms.propose(appId, owner, {
            ...offer(),
            expectedVersion,
            feePeriod: feePeriod as 'month' | 'episode' | 'project',
          });
        }
        const first = await terms.list(appId, worker, { limit: 2 });
        expect(first.items.map((row) => row.version)).toEqual([3, 2]);
        expect(first.nextBeforeVersion).toBe(2);
        const second = await terms.list(appId, worker, {
          limit: 2,
          beforeVersion: first.nextBeforeVersion!,
        });
        expect(second.items.map((row) => row.version)).toEqual([1]);
        expect(second.nextBeforeVersion).toBeNull();
        expect(
          ApplicationTermsInput.safeParse({ ...offer(), revenueShareBp: 5001 })
            .success,
        ).toBe(false);
      });

      it('allows rejection without confirmation but prevents later acceptance', async () => {
        await terms.propose(appId, owner, offer());
        await applications.reject(appId, owner);
        await expect(terms.confirm(appId, worker, 1)).rejects.toThrow(
          'no longer pending',
        );
      });
    });

    it('recruits an existing member into another role once and preserves primary membership', async () => {
      const extra = await db.crewPosition.create({
        data: {
          id: randomUUID(),
          crewId,
          positionType: 'editor',
          description: 'Additional work',
          targetCount: 2,
        },
      });
      const application = await applications.apply(
        crewId,
        extra.id,
        worker,
        {},
      );
      await confirmFixtureOffer(application.id);
      const results = await Promise.allSettled([
        applications.approve(application.id, owner),
        applications.approve(application.id, owner),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        await db.crewMember.count({
          where: { crewId, userId: worker, removedAt: null },
        }),
      ).toBe(1);
      const roles = await db.crewMemberPosition.findMany({
        where: { memberId: workerMemberId },
      });
      expect(roles).toHaveLength(2);
      expect(
        roles.find((role) => role.sourcePositionId === positionId)?.isPrimary,
      ).toBe(true);
      expect(
        roles.find((role) => role.sourcePositionId === extra.id)?.isPrimary,
      ).toBe(false);
      expect(
        (await db.crewPosition.findUniqueOrThrow({ where: { id: extra.id } }))
          .recruitedCount,
      ).toBe(1);
      await expect(
        applications.apply(crewId, extra.id, worker, {}),
      ).rejects.toThrow('already hold');
      await members.remove(crewId, workerMemberId, owner);
      expect(
        (await db.crewPosition.findUniqueOrThrow({ where: { id: extra.id } }))
          .recruitedCount,
      ).toBe(0);
    });

    it('rejects membership suspended after application without consuming capacity', async () => {
      const extra = await db.crewPosition.create({
        data: {
          id: randomUUID(),
          crewId,
          positionType: 'editor',
          description: 'Additional work',
          targetCount: 1,
        },
      });
      const application = await applications.apply(
        crewId,
        extra.id,
        worker,
        {},
      );
      await confirmFixtureOffer(application.id);
      await db.crewMember.update({
        where: { id: workerMemberId },
        data: { status: 'suspended', suspendedAt: new Date() },
      });
      await expect(applications.approve(application.id, owner)).rejects.toThrow(
        'active membership',
      );
      expect(
        (
          await db.crewApplication.findUniqueOrThrow({
            where: { id: application.id },
          })
        ).status,
      ).toBe('pending');
      expect(
        (await db.crewPosition.findUniqueOrThrow({ where: { id: extra.id } }))
          .recruitedCount,
      ).toBe(0);
      await expect(
        applications.apply(crewId, extra.id, worker, {}),
      ).rejects.toThrow('Suspended');
      expect(
        await db.crewMemberPosition.count({
          where: { memberId: workerMemberId },
        }),
      ).toBe(1);
    });

    it('rechecks current Java qualifications at approval and rejects changed requirements atomically', async () => {
      const candidate = String(Date.now());
      const previousCatalog = process.env.CREW_QUALIFICATION_CATALOG_JSON;
      process.env.CREW_QUALIFICATION_CATALOG_JSON = JSON.stringify({
        fdLevels: [1, 2, 3, 4, 5].map((rank) => ({ id: 100 + rank, rank })),
        skills: { editing: [901] },
      });
      const qualified = () =>
        ({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 200,
              info: { id: candidate },
              level: [
                { id: 103, type: 1 },
                { id: 901, type: 4 },
              ],
            }),
        }) as Response;
      const lookup = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(qualified());
      try {
        const position = await db.crewPosition.create({
          data: {
            id: randomUUID(),
            crewId,
            positionType: 'editor',
            description: 'Qualified work',
            targetCount: 1,
            experienceLevel: 'mid',
            requiredSkills: ['editing'],
          },
        });
        const application = await applications.apply(
          crewId,
          position.id,
          candidate,
          {},
          'candidate-session',
        );
        await confirmFixtureOffer(application.id);
        lookup.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              code: 200,
              info: { id: candidate },
              level: [{ id: 103, type: 1 }],
            }),
        } as Response);
        await expect(
          applications.approve(application.id, owner, 'reviewer-session'),
        ).rejects.toMatchObject({ status: 403 });
        expect(
          (
            await db.crewApplication.findUniqueOrThrow({
              where: { id: application.id },
            })
          ).status,
        ).toBe('pending');
        expect(
          (
            await db.crewPosition.findUniqueOrThrow({
              where: { id: position.id },
            })
          ).recruitedCount,
        ).toBe(0);
        lookup.mockImplementationOnce(async () => {
          await db.crewPosition.update({
            where: { id: position.id },
            data: { experienceLevel: 'master' },
          });
          return qualified();
        });
        await expect(
          applications.approve(application.id, owner, 'reviewer-session'),
        ).rejects.toThrow('qualifications changed');
        expect(
          (
            await db.crewApplication.findUniqueOrThrow({
              where: { id: application.id },
            })
          ).status,
        ).toBe('pending');
        expect(
          (
            await db.crewPosition.findUniqueOrThrow({
              where: { id: position.id },
            })
          ).recruitedCount,
        ).toBe(0);
        expect(
          await db.crewMember.count({ where: { crewId, userId: candidate } }),
        ).toBe(0);
        expect(
          lookup.mock.calls.every(
            ([url]) =>
              typeof url === 'string' && url.includes(`UserId=${candidate}`),
          ),
        ).toBe(true);
      } finally {
        lookup.mockRestore();
        if (previousCatalog === undefined)
          delete process.env.CREW_QUALIFICATION_CATALOG_JSON;
        else process.env.CREW_QUALIFICATION_CATALOG_JSON = previousCatalog;
      }
    });

    it('initializes a single workspace with an empty account under concurrent requests', async () => {
      const service = new CrewStudioWorkspaceService(
        db as never,
        authorization,

        { revoke: jest.fn().mockResolvedValue(undefined) } as never,
      );
      const results = await Promise.all([
        service.initialize(crewId, owner),
        service.initialize(crewId, owner),
      ]);
      expect(results.map((result) => result.created).sort()).toEqual([
        false,
        true,
      ]);
      expect(results[0].studioWorkspace.id).toBe(results[1].studioWorkspace.id);
      const workspaceId = results[0].studioWorkspace.id;
      expect(
        await db.workspaceMember.count({
          where: {
            workspaceId,
            userId: owner,
            role: 'owner',
            status: 'active',
          },
        }),
      ).toBe(1);
      const wallet = await db.walletAccount.findFirstOrThrow({
        where: {
          ownerId: workspaceId,
          ownerType: 'workspace',
          currency: 'compute_point',
          balanceKind: 'consumable',
        },
      });
      expect(wallet.availableBalance).toBe(0n);
    });

    it.each(['series', 'interactive_film'] as const)(
      'preserves existing %s work and ownership during workspace initialization',
      async (productionKind) => {
        await db.crew.update({
          where: { id: crewId },
          data: { productionKind },
        });
        const task = await tasks.create(
          crewId,
          owner,
          CreateCrewTaskSchema.parse({
            ...{
              description: 'Deliver reviewable work',
              taskKind: 'script',
              dueAt: '2099-10-03T00:00:00.000Z',
              rewardUsdMinor: 0,
            },
            title: 'Existing production task',
            assignees: [{ userId: worker, currency: crewCurrency() }],
          }),
        );
        const folder = await assets.createFolder(crewId, owner, {
          name: 'Existing production assets',
        });
        const before = await db.crewTask.findUniqueOrThrow({
          where: { id: task.id },
          include: { assignees: true },
        });
        const ownership = await db.crewOwnership.findUniqueOrThrow({
          where: { crewId },
        });
        const service = new CrewStudioWorkspaceService(
          db as never,
          authorization,

          { revoke: jest.fn().mockResolvedValue(undefined) } as never,
        );
        await expect(service.initialize(crewId, worker)).rejects.toThrow();
        expect(
          (await db.crew.findUniqueOrThrow({ where: { id: crewId } }))
            .studioWorkspaceId,
        ).toBeNull();
        const workspaceCount = await db.workspace.count({
          where: { createdById: owner },
        });
        const initialized = await service.initialize(crewId, owner);
        expect(initialized.created).toBe(true);
        expect(await service.initialize(crewId, owner)).toEqual({
          ...initialized,
          created: false,
        });
        expect(
          await db.crewTask.findUniqueOrThrow({
            where: { id: task.id },
            include: { assignees: true },
          }),
        ).toEqual(before);
        expect(
          await db.crewOwnership.findUniqueOrThrow({ where: { crewId } }),
        ).toEqual(ownership);
        expect(
          await db.crewAssetNode.findUniqueOrThrow({
            where: { id: folder.id },
          }),
        ).toMatchObject({
          name: 'Existing production assets',
          status: 'active',
        });
        expect(
          (await db.crew.findUniqueOrThrow({ where: { id: crewId } }))
            .productionKind,
        ).toBe(productionKind);
        expect(
          await db.crewProductionActivity.count({ where: { crewId } }),
        ).toBe(1);
        await db.workspace.update({
          where: { id: initialized.studioWorkspace.id },
          data: { deletedAt: new Date() },
        });
        await expect(service.initialize(crewId, owner)).rejects.toThrow(
          'linked workspace is unavailable',
        );
        expect(
          (await db.crew.findUniqueOrThrow({ where: { id: crewId } }))
            .studioWorkspaceId,
        ).toBe(initialized.studioWorkspace.id);
        expect(
          await db.workspace.count({ where: { createdById: owner } }),
        ).toBe(workspaceCount + 1);
      },
    );

    it('pins a delivery revision, validates submission and preserves the original form after catalog edits', async () => {
      const categoryId = randomUUID();
      const definition = {
        name: 'Professional fixture',
        description: '',
        status: 'active',
        prices: [],
        fields: [
          {
            key: 'summary',
            label: 'Summary',
            instructions: 'Describe delivery',
            type: 'text',
            required: true,
          },
        ],
      };
      const task = await tasks.create(
        crewId,
        owner,
        CreateCrewTaskSchema.parse({
          ...{
            description: 'Deliver reviewable work',
            taskKind: 'script',
            dueAt: '2099-10-03T00:00:00.000Z',
            rewardUsdMinor: 0,
          },
          title: 'Professional task',
          assignees: [{ userId: worker, currency: 'USD' }],
        }),
      );
      try {
        await db.$executeRaw`INSERT INTO crew_delivery_catalog_revisions(category_id,version,definition,created_by,reason) VALUES (${categoryId}::uuid,1,${JSON.stringify(definition)}::jsonb,${randomUUID()}::uuid,'fixture')`;
        await expect(
          tasks.setDeliveryTemplate(task.id, worker, {
            expectedVersion: task.version,
            category: { id: categoryId, version: 1 },
          }),
        ).rejects.toThrow();
        await tasks.setDeliveryTemplate(task.id, owner, {
          expectedVersion: task.version,
          category: { id: categoryId, version: 1 },
        });
        await expect(
          tasks.setDeliveryTemplate(task.id, owner, {
            expectedVersion: task.version,
            category: null,
          }),
        ).rejects.toThrow('Task changed');
        await db.$executeRaw`INSERT INTO crew_delivery_catalog_revisions(category_id,version,definition,created_by,reason) VALUES (${categoryId}::uuid,2,${JSON.stringify({ ...definition, status: 'archived', name: 'Archived definition' })}::jsonb,${randomUUID()}::uuid,'fixture archive')`;
        expect(
          (await tasks.getDeliveryTemplate(task.id, worker))?.version,
        ).toBe(1);
        await expect(
          tasks.submit(task.id, worker, { note: '', assetNodeIds: [] }),
        ).rejects.toThrow('template');
        await expect(
          tasks.submit(task.id, worker, {
            note: '',
            assetNodeIds: [],
            professionalDelivery: { categoryId, version: 1, answers: {} },
          }),
        ).rejects.toThrow('Summary');
        expect(
          await db.crewTaskSubmission.count({ where: { taskId: task.id } }),
        ).toBe(0);
        const result = await tasks.submit(task.id, worker, {
          note: '',
          assetNodeIds: [],
          professionalDelivery: {
            categoryId,
            version: 1,
            answers: { summary: 'Original configured form' },
          },
        });
        expect(result.submissions[0].professionalDelivery).toMatchObject({
          categoryId,
          version: 1,
          definition: { name: 'Professional fixture' },
          answers: { summary: 'Original configured form' },
        });
      } finally {
        await db.$executeRaw`DELETE FROM crew_task_delivery_templates WHERE task_id=${task.id}::uuid`;
        await db.$executeRaw`DELETE FROM crew_delivery_catalog_revisions WHERE category_id=${categoryId}::uuid`;
      }
    });

    it('joins a public fan community idempotently without granting production membership', async () => {
      const fan = `fan-${randomUUID()}`;
      await db.crew.update({
        where: { id: crewId },
        data: { listingStatus: 'listed' },
      });
      await crews.block(crewId, `blocked-${fan}`);
      await expect(
        crews.joinFanCommunity(crewId, `blocked-${fan}`),
      ).rejects.toThrow('Crew not found');
      const failingFan = `failed-${randomUUID()}`;
      const failedJoin = jest
        .spyOn(conversations, 'joinCrewCommunityConversation')
        .mockRejectedValueOnce(new Error('Community temporarily unavailable'));
      await expect(
        crews.joinFanCommunity(crewId, failingFan, true),
      ).rejects.toThrow('Community temporarily unavailable');
      failedJoin.mockRestore();
      expect(
        await db.$queryRaw`SELECT user_id FROM crew_likes WHERE crew_id = ${crewId} AND user_id = ${failingFan}`,
      ).toEqual([]);
      const first = await crews.joinFanCommunity(crewId, fan);
      expect(
        await db.$queryRaw`SELECT user_id FROM crew_likes WHERE crew_id = ${crewId} AND user_id = ${fan}`,
      ).toEqual([]);
      await expect(crews.joinFanCommunity(crewId, fan, true)).rejects.toThrow(
        'Link an IP',
      );
      expect(
        await db.$queryRaw`SELECT user_id FROM crew_likes WHERE crew_id = ${crewId} AND user_id = ${fan}`,
      ).toEqual([]);
      expect(await crews.joinFanCommunity(crewId, fan)).toEqual(first);
      expect(
        await db.crewMember.count({ where: { crewId, userId: fan } }),
      ).toBe(0);
      expect(
        await db.conversationParticipant.count({
          where: {
            conversationId: first.conversationId,
            userId: fan,
            leftAt: null,
          },
        }),
      ).toBe(1);
      expect((await crews.communityConversation(crewId, fan)).id).toBe(
        first.conversationId,
      );
      await expect(crews.conversation(crewId, fan)).rejects.toThrow();
      await db.crew.update({
        where: { id: crewId },
        data: { listingStatus: 'unlisted' },
      });
      await expect(
        crews.joinFanCommunity(crewId, `hidden-${fan}`),
      ).rejects.toThrow('Crew not found');
      await db.crew.update({
        where: { id: crewId },
        data: { listingStatus: 'listed', moderationStatus: 'taken_down' },
      });
      await expect(
        crews.joinFanCommunity(crewId, `moderated-${fan}`),
      ).rejects.toThrow('Crew not found');
    });

    it('delivers explicitly imported Studio media through revision and approval without replacing the original', async () => {
      const workspace = await db.workspace.create({
        data: {
          name: 'Delivery journey',
          ownerUserId: owner,
          createdById: owner,
          members: { create: { userId: owner, role: 'owner' } },
        },
      });
      await db.crew.update({
        where: { id: crewId },
        data: { studioWorkspaceId: workspace.id },
      });
      const studioAssets = new CrewAssetsService(
        db as never,
        new WorkspacePermissionService(db as never),
        authorization,
        access,
        {} as never,
        {} as never,
        conversations,
      );
      const media = await db.mediaAsset.create({
        data: {
          workspaceId: workspace.id,
          kind: 'image',
          storageProvider: 'external_url',
          externalUrl: `https://example.invalid/${crewId}/delivery.png`,
          contentType: 'image/png',
          createdByUserId: owner,
          visibility: 'private',
        },
      });
      const folder = await assets.createFolder(crewId, owner, {
        name: 'Imported source',
      });
      await assets.setPermissions(crewId, owner, folder.id, {
        accessMode: 'restricted',
        expectedVersion: 1,
        grants: [{ userId: worker, permission: 'view' }],
      });
      const imported = await studioAssets.linkStudioMedia(crewId, owner, {
        parentId: folder.id,
        mediaAssetIds: [media.id],
      });
      expect(imported.items).toHaveLength(1);
      const fileId = imported.items[0].id;
      // Active production members now inherit Studio viewing. Explicitly revoke
      // that grant to exercise delivery via the independently shared Crew asset.
      await db.crewMemberPermissionOverride.create({
        data: {
          memberId: workerMemberId,
          permissionKey: 'studio.view',
          effect: 'deny',
          changedByUserId: owner,
        },
      });
      await expect(
        studioAssets.listStudioMediaOptions(crewId, worker, {}),
      ).rejects.toThrow();
      expect(await access.resolveNodePermission(crewId, fileId, worker)).toBe(
        'view',
      );
      expect(
        await access.resolveNodePermission(crewId, fileId, finance),
      ).toBeNull();
      const task = await tasks.create(
        crewId,
        owner,
        CreateCrewTaskSchema.parse({
          ...{
            description: 'Deliver reviewable work',
            taskKind: 'script',
            dueAt: '2099-10-03T00:00:00.000Z',
            rewardUsdMinor: 0,
          },
          title: 'Deliver Studio import',
          revisionLimit: 1,
          assignees: [{ userId: worker, currency: crewCurrency() }],
        }),
      );
      await expect(
        tasks.submit(task.id, finance, {
          note: 'Unauthorized',
          assetNodeIds: [fileId],
        }),
      ).rejects.toThrow();
      await tasks.submit(task.id, worker, {
        note: 'Imported reference',
        assetNodeIds: [fileId],
      });
      const first = await db.crewTaskSubmission.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: { versionNumber: 'desc' },
      });
      expect(
        await db.crewTaskDeliveryAsset.count({ where: { taskId: task.id } }),
      ).toBe(0);
      await tasks.review(task.id, owner, {
        expectedSubmissionId: first.id,
        decision: 'request_revision',
        note: 'Clarify delivery notes',
      });
      await tasks.submit(task.id, worker, {
        note: 'Clarified delivery notes',
        assetNodeIds: [fileId],
      });
      const final = await db.crewTaskSubmission.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: { versionNumber: 'desc' },
      });
      await tasks.review(task.id, owner, {
        expectedSubmissionId: final.id,
        decision: 'approve',
        note: 'Accepted',
      });
      expect(
        await db.crewTaskDeliveryAsset.findMany({ where: { taskId: task.id } }),
      ).toHaveLength(1);
      expect(
        await db.crewTaskDeliveryAsset.findFirstOrThrow({
          where: { taskId: task.id },
        }),
      ).toMatchObject({ assetNodeId: fileId });
      await studioAssets.setStudioLink(crewId, owner, fileId, {
        mediaAssetId: null,
      });
      expect(
        await db.crewAssetNode.findUniqueOrThrow({ where: { id: fileId } }),
      ).toMatchObject({
        parentId: folder.id,
        mediaAssetId: media.id,
        sharedFromStudio: true,
        linkedStudioMediaAssetId: null,
      });
      expect(
        await db.crewTaskSubmission.count({ where: { taskId: task.id } }),
      ).toBe(2);
      expect(
        await db.crewTaskDeliveryAsset.count({
          where: { taskId: task.id, assetNodeId: fileId },
        }),
      ).toBe(1);
      expect(
        await access.resolveNodePermission(crewId, fileId, finance),
      ).toBeNull();
      expect(
        await db.mediaAsset.findUniqueOrThrow({ where: { id: media.id } }),
      ).toMatchObject({ deletedAt: null, status: 'ready' });
    });

    it('recruits, edits roles, shares a restricted asset, reviews revisions, pays and revokes access', async () => {
      await expect(
        authorization.require(crewId, finance, 'tasks.manage'),
      ).rejects.toThrow();
      await members.update(crewId, workerMemberId, owner, {
        expectedVersion: 1,
        positions: [{ categoryKey: 'animator', title: 'Lead animator' }],
      });
      expect(
        await db.crewMemberPosition.findFirst({
          where: { memberId: workerMemberId },
        }),
      ).toMatchObject({ sourcePositionId: positionId });
      const folder = await assets.createFolder(crewId, owner, {
        name: 'Review materials',
      });
      await assets.setPermissions(crewId, owner, folder.id, {
        accessMode: 'restricted',
        expectedVersion: 1,
        grants: [{ userId: worker, permission: 'view' }],
      });
      const media = await db.mediaAsset.create({
        data: {
          kind: 'image',
          storageProvider: 'external_url',
          externalUrl: `https://assets.invalid/${crewId}/frame.png`,
          createdByUserId: owner,
        },
      });
      const file = await db.crewAssetNode.create({
        data: {
          crewId,
          parentId: folder.id,
          kind: 'file',
          name: 'frame.png',
          mediaAssetId: media.id,
          updatedByUserId: owner,
          createdByUserId: owner,
        },
      });
      expect(
        await access.resolveNodePermission(crewId, file.id, finance),
      ).toBeNull();
      expect(await access.resolveNodePermission(crewId, file.id, worker)).toBe(
        'view',
      );
      const label = await db.crewTaskLabel.create({
        data: {
          crewId,
          name: 'Delivery',
          color: '#888888',
          createdByUserId: owner,
        },
      });
      const task = await tasks.create(
        crewId,
        owner,
        CreateCrewTaskSchema.parse({
          ...{
            description: 'Deliver reviewable work',
            taskKind: 'script',
            dueAt: '2099-10-03T00:00:00.000Z',
            rewardUsdMinor: 0,
          },
          title: 'Deliver animation',
          dueAt: '2100-01-01T00:00:00.000Z',
          labelIds: [label.id],
          revisionLimit: 2,
          assignees: [
            { userId: worker, currency: 'USD', rewardAmountMinor: 1000 },
            { userId: owner, currency: 'USD' },
          ],
        }),
      );
      expect(task.labels.map((item) => item.id)).toContain(label.id);
      await expect(
        tasks.submit(task.id, finance, {
          note: 'Unauthorized',
          assetNodeIds: [],
        }),
      ).rejects.toThrow();
      await tasks.submit(task.id, worker, {
        note: 'First delivery',
        assetNodeIds: [file.id],
      });
      const [delivery] = await db.$queryRaw<Array<{ folderId: string }>>`
        SELECT folder_id AS "folderId" FROM crew_task_delivery_folders WHERE task_id = ${task.id}::uuid
      `;
      expect(delivery).toBeDefined();
      expect(
        (
          await assets.list(crewId, worker, {
            source: 'all',
            sort: 'name',
            parentId: delivery.folderId,
          })
        ).items,
      ).toHaveLength(0);
      await tasks.review(task.id, owner, {
        expectedSubmissionId: (
          await db.crewTaskSubmission.findFirstOrThrow({
            where: { taskId: task.id },
            orderBy: { versionNumber: 'desc' },
          })
        ).id,
        decision: 'request_revision',
        note: 'Adjust timing',
      });
      await tasks.submit(task.id, worker, {
        note: 'Timing adjusted',
        assetNodeIds: [file.id],
      });
      await db.crewTask.update({
        where: { id: task.id },
        data: { dueAt: new Date('2000-01-01T00:00:00.000Z') },
      });
      await tasks.review(task.id, owner, {
        expectedSubmissionId: (
          await db.crewTaskSubmission.findFirstOrThrow({
            where: { taskId: task.id },
            orderBy: { versionNumber: 'desc' },
          })
        ).id,
        decision: 'approve',
        note: 'Accepted',
      });
      const feedback = new CrewTaskFeedbackService(db as never, authorization);
      const reviewInput = {
        subjectUserId: worker,
        ratings: {
          direction: 'creator' as const,
          productionAbility: 4,
          understanding: 5,
          communication: 4,
        },
        comment: 'Delivered the agreed revision.',
      };
      const reviews = await Promise.all([
        feedback.submit(task.id, owner, reviewInput),
        feedback.submit(task.id, owner, reviewInput),
      ]);
      expect(reviews[0].id).toBe(reviews[1].id);
      expect(
        await db.crewTaskFeedback.count({ where: { taskId: task.id } }),
      ).toBe(1);
      await expect(
        feedback.submit(task.id, finance, reviewInput),
      ).rejects.toThrow();
      await feedback.respond(reviews[0].id, worker, {
        response: 'Thank you for the detailed review.',
      });
      expect(
        (await feedback.list(task.id, worker, { limit: 20 })).items[0].response,
      ).toBe('Thank you for the detailed review.');
      expect(
        (await feedback.list(task.id, finance, { limit: 20 })).items,
      ).toEqual([]);
      expect(
        (await feedback.listMine(owner, { limit: 1 })).items.map(
          (row) => row.id,
        ),
      ).toContain(reviews[0].id);
      await expect(
        feedback.list(task.id, finance, { limit: 20, cursor: reviews[0].id }),
      ).rejects.toThrow();
      await expect(
        feedback.listMine(finance, { limit: 20, cursor: reviews[0].id }),
      ).rejects.toThrow();
      const feedbackAppeals = new CrewTaskFeedbackAppealsService(
        db as never,
        new CrewTaskDisputesService(db as never, notifications as never),
      );
      const feedbackAppealInput = {
        id: randomUUID(),
        reason: 'Please review the communication rating.',
      };
      await expect(
        feedbackAppeals.open(reviews[0].id, finance, feedbackAppealInput),
      ).rejects.toThrow();
      await expect(
        feedbackAppeals.open(reviews[0].id, owner, feedbackAppealInput),
      ).rejects.toThrow();
      const feedbackCases = await Promise.all([
        feedbackAppeals.open(reviews[0].id, worker, feedbackAppealInput),
        feedbackAppeals.open(reviews[0].id, worker, feedbackAppealInput),
      ]);
      expect(feedbackCases[0].dispute.id).toBe(feedbackCases[1].dispute.id);
      const feedbackEvent = await db.crewTaskDisputeEvent.findFirstOrThrow({
        where: { disputeId: feedbackAppealInput.id, version: 1 },
      });
      expect(feedbackEvent.message).toContain(reviews[0].id);
      expect(feedbackEvent.message).toContain(reviewInput.comment);
      expect(feedbackEvent.submissionIds).toEqual([reviews[0].submissionId]);
      await expect(
        feedbackAppeals.open(reviews[0].id, worker, {
          ...feedbackAppealInput,
          reason: 'Changed reason',
        }),
      ).rejects.toThrow();
      await expect(
        feedbackAppeals.open(reviews[0].id, worker, {
          ...feedbackAppealInput,
          id: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(
        (
          await db.crewTaskFeedback.findUniqueOrThrow({
            where: { id: reviews[0].id },
          })
        ).ratings,
      ).toEqual(reviewInput.ratings);
      const evidenceRows = await db.$queryRaw<
        {
          evidence: { deadline: string; assigneeUserIds: string[] };
          result: { points: number } | null;
        }[]
      >`
        SELECT timeliness_evidence AS evidence, timeliness_result AS result FROM crew_task_submissions WHERE task_id=${task.id}::uuid ORDER BY version_number`;
      expect(evidenceRows[0].result).toBeNull();
      expect(evidenceRows[1].evidence.deadline).toBe(
        '2100-01-01T00:00:00.000Z',
      );
      expect(evidenceRows[1].evidence.assigneeUserIds).toEqual(
        [worker, owner].sort(),
      );
      expect(evidenceRows[1].result?.points).toBe(200);
      const approvedSubmission = await db.crewTaskSubmission.findFirstOrThrow({
        where: { taskId: task.id },
        orderBy: { versionNumber: 'desc' },
      });
      await db.$transaction((tx) =>
        postApprovedTaskTrustTx(tx, approvedSubmission.id),
      );
      const trust = await db.$queryRaw<
        { userId: string; points: number }[]
      >`SELECT user_id AS "userId",points FROM crew_creator_trust_entries WHERE task_id=${task.id}::uuid`;
      expect(trust).toEqual(
        expect.arrayContaining([
          { userId: worker, points: 200 },
          { userId: owner, points: 200 },
        ]),
      );
      expect(trust).toHaveLength(2);
      const trustReader = new CreatorTrustController(db as never);
      const history = await trustReader.entries(
        { userId: worker },
        { limit: 1 },
      );
      expect(history.items).toHaveLength(1);
      expect(history.items[0]).toMatchObject({
        taskId: task.id,
        points: 200,
        deadline: '2100-01-01T00:00:00.000Z',
      });
      expect(history.nextCursor).toBeNull();
      expect(
        (
          await trustReader.entries(
            { userId: worker },
            { limit: 1, cursor: task.id },
          )
        ).items,
      ).toEqual([]);
      await expect(
        trustReader.entries({ userId: finance }, { limit: 1, cursor: task.id }),
      ).rejects.toThrow('cursor');
      expect(
        (await trustReader.entries({ userId: finance }, { limit: 20 })).items,
      ).toEqual([]);
      expect((await trustReader.read({ userId: worker }, {})).points).toBe(
        '200',
      );
      expect((await trustReader.read({ userId: finance }, {})).points).toBe(
        '0',
      );

      const appeals = new CrewTrustAppealService(db as never, authorization);
      const appealInput = {
        id: randomUUID(),
        reason: 'The timing classification is incorrect',
      };
      const [firstAppeal, replayAppeal] = await Promise.all([
        appeals.submit(task.id, worker, appealInput),
        appeals.submit(task.id, worker, appealInput),
      ]);
      expect(firstAppeal.id).toBe(replayAppeal.id);
      await expect(
        appeals.submit(task.id, finance, {
          id: randomUUID(),
          reason: 'Not my entry',
        }),
      ).rejects.toThrow('Trust entry not found');
      await expect(
        appeals.submit(task.id, worker, {
          id: randomUUID(),
          reason: 'Duplicate pending',
        }),
      ).rejects.toThrow('already pending');
      await expect(appeals.list(finance, { taskId: task.id })).rejects.toThrow(
        'Trust entry not found',
      );
      const secondAppeal = await appeals.submit(task.id, owner, {
        id: randomUUID(),
        reason: 'Shared evidence issue',
      });
      const queue = await appeals.list(owner, { crewId });
      expect(queue.items.map((a) => a.id)).toEqual(
        expect.arrayContaining([firstAppeal.id, secondAppeal.id]),
      );
      const decision = {
        decision: 'corrected' as const,
        points: -200 as const,
        reason: 'Verified late submission against agreed delivery evidence',
        expectedCorrectionId: null,
      };
      await expect(
        appeals.review(crewId, firstAppeal.id, worker, decision),
      ).rejects.toThrow();
      const reviewed = await appeals.review(
        crewId,
        firstAppeal.id,
        owner,
        decision,
      );
      expect(reviewed.status).toBe('corrected');
      expect(
        await appeals.review(crewId, firstAppeal.id, owner, decision),
      ).toEqual(reviewed);
      expect((await trustReader.read({ userId: worker }, {})).points).toBe(
        '-200',
      );
      expect((await trustReader.read({ userId: owner }, {})).points).toBe(
        '-200',
      );
      const correctedHistory = await trustReader.entries(
        { userId: worker },
        { limit: 20 },
      );
      expect(correctedHistory.items[0]).toMatchObject({
        originalPoints: 200,
        points: -200,
        deadline: '2100-01-01T00:00:00.000Z',
        correctionReason: decision.reason,
      });
      await expect(
        appeals.review(crewId, secondAppeal.id, owner, decision),
      ).rejects.toThrow('Trust evidence changed');
      await expect(
        appeals.review(crewId, firstAppeal.id, owner, {
          ...decision,
          points: 200,
        }),
      ).rejects.toThrow('already been reviewed');
      await appeals.review(crewId, secondAppeal.id, owner, {
        decision: 'upheld',
        reason: 'Current corrected result is confirmed',
        expectedCorrectionId: reviewed.correctionId,
      });
      const rollbackAppeal = await appeals.submit(task.id, worker, {
        id: randomUUID(),
        reason: 'Further evidence',
      });
      const unmockedAuthorization = new CrewAuthorizationService(db as never);
      let checks = 0;
      const recheck = jest
        .spyOn(authorization, 'require')
        .mockImplementation((...args) => {
          checks++;
          if (checks === 4)
            return Promise.reject(
              new Error('Permission withdrawn before commit'),
            );
          return unmockedAuthorization.require(...args);
        });
      try {
        await expect(
          appeals.review(crewId, rollbackAppeal.id, owner, {
            ...decision,
            points: 200,
            expectedCorrectionId: reviewed.correctionId,
          }),
        ).rejects.toThrow('Permission withdrawn');
      } finally {
        recheck.mockRestore();
      }
      expect((await trustReader.read({ userId: worker }, {})).points).toBe(
        '-200',
      );
      expect(
        (await appeals.list(worker, { taskId: task.id })).items.find(
          (a) => a.id === rollbackAppeal.id,
        )?.status,
      ).toBe('pending');
      await appeals.review(crewId, rollbackAppeal.id, owner, {
        decision: 'upheld',
        reason: 'Current correction stands',
        expectedCorrectionId: reviewed.correctionId,
      });
      expect((await appeals.list(owner, { crewId })).items).toHaveLength(0);
      expect(
        (await appeals.list(worker, { taskId: task.id })).items.find(
          (a) => a.id === firstAppeal.id,
        )?.status,
      ).toBe('corrected');
      expect(
        await db.$queryRaw`SELECT points FROM crew_creator_trust_entries WHERE task_id=${task.id}::uuid`,
      ).toEqual([{ points: 200 }, { points: 200 }]);
      // A newer decision remains authoritative even if its wall clock is earlier.
      const backdatedCorrection = randomUUID();
      await db.$executeRaw`INSERT INTO crew_trust_corrections(id,submission_id,points,reviewer_id,reason,created_at) VALUES(${backdatedCorrection}::uuid,${approvedSubmission.id}::uuid,200,${owner},'Clock-order fixture','2000-01-01T00:00:00Z'::timestamptz)`;
      expect((await trustReader.read({ userId: worker }, {})).points).toBe(
        '200',
      );
      expect((await trustReader.read({ userId: owner }, {})).points).toBe(
        '200',
      );
      expect(
        (await appeals.list(owner, { crewId, history: true })).items,
      ).toHaveLength(3);

      await expect(
        tasks.review(task.id, owner, {
          decision: 'approve',
          note: '',
          expectedSubmissionId: approvedSubmission.id,
        }),
      ).rejects.toThrow();
      expect(
        (
          await assets.list(crewId, worker, {
            source: 'all',
            sort: 'name',
            parentId: delivery.folderId,
          })
        ).items.map((item) => item.id),
      ).toContain(file.id);
      expect(
        (
          await assets.list(crewId, finance, {
            source: 'all',
            sort: 'name',
            parentId: delivery.folderId,
          })
        ).items.map((item) => item.id),
      ).not.toContain(file.id);
      expect(
        (await db.crewAssetNode.findUniqueOrThrow({ where: { id: file.id } }))
          .parentId,
      ).toBe(folder.id);
      const reward = await db.crewEarningEntry.findFirstOrThrow({
        where: { crewId, userId: worker },
      });
      expect(reward).toMatchObject({ amountMinor: 1000n, status: 'posted' });
      expect(
        await db.crewEarningEntry.count({ where: { crewId, userId: worker } }),
      ).toBe(1);
      await expect(
        payouts.create(crewId, worker, {
          crewMemberId: workerMemberId,
          currency: 'USD',
          amountMinor: '1000',
          withholdingAmountMinor: '0',
          idempotencyKey: 'unauthorized',
        }),
      ).rejects.toThrow();
      const payout = await payouts.create(crewId, finance, {
        crewMemberId: workerMemberId,
        currency: 'USD',
        amountMinor: '1000',
        withholdingAmountMinor: '0',
        idempotencyKey: 'workflow-payout',
      });
      await payouts.pay(payout.id, finance, {
        expectedVersion: 1,
        paymentMethod: 'bank_transfer',
        paymentReference: 'LOCAL-TEST-RECEIPT',
      });
      await expect(
        earnings.reverse(reward.id, finance, {
          expectedVersion: reward.version,
          reason: 'Cannot reverse paid work',
        }),
      ).rejects.toThrow();
      const chat = await conversations.openCrewConversation(crewId);
      expect(
        await db.conversationParticipant.findFirst({
          where: { conversationId: chat.id, userId: worker },
        }),
      ).toMatchObject({ leftAt: null });
      await members.remove(crewId, workerMemberId, owner);
      expect(await authorization.resolve(crewId, worker)).toBeNull();
      expect(
        (await feedbackAppeals.open(reviews[0].id, worker, feedbackAppealInput))
          .dispute.id,
      ).toBe(feedbackAppealInput.id);

      expect(
        (await feedback.listMine(worker, { limit: 20 })).items.map(
          (row) => row.id,
        ),
      ).toContain(reviews[0].id);
      await expect(
        feedback.list(task.id, worker, { limit: 20 }),
      ).rejects.toThrow();

      const ownPayouts = await payouts.listMine(worker, {
        currency: 'USD',
        limit: 50,
      });
      expect(ownPayouts.items.map((item) => item.id)).toContain(payout.id);
      expect(ownPayouts.summary.byStatus).toContainEqual({
        status: 'paid',
        count: 1,
        amountMinor: '1000',
        netAmountMinor: '1000',
      });
      expect(
        (await payouts.listMine(finance, { currency: 'USD', limit: 50 })).items,
      ).toHaveLength(0);
      const ownIncome = await earnings.listMine(worker, {
        currency: 'USD',
        limit: 50,
      });
      expect(ownIncome.items.map((item) => item.id)).toContain(reward.id);
      expect(ownIncome.summary.byStatus.posted.amountMinor).toBe('1000');
      const otherIncome = await earnings.listMine(finance, {
        currency: 'USD',
        limit: 50,
      });
      expect(otherIncome.items.map((item) => item.id)).not.toContain(reward.id);

      expect(
        await access.resolveNodePermission(crewId, file.id, worker),
      ).toBeNull();
      await expect(tasks.get(task.id, worker)).rejects.toThrow();
      expect(
        await db.crewAssetGrant.count({
          where: { userId: worker, node: { crewId } },
        }),
      ).toBe(0);
      expect(
        await db.workspaceMember.count({
          where: {
            userId: worker,
            status: 'active',
            workspace: { crew: { id: crewId } },
          },
        }),
      ).toBe(0);
      expect(
        (
          await db.conversationParticipant.findFirstOrThrow({
            where: { conversationId: chat.id, userId: worker },
          })
        ).leftAt,
      ).not.toBeNull();
      expect(
        await db.crewPosition.findUnique({ where: { id: positionId } }),
      ).toMatchObject({ recruitedCount: 0, status: 'open' });
      await db.$transaction((tx) =>
        joinCrewInTransaction(
          tx,
          { conversations, collaboration },
          {
            crewId,
            userId: worker,
            policyKeys: [],
            grantedByUserId: owner,
            action: 'invitation.accepted',
          },
        ),
      );
      expect(
        await access.resolveNodePermission(crewId, file.id, worker),
      ).toBeNull();
    });

    it('allows only the current owner to win simultaneous transfers', async () => {
      const outcomes = await Promise.allSettled(
        [worker, finance].map((target) =>
          crews.transferOwnership(crewId, target, {
            actor: { type: 'member', userId: owner },
            requireTargetActiveMember: true,
          }),
        ),
      );
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const current = await authorization.owner(crewId);
      expect([worker, finance]).toContain(current.userId);
      expect(
        await db.crewMember.findUnique({ where: { id: current.memberId } }),
      ).toMatchObject({ status: CrewMembershipStatus.active });
    });

    it('never removes the owner when removal races with ownership transfer', async () => {
      await Promise.allSettled([
        members.remove(crewId, workerMemberId, owner),
        crews.transferOwnership(crewId, worker, {
          actor: { type: 'member', userId: owner },
          requireTargetActiveMember: true,
        }),
      ]);
      const current = await authorization.owner(crewId);
      expect(
        await db.crewMember.findUnique({ where: { id: current.memberId } }),
      ).toMatchObject({ status: CrewMembershipStatus.active });
    });

    it('releases a vacancy exactly once when a recruited role is cleared before removal', async () => {
      await expect(
        members.update(crewId, workerMemberId, owner, {
          expectedVersion: 0,
          positions: [],
        }),
      ).rejects.toThrow();
      expect(
        await db.crewPosition.findUnique({ where: { id: positionId } }),
      ).toMatchObject({ recruitedCount: 1, status: 'full' });
      await members.update(crewId, workerMemberId, owner, {
        expectedVersion: 1,
        positions: [],
      });
      expect(
        await db.crewPosition.findUnique({ where: { id: positionId } }),
      ).toMatchObject({ recruitedCount: 0, status: 'open' });
      const replacement = await db.crewApplication.create({
        data: {
          id: randomUUID(),
          crewId,
          positionId,
          applicantId: randomUUID(),
        },
      });
      await confirmFixtureOffer(replacement.id);
      await applications.approve(replacement.id, owner);
      await members.remove(crewId, workerMemberId, owner);
      expect(
        await db.crewPosition.findUnique({ where: { id: positionId } }),
      ).toMatchObject({ recruitedCount: 1, status: 'full' });
    });

    it('lets only the owner grant access and immediately projects permission changes to the workspace', async () => {
      await expect(
        members.update(crewId, workerMemberId, worker, {
          expectedVersion: 1,
          policyKeys: ['admin'],
        }),
      ).rejects.toThrow();
      await members.update(crewId, workerMemberId, owner, {
        expectedVersion: 1,
        policyKeys: ['admin'],
      });
      await authorization.require(crewId, worker, 'tasks.manage');
      expect(
        await db.workspaceMember.findFirst({
          where: { userId: worker, removedAt: null },
        }),
      ).toMatchObject({ role: 'admin' });
      await members.update(crewId, workerMemberId, owner, {
        expectedVersion: 2,
        policyKeys: [],
      });
      await expect(
        authorization.require(crewId, worker, 'tasks.manage'),
      ).rejects.toThrow();
      expect(
        await db.workspaceMember.findFirst({
          where: { userId: worker, removedAt: null },
        }),
      ).toMatchObject({ role: 'viewer' });
    });

    it('releases the recruited vacancy when an outgoing owner leaves during transfer', async () => {
      await crews.transferOwnership(crewId, worker, {
        actor: { type: 'member', userId: owner },
        requireTargetActiveMember: true,
      });
      await crews.transferOwnership(crewId, finance, {
        actor: { type: 'member', userId: worker },
        requireTargetActiveMember: true,
        removeOldOwner: true,
      });
      expect(
        await db.crewPosition.findUnique({ where: { id: positionId } }),
      ).toMatchObject({ recruitedCount: 0, status: 'open' });
      expect(await authorization.resolve(crewId, worker)).toBeNull();
    });

    it('admits one manual earning for concurrent retries and rejects changed terms', async () => {
      const input = {
        crewMemberId: workerMemberId,
        sourceType: 'adjustment' as const,
        title: 'Retry earning',
        amountMinor: '1000',
        currency: 'USD' as const,
        idempotencyKey: 'earning-receipt',
      };
      const [first, second] = await Promise.all([
        earnings.create(crewId, finance, input),
        earnings.create(crewId, finance, input),
      ]);
      expect(first.id).toBe(second.id);
      expect(
        await db.crewEarningEvent.count({
          where: { earningId: first.id, action: 'earning.created' },
        }),
      ).toBe(1);
      for (const changed of [
        { amountMinor: '999' },
        { title: 'Other' },
        { description: 'Changed' },
        { sourceType: 'discretionary_bonus' as const },
      ]) {
        await expect(
          earnings.create(crewId, finance, { ...input, ...changed }),
        ).rejects.toMatchObject({ status: 409 });
      }
      await earnings.approve(first.id, finance, {
        expectedVersion: first.version,
      });
      expect((await earnings.create(crewId, finance, input)).id).toBe(first.id);
    });

    it('admits one payout for concurrent retries and rejects changed amounts and withholding', async () => {
      const earning = await earnings.create(crewId, finance, {
        crewMemberId: workerMemberId,
        sourceType: 'adjustment',
        title: 'Payout balance',
        amountMinor: '2000',
        currency: 'USD',
        idempotencyKey: 'payout-balance',
      });
      await earnings.approve(earning.id, finance, {
        expectedVersion: earning.version,
      });
      const input = {
        crewMemberId: workerMemberId,
        currency: 'USD' as const,
        amountMinor: '1000',
        withholdingAmountMinor: '10',
        idempotencyKey: 'payout-receipt',
      };
      const [first, second] = await Promise.all([
        payouts.create(crewId, finance, input),
        payouts.create(crewId, finance, input),
      ]);
      expect(first.id).toBe(second.id);
      expect(
        await db.crewPayoutEvent.count({
          where: { payoutId: first.id, action: 'payout.created' },
        }),
      ).toBe(1);
      expect(
        await db.crewPayoutAllocation.count({ where: { payoutId: first.id } }),
      ).toBe(1);
      for (const changed of [
        { amountMinor: '999' },
        { withholdingAmountMinor: '20' },
        { note: 'Changed' },
      ]) {
        await expect(
          payouts.create(crewId, finance, { ...input, ...changed }),
        ).rejects.toMatchObject({ status: 409 });
      }
    });

    it('serializes the same payout key across different beneficiaries', async () => {
      const other = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: `other-${randomUUID()}`,
          joinedVia: 'invitation',
        },
      });
      for (const memberId of [workerMemberId, other.id]) {
        const earning = await earnings.create(crewId, finance, {
          crewMemberId: memberId,
          sourceType: 'adjustment',
          title: 'Balance',
          amountMinor: '1000',
          currency: 'USD',
          idempotencyKey: `balance-${memberId}`,
        });
        await earnings.approve(earning.id, finance, {
          expectedVersion: earning.version,
        });
      }
      const results = await Promise.allSettled(
        [workerMemberId, other.id].map((crewMemberId) =>
          payouts.create(crewId, finance, {
            crewMemberId,
            currency: 'USD',
            amountMinor: '100',
            withholdingAmountMinor: '0',
            idempotencyKey: 'shared-beneficiary-key',
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(
        rejected?.status === 'rejected' ? rejected.reason : null,
      ).toMatchObject({ status: 409 });
      expect(await db.crewPayout.count({ where: { crewId } })).toBe(1);
    });

    it('cannot both allocate and reverse the same balance across concurrent sessions', async () => {
      const earning = await earnings.create(crewId, finance, {
        crewMemberId: workerMemberId,
        sourceType: 'adjustment',
        title: 'Approved compensation',
        amountMinor: '1000',
        currency: 'USD',
        idempotencyKey: 'concurrent-earning',
      });
      const posted = await earnings.approve(earning.id, finance, {
        expectedVersion: 1,
      });
      const results = await Promise.allSettled([
        earnings.reverse(earning.id, finance, {
          expectedVersion: posted.version,
          reason: 'Correction',
        }),
        payouts.create(crewId, finance, {
          crewMemberId: workerMemberId,
          currency: 'USD',
          amountMinor: '1000',
          withholdingAmountMinor: '0',
          idempotencyKey: 'concurrent-payout',
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const final = await db.crewEarningEntry.findUniqueOrThrow({
        where: { id: earning.id },
      });
      const allocations = await db.crewPayoutAllocation.count({
        where: { earningId: earning.id },
      });
      expect(
        final.status === 'reversed' ? allocations === 0 : allocations === 1,
      ).toBe(true);
    });

    it('keeps concurrent moves and trash consistent and restores ancestors first', async () => {
      const parent = await assets.createFolder(crewId, owner, {
        name: 'Parent',
      });
      const child = await assets.createFolder(crewId, owner, { name: 'Child' });
      const outcomes = await Promise.allSettled([
        assets.update(crewId, owner, child.id, {
          parentId: parent.id,
          expectedUpdatedAt: child.updatedAt,
        }),
        assets.trash(crewId, owner, parent.id),
      ]);
      expect(outcomes[1].status).toBe('fulfilled');
      const actual = await db.crewAssetNode.findUniqueOrThrow({
        where: { id: child.id },
      });
      if (outcomes[0].status === 'fulfilled') {
        expect(actual).toMatchObject({
          parentId: parent.id,
          status: 'trashed',
        });
        await expect(assets.restore(crewId, owner, child.id)).rejects.toThrow();
      } else {
        expect(actual).toMatchObject({ parentId: null, status: 'active' });
      }
      await expect(
        assets.createFolder(crewId, owner, {
          name: 'Hidden',
          parentId: parent.id,
        }),
      ).rejects.toThrow();
      await assets.restore(crewId, owner, parent.id);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: child.id } }),
      ).toMatchObject({ status: 'active' });
      // Exercise the nested restore guard regardless of which concurrent request won.
      const nested = await assets.createFolder(crewId, owner, {
        name: 'Nested',
        parentId: parent.id,
      });
      await assets.trash(crewId, owner, parent.id);
      await expect(assets.restore(crewId, owner, nested.id)).rejects.toThrow();
      await assets.restore(crewId, owner, parent.id);
      expect(
        await db.crewAssetNode.findUnique({ where: { id: nested.id } }),
      ).toMatchObject({ status: 'active', parentId: parent.id });
    });

    it('rejects one of two opposing folder moves instead of creating a cycle', async () => {
      const a = await assets.createFolder(crewId, owner, { name: 'A' });
      const b = await assets.createFolder(crewId, owner, { name: 'B' });
      const outcomes = await Promise.allSettled([
        assets.update(crewId, owner, a.id, {
          parentId: b.id,
          expectedUpdatedAt: a.updatedAt,
        }),
        assets.update(crewId, owner, b.id, {
          parentId: a.id,
          expectedUpdatedAt: b.updatedAt,
        }),
      ]);
      expect(
        outcomes.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const folders = await db.crewAssetNode.findMany({
        where: { id: { in: [a.id, b.id] } },
      });
      expect(folders.filter((folder) => folder.parentId === null)).toHaveLength(
        1,
      );
    });
  },
);
