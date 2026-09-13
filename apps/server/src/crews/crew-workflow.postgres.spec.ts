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
      // Posted ledger rows are deliberately immutable. Keep the unique fixtures
      // in this disposable test database rather than disabling audit triggers.
      await db.crew.updateMany({
        where: { id: crewId },
        data: { deletedAt: new Date() },
      });
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
          labelIds: [label.id],
          revisionLimit: 2,
          assignees: [
            { userId: worker, currency: 'USD', rewardAmountMinor: 1000 },
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
      await tasks.review(task.id, owner, {
        decision: 'approve',
        note: 'Accepted',
      });
      await expect(
        tasks.review(task.id, owner, { decision: 'approve', note: '' }),
      ).rejects.toThrow();
      expect(
        (
          await assets.list(crewId, worker, {
            source: 'all',
            parentId: delivery.folderId,
          })
        ).items.map((item) => item.id),
      ).toContain(file.id);
      expect(
        (
          await assets.list(crewId, finance, {
            source: 'all',
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
