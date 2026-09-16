import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { workspaceTestDatabase } from '../crews/production/__tests__/workspace-test-database';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
const url = workspaceTestDatabase(process.env);
jest.setTimeout(15000);
(url ? describe : describe.skip)(
  'Service inquiry replay (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: ConversationsService;
    let controller: ConversationsController;
    let buyer: string, creator: string, serviceId: string;
    const ids: string[] = [];
    beforeAll(() => {
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        transactionOptions: { timeout: 10000 },
      });
    });
    beforeEach(async () => {
      buyer = randomUUID();
      creator = randomUUID();
      serviceId = randomUUID();
      ids.push(serviceId);
      const realtime = {
        publishUserFrame: jest.fn().mockResolvedValue(undefined),
        publishCrewMessage: jest.fn().mockResolvedValue(undefined),
      };
      service = new ConversationsService(
        db as never,
        realtime as never,
        { send: jest.fn().mockResolvedValue(undefined) } as never,
      );
      controller = new ConversationsController(
        service,
        db as never,
        realtime as never,
      );
      await createService(serviceId);
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await db.serviceOrder.deleteMany({ where: { serviceId: { in: ids } } });
      await db.conversation.deleteMany({
        where: { participants: { some: { userId: buyer } } },
      });
      await db.creatorService.deleteMany({ where: { id: { in: ids } } });
      ids.length = 0;
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    const createService = (id: string) =>
      db.creatorService.create({
        data: {
          id,
          creatorId: creator,
          title: 'Fixture',
          summary: 'Local inquiry retry fixture',
          coverPath: '',
          category: 'other',
          status: 'listed',
          publishedAt: new Date(),
        },
      });
    const open = (key = 'first-1', body = 'Hello', id = serviceId) =>
      controller.open({ userId: buyer } as never, {
        contextType: 'service',
        contextId: id,
        firstMessage: body,
        firstMessageClientKey: key,
      });

    it('concurrent retries create one thread, message and outbox entry', async () => {
      const results = await Promise.all([open(), open()]);
      expect(results[0].conversation.id).toBe(results[1].conversation.id);
      expect(results[0].firstMessage?.id).toBe(results[1].firstMessage?.id);
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(1);
      expect(
        await db.conversationRealtimeOutbox.count({
          where: { conversationId: results[0].conversation.id },
        }),
      ).toBe(1);
    });
    it('rejects changed text under the same identity and permits a deliberate new message', async () => {
      const first = await open();
      await expect(open('first-1', 'Different')).rejects.toBeInstanceOf(
        ConflictException,
      );
      const next = await open('first-2', 'Different');
      expect(next.conversation.id).toBe(first.conversation.id);
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(2);
    });
    it('replays the original thread after promotion to an order', async () => {
      const first = await open();
      const orderId = randomUUID();
      await db.$transaction(async (tx) => {
        await tx.serviceOrder.create({
          data: {
            id: orderId,
            serviceId,
            buyerId: buyer,
            creatorId: creator,
            conversationId: first.conversation.id,
            packageSnapshot: {},
          },
        });
        await tx.conversation.update({
          where: { id: first.conversation.id },
          data: {
            contextType: 'order',
            contextId: orderId,
            lookupKey: `order:${orderId}`,
          },
        });
      });
      const replay = await open();
      expect(replay.conversation.id).toBe(first.conversation.id);
      expect(replay.conversation.contextType).toBe('order');
      expect(replay.firstMessage?.id).toBe(first.firstMessage?.id);
      expect(
        await db.conversation.count({
          where: { participants: { some: { userId: buyer } } },
        }),
      ).toBe(1);
    });
    it('preserves opening without a message and legacy sends without a retry key', async () => {
      const empty = await controller.open({ userId: buyer } as never, {
        contextType: 'service',
        contextId: serviceId,
      });
      expect(empty.firstMessage).toBeNull();
      for (let i = 0; i < 2; i++) {
        const sent = await controller.open({ userId: buyer } as never, {
          contextType: 'service',
          contextId: serviceId,
          firstMessage: 'Legacy inquiry',
        });
        expect(sent.conversation.id).toBe(empty.conversation.id);
      }
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(2);
    });
    it('refuses to revive a deleted inquiry message on retry', async () => {
      const first = await open();
      await db.message.update({
        where: { id: first.firstMessage!.id },
        data: { deletedAt: new Date() },
      });
      await expect(open()).rejects.toBeInstanceOf(ConflictException);
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(1);
    });
    it('rechecks participant access on replay', async () => {
      const first = await open();
      await db.conversationParticipant.updateMany({
        where: { conversationId: first.conversation.id, userId: buyer },
        data: { leftAt: new Date() },
      });
      await expect(open()).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(1);
    });
    it('isolates the same client key across different service inquiries', async () => {
      const otherId = randomUUID();
      ids.push(otherId);
      await createService(otherId);
      const first = await open();
      const other = await open('first-1', 'Hello', otherId);
      expect(first.conversation.id).not.toBe(other.conversation.id);
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(2);
    });
    it('rolls back conversation and message together when outbox admission fails, then retries', async () => {
      const fail = jest
        .spyOn(
          service as unknown as { enqueueMessageRealtime: () => Promise<void> },
          'enqueueMessageRealtime',
        )
        .mockRejectedValueOnce(new Error('Fixture outbox failure'));
      await expect(open()).rejects.toThrow('Fixture outbox failure');
      fail.mockRestore();
      expect(await db.message.count({ where: { authorId: buyer } })).toBe(0);
      expect(
        await db.conversation.count({
          where: { participants: { some: { userId: buyer } } },
        }),
      ).toBe(0);
      const retry = await open();
      expect(retry.firstMessage).not.toBeNull();
    });
  },
);
