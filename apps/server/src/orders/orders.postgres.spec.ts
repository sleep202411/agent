import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
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
    const raced = db.$extends({
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
});
