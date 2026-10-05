import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { NotificationService } from '../../notification/notification.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { newCrewDomainId } from '../id';
import { CrewInviteLinksService } from './invite-links.service';
const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'Task invitation acceptance (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let crewId: string;
    let ownerId: string;
    let stateId: string;
    let sequence = 0;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      crewId = `accept-${randomUUID()}`;
      ownerId = `owner-${randomUUID()}`;
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Acceptance fixture',
          description: '',
          logo: 'https://assets.invalid/logo.png',
          createdByUserId: ownerId,
        },
      });
      const owner = await db.crewMember.create({
        data: {
          id: newCrewDomainId(),
          crewId,
          userId: ownerId,
          joinedVia: 'invitation',
        },
      });
      await db.crewOwnership.create({ data: { crewId, memberId: owner.id } });
      stateId = (
        await db.crewTaskWorkflowState.create({
          data: {
            crewId,
            name: 'Open',
            color: '#888888',
            semantic: 'open',
            systemKey: 'open',
            position: 0,
            createdByUserId: ownerId,
          },
        })
      ).id;
    });
    afterAll(async () => {
      if (crewId) {
        await db.notificationOutbox.deleteMany({ where: { userId: ownerId } });
        await db.notification.deleteMany({ where: { userId: ownerId } });
        await db.crewInviteLink.deleteMany({ where: { crewId } });
        await db.crewTask.deleteMany({ where: { crewId } });
        await db.crew.delete({ where: { id: crewId } });
      }
      await db?.$disconnect();
    });
    async function fixture() {
      const task = await db.crewTask.create({
        data: {
          crewId,
          title: 'Animate scene',
          number: ++sequence,
          workflowStateId: stateId,
          createdByUserId: ownerId,
          metadata: {
            compensation: { rewardUsdMinor: 12500 },
            requiredSkills: [],
          },
        },
      });
      const notifications = new NotificationService(db as never);
      // External collaboration/chat dependencies are fixtures. All admission,
      // claim, authorization, redemption and notification writes use PostgreSQL.
      const conversations = {
        openCrewConversation: jest
          .fn()
          .mockResolvedValue({ id: 'fixture-chat' }),
        syncCrewParticipant: jest.fn(),
        persistSystem: jest.fn().mockResolvedValue({ id: 'fixture-message' }),
        broadcastMessage: jest.fn(),
      };
      const service = new CrewInviteLinksService(
        db as never,
        new CrewAuthorizationService(db as never),
        conversations as never,
        { addCrewMemberAccess: jest.fn() } as never,
        notifications,
        { assertEligible: jest.fn() } as never,
      );
      const minted = await service.create(crewId, ownerId, {
        taskId: task.id,
        taskVersion: task.version,
        kind: 'member',
        policyKeys: [],
      });
      const link = await service.findByHash(
        createHash('sha256').update(minted.token).digest('hex'),
      );
      if (!link) throw new Error('Minted invitation was not persisted');
      return { task, link, notifications, conversations, service };
    }
    it('joins and claims once with one durable notification and outbox event', async () => {
      const h = await fixture();
      const user = { userId: `recipient-${randomUUID()}` };
      expect(await h.service.preview(h.link, user)).toMatchObject({
        status: 'active',
        task: { id: h.task.id, rewardUsdMinor: 12500 },
      });
      const first = await h.service.accept(h.link, user);
      expect(await h.service.accept(h.link, user)).toEqual(first);
      const consumed = await db.crewInviteLink.findUniqueOrThrow({
        where: { id: h.link.id },
      });
      expect(await h.service.preview(consumed, user)).toMatchObject({
        status: 'exhausted',
        acceptedHref: `/crews/${crewId}/workspace?tab=tasks&task=${h.task.id}`,
      });
      expect(
        await db.crewMember.count({ where: { crewId, userId: user.userId } }),
      ).toBe(1);
      expect(
        await db.crewTaskAssignee.count({
          where: { taskId: h.task.id, userId: user.userId },
        }),
      ).toBe(1);
      expect(
        (
          await db.crewInviteLink.findUniqueOrThrow({
            where: { id: h.link.id },
          })
        ).useCount,
      ).toBe(1);
      const notice = await db.notification.findFirstOrThrow({
        where: {
          userId: ownerId,
          idempotencyKey: `crew.task_invite.accepted:${h.link.id}:${user.userId}`,
        },
      });
      expect(
        await db.notificationOutbox.count({
          where: { notificationId: notice.id },
        }),
      ).toBe(1);
      expect(h.conversations.broadcastMessage).toHaveBeenCalledTimes(1);
    });
    it('rolls all writes back when notification delivery cannot be queued', async () => {
      const h = await fixture();
      const user = { userId: `recipient-${randomUUID()}` };
      const writer = new NotificationService(db as never);
      jest
        .spyOn(h.notifications, 'send')
        .mockImplementation(async (...args) => {
          await writer.send(...args);
          throw new Error('Injected post-outbox failure');
        });
      await expect(h.service.accept(h.link, user)).rejects.toThrow(
        'Injected post-outbox failure',
      );
      expect(
        await db.crewMember.count({ where: { crewId, userId: user.userId } }),
      ).toBe(0);
      expect(
        await db.crewTaskAssignee.count({ where: { taskId: h.task.id } }),
      ).toBe(0);
      expect(
        await db.crewInviteLinkRedemption.count({
          where: { linkId: h.link.id },
        }),
      ).toBe(0);
      expect(
        (await db.crewTask.findUniqueOrThrow({ where: { id: h.task.id } }))
          .version,
      ).toBe(1);
      expect(
        (
          await db.crewInviteLink.findUniqueOrThrow({
            where: { id: h.link.id },
          })
        ).useCount,
      ).toBe(0);
      expect(
        await db.notification.count({
          where: {
            userId: ownerId,
            idempotencyKey: `crew.task_invite.accepted:${h.link.id}:${user.userId}`,
          },
        }),
      ).toBe(0);
      expect(h.conversations.broadcastMessage).not.toHaveBeenCalled();
    });
    it('admits only one competing recipient for a single-use task', async () => {
      const h = await fixture();
      const users = [randomUUID(), randomUUID()].map((id) => ({
        userId: `recipient-${id}`,
      }));
      const results = await Promise.allSettled(
        users.map((user) => h.service.accept(h.link, user)),
      );
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        await db.crewMember.count({
          where: { crewId, userId: { in: users.map((u) => u.userId) } },
        }),
      ).toBe(1);
      expect(
        await db.crewTaskAssignee.count({ where: { taskId: h.task.id } }),
      ).toBe(1);
      expect(
        await db.crewInviteLinkRedemption.count({
          where: { linkId: h.link.id },
        }),
      ).toBe(1);
    });
  },
);
