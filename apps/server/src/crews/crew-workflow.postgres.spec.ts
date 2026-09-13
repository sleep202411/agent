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

    beforeAll(() => {
      const target = new URL(url!);
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
      );
      crews = new CrewsService(
        db as never,
        conversations,
        authorization,
        collaboration,
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
      await applications.approve(application.id, owner);
      workerMemberId = (await authorization.requireMembership(crewId, worker))
        .memberId;
    });
    afterEach(async () => {
      await db.$executeRaw`DELETE FROM crew_trust_appeals WHERE task_id IN (SELECT id FROM crew_tasks WHERE crew_id=${crewId})`;
      await db.$executeRaw`DELETE FROM crew_creator_trust_entries WHERE task_id IN (SELECT id FROM crew_tasks WHERE crew_id=${crewId})`;
      // Posted ledger rows are deliberately immutable. Keep the unique fixtures
      // in this disposable test database rather than disabling audit triggers.
      await db.crew.updateMany({
        where: { id: crewId },
        data: { deletedAt: new Date() },
      });
    });

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
      expect(await crews.joinFanCommunity(crewId, fan, true)).toEqual(first);
      expect(await crews.joinFanCommunity(crewId, fan, true)).toEqual(first);
      expect(
        await db.$queryRaw`SELECT user_id FROM crew_likes WHERE crew_id = ${crewId} AND user_id = ${fan}`,
      ).toEqual([{ user_id: fan }]);
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
        decision: 'approve',
        note: 'Accepted',
      });
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
        tasks.review(task.id, owner, { decision: 'approve', note: '' }),
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
