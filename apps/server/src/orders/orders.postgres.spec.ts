import { extendPrismaQueries } from '../common/__tests__/prisma-query-extension';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { workspaceTestDatabase } from '../crews/production/__tests__/workspace-test-database';
import { CreatorServicesService } from '../creator-services/creator-services.service';
import { CreateServiceSchema } from '../creator-services/dto';
import { ConversationsService } from '../conversations/conversations.service';
import { OrdersService } from './orders.service';
import { SubmitOrderSchema } from './dto';
const url = workspaceTestDatabase(process.env);
const applicationName = `order-admission-${randomUUID()}`;
jest.setTimeout(15000);
(url ? describe : describe.skip)('Order submission (owned PostgreSQL)', () => {
  let db: PrismaClient, svc: OrdersService, conversations: ConversationsService;
  let owner: string, buyer: string, id: string, questionId: string;
  let messageBroadcast: jest.SpiedFunction<
    ConversationsService['broadcastMessage']
  >;
  let contextBroadcast: jest.SpiedFunction<
    ConversationsService['broadcastContextChange']
  >;
  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: url,
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 10000 },
    });
  });
  beforeEach(async () => {
    owner = randomUUID();
    buyer = randomUUID();
    conversations = new ConversationsService(
      db as never,
      {} as never,
      {} as never,
    );
    messageBroadcast = jest
      .spyOn(conversations, 'broadcastMessage')
      .mockResolvedValue(undefined);
    contextBroadcast = jest
      .spyOn(conversations, 'broadcastContextChange')
      .mockResolvedValue(undefined);
    svc = new OrdersService(db as never, conversations);
    const creators = new CreatorServicesService(db as never);
    const service = await creators.create(
      owner,
      CreateServiceSchema.parse({
        title: 'Fixture',
        summary: 'Order fixture',
        category: 'other',
        packages: [
          {
            tier: 'basic',
            title: 'Basic',
            description: 'Fixture',
            currency: 'CNY',
            price: 10,
            deliveryDays: 1,
          },
        ],
        requirementQuestions: [{ prompt: 'Original question' }],
      }),
    );
    id = service.id;
    questionId = service.requirementQuestions[0].id;
    await creators.publish(id, owner);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.serviceOrder.deleteMany({ where: { buyerId: buyer } });
    await db.conversation.deleteMany({
      where: { participants: { some: { userId: buyer } } },
    });
    await db.creatorService.deleteMany({ where: { creatorId: owner } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const input = (key = 'order-1') =>
    SubmitOrderSchema.parse({
      serviceId: id,
      packageTier: 'basic',
      idempotencyKey: `fixture-${key}`,
      note: 'Buyer note',
      answers: [{ questionId, answer: 'My brief' }],
    });
  async function afterHeldEdit<T>(
    edit: (tx: Prisma.TransactionClient) => Promise<unknown>,
    action: () => Promise<T>,
  ) {
    let ready!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const editor = db.$transaction(async (tx) => {
      await edit(tx);
      ready();
      await gate;
    });
    await held;
    const result = Promise.resolve().then(action);
    const settled = Promise.allSettled([editor, result]);
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${applicationName} AND wait_event_type = 'Lock') AS waiting`;
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await settled;
    }
    return result;
  }
  it('preserves the complete revision brief through re-delivery and acceptance', async () => {
    const order = await svc.submit(buyer, input());
    await expect(svc.accept(order.id, buyer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await svc.accept(order.id, owner);
    await svc.deliver(order.id, owner);
    const reason = '请保留每个镜头的修改要求。'.repeat(100);
    const revised = await svc.requestRevision(order.id, buyer, { reason });
    expect(revised.status).toBe('revision_requested');
    const messages = await db.message.findMany({
      where: { conversationId: order.conversationId, type: 'system' },
    });
    expect(messages.map((message) => message.payload)).toContainEqual({
      kind: 'system',
      system: {
        kind: 'order.revision_requested',
        params: { orderId: order.id, reason },
      },
    });
    await svc.deliver(order.id, owner);
    await expect(svc.acceptDelivery(order.id, owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await svc.acceptDelivery(order.id, buyer);
    const reopened = await svc.detail(order.id, buyer);
    expect(reopened.status).toBe('completed');
    expect(reopened.completedAt).toBeInstanceOf(Date);
    expect(reopened.packageSnapshot).toEqual(order.packageSnapshot);
    await expect(
      svc.requestRevision(order.id, buyer, { reason: 'Another edit' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('counts system events consistently in order cards and conversation detail', async () => {
    const order = await svc.submit(buyer, input());
    await svc.accept(order.id, owner);
    for (const viewer of [buyer, owner]) {
      const page = await svc.list(viewer, { role: 'both', limit: 24 });
      const conversation = await conversations.detail(
        order.conversationId,
        viewer,
      );
      expect(page.items[0]._unreadCount).toBe(viewer === buyer ? 2 : 3);
      expect(page.items[0]._unreadCount).toBe(conversation._unreadCount);
    }
  });
  it('retains unread timestamp ties and excludes read, own and deleted messages', async () => {
    const order = await svc.submit(buyer, input());
    await db.message.deleteMany({
      where: { conversationId: order.conversationId },
    });
    const time = new Date('2026-01-01T00:00:00.123Z');
    const prefix = randomUUID();
    await db.message.createMany({
      data: [
        { id: prefix + '1', authorId: owner, deletedAt: null },
        { id: prefix + '2', authorId: owner, deletedAt: null },
        { id: prefix + '3', authorId: owner, deletedAt: null },
        { id: prefix + '4', authorId: null, deletedAt: null },
        { id: prefix + '5', authorId: owner, deletedAt: time },
        { id: prefix + '6', authorId: buyer, deletedAt: null },
      ].map((m) => ({
        ...m,
        conversationId: order.conversationId,
        createdAt: time,
        type: m.authorId ? ('text' as const) : ('system' as const),
        body: 'Unread fixture',
      })),
    });
    await db.conversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId: order.conversationId,
          userId: buyer,
        },
      },
      data: { lastReadAt: time, lastReadMessageId: prefix + '2' },
    });
    expect(
      (await svc.list(buyer, { role: 'buyer', limit: 24 })).items[0]
        ._unreadCount,
    ).toBe(2);
    expect(
      (await conversations.detail(order.conversationId, buyer))._unreadCount,
    ).toBe(2);
    await db.conversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId: order.conversationId,
          userId: buyer,
        },
      },
      data: { lastReadMessageId: null },
    });
    expect(
      (await svc.list(buyer, { role: 'buyer', limit: 24 })).items[0]
        ._unreadCount,
    ).toBe(4);
  });
  it('keeps tied order pages deterministic with per-conversation counts and role scope', async () => {
    const a = await svc.submit(buyer, input('page-a'));
    const b = await svc.submit(buyer, input('page-b'));
    const c = await svc.submit(buyer, input('page-c'));
    await svc.accept(b.id, owner);
    await db.serviceOrder.updateMany({
      where: { buyerId: buyer },
      data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const expected = await db.serviceOrder.findMany({
      where: { buyerId: buyer },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.list(buyer, { role: 'buyer', limit: 1, cursor });
      ids.push(...page.items.map((r) => r.id));
      expect(page.items[0]._unreadCount).toBe(
        page.items[0].id === b.id ? 2 : 1,
      );
      cursor = page.nextCursor ?? undefined;
    } while (cursor && ids.length < 5);
    expect(ids).toEqual(expected.map((r) => r.id));
    expect(new Set(ids)).toEqual(new Set([a.id, b.id, c.id]));
    expect(
      (await svc.list(buyer, { role: 'creator', limit: 24 })).items,
    ).toEqual([]);
    expect(
      (await svc.list(randomUUID(), { role: 'both', limit: 24 })).items,
    ).toEqual([]);
  });
  it('does not invent unread history when an order participant has no conversation cursor row', async () => {
    const order = await svc.submit(buyer, input());
    await db.conversationParticipant.delete({
      where: {
        conversationId_userId: {
          conversationId: order.conversationId,
          userId: owner,
        },
      },
    });
    expect(
      (await svc.list(owner, { role: 'creator', limit: 24 })).items[0]
        ._unreadCount,
    ).toBe(0);
  });
  it.each(['departed', 'role', 'context'] as const)(
    'rejects a proposal after a preceding %s change without messages or outbox rows',
    async (mode) => {
      const conv = await conversations.openServiceConversation({
        serviceId: id,
        buyerId: buyer,
        creatorId: owner,
      });
      const proposal = {
        note: 'Offer',
        packageTier: 'basic' as const,
        price: 10,
        currency: 'CNY' as const,
        deliveryDays: 1,
        revisions: 0,
        scope: [],
      };
      const send = afterHeldEdit(
        async (tx) => {
          if (mode === 'context')
            await tx.conversation.update({
              where: { id: conv.id },
              data: { contextType: 'order', contextId: 'already-converted' },
            });
          else
            await tx.conversationParticipant.update({
              where: {
                conversationId_userId: {
                  conversationId: conv.id,
                  userId: owner,
                },
              },
              data:
                mode === 'departed'
                  ? { leftAt: new Date() }
                  : { role: 'buyer' },
            });
        },
        () => conversations.sendProposal(conv.id, owner, proposal),
      );
      await expect(send).rejects.toBeInstanceOf(
        mode === 'departed'
          ? NotFoundException
          : mode === 'role'
            ? ForbiddenException
            : ConflictException,
      );
      expect(
        await db.message.count({ where: { conversationId: conv.id } }),
      ).toBe(0);
      expect(
        await db.conversationRealtimeOutbox.count({
          where: { message: { conversationId: conv.id } },
        }),
      ).toBe(0);
      expect(messageBroadcast).not.toHaveBeenCalled();
    },
  );
  it('rolls back proposal messages and outbox rows with the caller transaction', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    await expect(
      db.$transaction(async (tx) => {
        await conversations.persistProposal(
          conv.id,
          owner,
          {
            note: 'Offer',
            packageTier: 'basic',
            price: 10,
            currency: 'CNY',
            deliveryDays: 1,
            revisions: 0,
            scope: [],
          },
          tx,
        );
        throw new Error('Caller failed');
      }),
    ).rejects.toThrow('Caller failed');
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(
      0,
    );
    expect(
      await db.conversationRealtimeOutbox.count({
        where: { message: { conversationId: conv.id } },
      }),
    ).toBe(0);
  });
  const proposalInput = (clientKey: string) => ({
    clientKey,
    note: 'Offer',
    packageTier: 'basic' as const,
    price: 10,
    currency: 'CNY' as const,
    deliveryDays: 1,
    revisions: 0,
    scope: ['One scene'],
  });
  it('recovers one proposal and outbox from concurrent identical retries', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const [a, b] = await Promise.all([
      conversations.sendProposal(conv.id, owner, proposalInput('retry')),
      conversations.sendProposal(conv.id, owner, proposalInput('retry')),
    ]);
    expect(a).toEqual(b);
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(
      1,
    );
    expect(
      await db.conversationRealtimeOutbox.count({
        where: { message: { conversationId: conv.id } },
      }),
    ).toBe(1);
    expect(messageBroadcast).toHaveBeenCalledTimes(1);
    await expect(
      conversations.sendProposal(conv.id, owner, {
        ...proposalInput('retry'),
        price: 11,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('returns the accepted receipt after order conversion without reopening or broadcasting it', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const proposal = await conversations.sendProposal(
      conv.id,
      owner,
      proposalInput('accepted'),
    );
    const order = await svc.acceptProposal(buyer, conv.id, proposal.id);
    const count = messageBroadcast.mock.calls.length;
    const replay = await conversations.sendProposal(
      conv.id,
      owner,
      proposalInput('accepted'),
    );
    expect(replay.id).toBe(proposal.id);
    expect(replay.payload).toMatchObject({
      proposal: { status: 'accepted', orderId: order.id },
    });
    expect(messageBroadcast).toHaveBeenCalledTimes(count);
    await expect(
      conversations.sendProposal(
        conv.id,
        owner,
        proposalInput('new-after-order'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('retains declined proposal status and rejects unavailable receipts', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const proposal = await conversations.sendProposal(
      conv.id,
      owner,
      proposalInput('declined'),
    );
    await conversations.declineProposal(conv.id, buyer, proposal.id);
    const replay = await conversations.sendProposal(
      conv.id,
      owner,
      proposalInput('declined'),
    );
    expect(replay.payload).toMatchObject({ proposal: { status: 'declined' } });
    await db.message.update({
      where: { id: proposal.id },
      data: { deletedAt: new Date() },
    });
    await expect(
      conversations.sendProposal(conv.id, owner, proposalInput('declined')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      await db.message.count({
        where: { conversationId: conv.id, type: 'proposal' },
      }),
    ).toBe(1);
  });
  it('does not expose a proposal receipt to a departed creator', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    await conversations.sendProposal(conv.id, owner, proposalInput('departed'));
    await db.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId: conv.id, userId: owner },
      },
      data: { leftAt: new Date() },
    });
    await expect(
      conversations.sendProposal(conv.id, owner, proposalInput('departed')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('admits only one message kind for a key shared concurrently with a text send', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const results = await Promise.allSettled([
      conversations.sendProposal(conv.id, owner, proposalInput('shared-kind')),
      conversations.sendText(conv.id, owner, 'Text instead', 'shared-kind'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.any(ConflictException) as unknown,
      }),
    ]);
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(
      1,
    );
  });
  it('rolls back a keyed caller transaction and permits the same proposal to retry', async () => {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    await expect(
      db.$transaction(async (tx) => {
        await conversations.persistProposal(
          conv.id,
          owner,
          proposalInput('rollback'),
          tx,
        );
        throw new Error('Caller failed');
      }),
    ).rejects.toThrow('Caller failed');
    const message = await conversations.sendProposal(
      conv.id,
      owner,
      proposalInput('rollback'),
    );
    expect(message.clientKey).toBe('rollback');
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(
      1,
    );
  });
  it('keeps proposal keys conversation scoped and preserves unkeyed callers', async () => {
    const a = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const b = await conversations.openServiceConversation({
      serviceId: randomUUID(),
      buyerId: buyer,
      creatorId: owner,
    });
    const one = await conversations.sendProposal(
      a.id,
      owner,
      proposalInput('scoped'),
    );
    const two = await conversations.sendProposal(
      b.id,
      owner,
      proposalInput('scoped'),
    );
    expect(one.id).not.toBe(two.id);
    const legacy = { ...proposalInput('legacy'), clientKey: undefined };
    const x = await conversations.sendProposal(a.id, owner, legacy);
    const y = await conversations.sendProposal(a.id, owner, legacy);
    expect(x.id).not.toBe(y.id);
  });
  it.each(['price', 'questions'] as const)(
    'rejects stale displayed service versions after a preceding %s edit',
    async (mode) => {
      const request = { ...input('stale-offer'), expectedServiceVersion: 1 };
      await expect(
        afterHeldEdit(
          async (tx) => {
            await tx.creatorService.update({
              where: { id },
              data: { version: { increment: 1 } },
            });
            if (mode === 'price')
              await tx.servicePackage.updateMany({
                where: { serviceId: id },
                data: { priceAmount: 2000n },
              });
            else
              await tx.serviceRequirementQuestion.updateMany({
                where: { serviceId: id },
                data: { prompt: 'Changed question' },
              });
          },
          () => svc.submit(buyer, request),
        ),
      ).rejects.toMatchObject({
        response: { field: 'expectedServiceVersion' },
      });
      expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(
        0,
      );
      expect(messageBroadcast).not.toHaveBeenCalled();
      const accepted = await svc.submit(buyer, {
        ...request,
        expectedServiceVersion: 2,
      });
      expect(accepted.packageSnapshot).toMatchObject({
        price: mode === 'price' ? 20 : 10,
      });
    },
  );
  it.each(['paused', 'archived'] as const)(
    'recovers an accepted order after its service is %s',
    async (status) => {
      const request = { ...input('recover-offer'), expectedServiceVersion: 1 };
      const order = await svc.submit(buyer, request);
      const creators = new CreatorServicesService(db as never);
      if (status === 'paused') await creators.pause(id, owner);
      else await creators.archive(id, owner);
      messageBroadcast.mockClear();
      contextBroadcast.mockClear();
      expect((await svc.submit(buyer, request)).id).toBe(order.id);
      expect(messageBroadcast).not.toHaveBeenCalled();
      expect(contextBroadcast).not.toHaveBeenCalled();
      await expect(
        svc.submit(buyer, {
          ...request,
          idempotencyKey: 'different-order-key',
        }),
      ).rejects.toBeInstanceOf(
        status === 'paused' ? ConflictException : NotFoundException,
      );
    },
  );
  it('does not reuse another service’s order receipt for a new request', async () => {
    const request = input('wrong-service');
    await svc.submit(buyer, request);
    await expect(
      svc.submit(buyer, { ...request, serviceId: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(1);
  });
  it('concurrent retries retain one order, conversation, message pair and broadcast set', async () => {
    await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const [a, b] = await Promise.all([
      svc.submit(buyer, input()),
      svc.submit(buyer, input()),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(1);
    expect(
      await db.message.count({ where: { conversationId: a.conversationId } }),
    ).toBe(2);
    expect(messageBroadcast).toHaveBeenCalledTimes(2);
    expect(contextBroadcast).toHaveBeenCalledTimes(1);
  });
  it('gives deliberate concurrent orders distinct evolved conversations', async () => {
    await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const [a, b] = await Promise.all([
      svc.submit(buyer, input('first')),
      svc.submit(buyer, input('second')),
    ]);
    expect(a.id).not.toBe(b.id);
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(2);
  });
  it('captures the package and questionnaire committed together by the preceding editor', async () => {
    const order = await afterHeldEdit(
      async (tx) => {
        await tx.creatorService.update({
          where: { id },
          data: { title: 'Updated service', version: { increment: 1 } },
        });
        await tx.servicePackage.updateMany({
          where: { serviceId: id },
          data: { priceAmount: 2200n },
        });
        await tx.serviceRequirementQuestion.updateMany({
          where: { serviceId: id },
          data: { prompt: 'Updated question', required: true },
        });
      },
      () => svc.submit(buyer, input()),
    );
    expect(order.packageSnapshot).toMatchObject({ price: 22 });
    expect(order.questionnaire).toEqual([
      { prompt: 'Updated question', required: true, answer: 'My brief' },
    ]);
  });
  it('rejects a service archived by the preceding writer before creating an order', async () => {
    await expect(
      afterHeldEdit(
        (tx) =>
          tx.creatorService.update({
            where: { id },
            data: { status: 'archived', deletedAt: new Date() },
          }),
        () => svc.submit(buyer, input()),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(0);
  });
  it('clears rolled-back message broadcasts when uniqueness recovery returns the winner', async () => {
    const first = await svc.submit(buyer, input());
    messageBroadcast.mockClear();
    contextBroadcast.mockClear();
    let hideOnce = true;
    const raced = extendPrismaQueries(db, {
      query: {
        serviceOrder: {
          findFirst({ args, query }) {
            if (hideOnce) {
              hideOnce = false;
              return Promise.resolve(null);
            }
            return query(args);
          },
        },
      },
    });
    const retrying = new OrdersService(raced as never, conversations);
    const replay = await retrying.submit(buyer, input());
    expect(replay.id).toBe(first.id);
    expect(messageBroadcast).not.toHaveBeenCalled();
    expect(contextBroadcast).not.toHaveBeenCalled();
    expect(
      await db.conversation.count({
        where: { participants: { some: { userId: buyer } } },
      }),
    ).toBe(1);
  });
  it('rolls back failed order creation and retries without orphan messages', async () => {
    jest
      .spyOn(conversations, 'persistSystem')
      .mockRejectedValueOnce(new Error('Fixture system-message failure'));
    await expect(svc.submit(buyer, input())).rejects.toThrow(
      'Fixture system-message failure',
    );
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(0);
    expect(await db.message.count({ where: { authorId: buyer } })).toBe(0);
    expect(messageBroadcast).not.toHaveBeenCalled();
    const retry = await svc.submit(buyer, input());
    expect(retry.conversationId).toBeTruthy();
  });
  it('retains self-order, unpublished-service and required-answer validation', async () => {
    await expect(svc.submit(owner, input())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await db.serviceRequirementQuestion.update({
      where: { id: questionId },
      data: { required: true },
    });
    await expect(
      svc.submit(buyer, { ...input(), answers: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await db.creatorService.update({
      where: { id },
      data: { status: 'paused' },
    });
    await expect(svc.submit(buyer, input())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(0);
  });
  async function proposal() {
    const conv = await conversations.openServiceConversation({
      serviceId: id,
      buyerId: buyer,
      creatorId: owner,
    });
    const message = await conversations.persistProposal(conv.id, owner, {
      packageTier: 'basic',
      price: 10,
      currency: 'CNY',
      deliveryDays: 1,
      revisions: 0,
      scope: [],
      note: 'Offer',
    });
    return { conv, message };
  }
  it.each(['accept', 'decline'])(
    'rechecks active buyer after a queued %s waits',
    async (action) => {
      const { conv, message } = await proposal();
      await expect(
        afterHeldEdit<unknown>(
          (tx) =>
            tx.conversationParticipant.update({
              where: {
                conversationId_userId: {
                  conversationId: conv.id,
                  userId: buyer,
                },
              },
              data: { leftAt: new Date() },
            }),
          () =>
            action === 'accept'
              ? svc.acceptProposal(buyer, conv.id, message.id)
              : conversations.declineProposal(conv.id, buyer, message.id),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(
        0,
      );
      expect(
        (await db.message.findUniqueOrThrow({ where: { id: message.id } }))
          .payload,
      ).toMatchObject({ proposal: { status: 'open' } });
    },
  );
  it('rejects a departed creator after proposal admission waits', async () => {
    const { conv, message } = await proposal();
    await expect(
      afterHeldEdit(
        (tx) =>
          tx.conversationParticipant.update({
            where: {
              conversationId_userId: { conversationId: conv.id, userId: owner },
            },
            data: { leftAt: new Date() },
          }),
        () => svc.acceptProposal(buyer, conv.id, message.id),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(0);
  });
  it('uses the proposal payload read under its admission lock', async () => {
    const { conv, message } = await proposal();
    const payload = message.payload as {
      kind: string;
      proposal: Record<string, unknown>;
    };
    const order = await afterHeldEdit(
      (tx) =>
        tx.message.update({
          where: { id: message.id },
          data: {
            payload: {
              kind: 'proposal',
              proposal: { ...payload.proposal, price: 22 },
            } as Prisma.InputJsonValue,
          },
        }),
      () => svc.acceptProposal(buyer, conv.id, message.id),
    );
    expect(order.packageSnapshot).toMatchObject({ price: 22 });
  });
  it('rechecks conversation context after waiting for an existing context writer', async () => {
    const { conv, message } = await proposal();
    await expect(
      afterHeldEdit(
        (tx) =>
          tx.conversation.update({
            where: { id: conv.id },
            data: {
              contextType: 'order',
              contextId: 'fixture-prior-order',
              lookupKey: `order:${randomUUID()}`,
            },
          }),
        () => svc.acceptProposal(buyer, conv.id, message.id),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(0);
  });
  it('serializes competing proposal acceptances without duplicate orders', async () => {
    const { conv, message } = await proposal();
    const results = await Promise.allSettled([
      svc.acceptProposal(buyer, conv.id, message.id),
      svc.acceptProposal(buyer, conv.id, message.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected')
      expect(rejected.reason as unknown).toBeInstanceOf(ConflictException);
    expect(await db.serviceOrder.count({ where: { buyerId: buyer } })).toBe(1);
  });
});
