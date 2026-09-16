import { MessageType } from '@prisma/client';
import type { PrismaService } from '../infra/db/db.module';
import { ConversationRealtimeOutboxService } from './conversation-realtime-outbox.service';
import type { ConversationsService } from './conversations.service';

const NOW = new Date('2026-07-29T15:00:00.000Z');

function message() {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    authorId: 'user-1',
    type: MessageType.text,
    body: 'hello',
    payload: null,
    clientKey: 'client-1',
    createdAt: NOW,
    deletedAt: null,
  };
}

function outbox(attempt = 0) {
  return {
    id: '01910d50-4c88-7c78-92d4-16892c06a001',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    idempotencyKey: 'conversation:conversation-1:message:message-1',
    dispatchedAt: null,
    attempt,
    nextAttemptAt: null,
    lastError: null,
    lockedAt: NOW,
    lockedBy: expect.any(String) as unknown,
    deadAt: null,
    createdAt: NOW,
    message: message(),
  };
}

function buildHarness(attempt = 0) {
  const claimed = outbox(attempt);
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: claimed.id }])
      .mockResolvedValue([]),
    conversationRealtimeOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([claimed]),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    conversationRealtimeOutbox: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const conversations = {
    deliverMessageRealtime: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ConversationRealtimeOutboxService(
    prisma as unknown as PrismaService,
    conversations as unknown as ConversationsService,
  );
  return { service, prisma, tx, conversations };
}

describe('ConversationRealtimeOutboxService', () => {
  it('claims and acknowledges a committed message only after Ably delivery', async () => {
    const { service, prisma, conversations } = buildHarness();

    await service.drainOnce();

    expect(conversations.deliverMessageRealtime).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'message-1' }),
    );
    expect(prisma.conversationRealtimeOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '01910d50-4c88-7c78-92d4-16892c06a001',
        dispatchedAt: null,
        deadAt: null,
      }) as unknown,
      data: expect.objectContaining({
        dispatchedAt: expect.any(Date) as unknown,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      }) as unknown,
    });
  });

  it('releases its lease and schedules a retry after a transient failure', async () => {
    const { service, prisma, conversations } = buildHarness();
    conversations.deliverMessageRealtime.mockRejectedValueOnce(
      new Error('Ably unavailable'),
    );

    await service.drainOnce();

    expect(prisma.conversationRealtimeOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '01910d50-4c88-7c78-92d4-16892c06a001',
      }) as unknown,
      data: expect.objectContaining({
        attempt: 1,
        lastError: 'Ably unavailable',
        nextAttemptAt: expect.any(Date) as unknown,
        deadAt: null,
        lockedAt: null,
        lockedBy: null,
      }) as unknown,
    });
  });

  it('moves the row to the DLQ after the retry budget is exhausted', async () => {
    const { service, prisma, conversations } = buildHarness(11);
    conversations.deliverMessageRealtime.mockRejectedValueOnce(
      new Error('permanent rejection'),
    );

    await service.drainOnce();

    expect(prisma.conversationRealtimeOutbox.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: '01910d50-4c88-7c78-92d4-16892c06a001',
      }) as unknown,
      data: expect.objectContaining({
        attempt: 12,
        lastError: 'permanent rejection',
        nextAttemptAt: null,
        deadAt: expect.any(Date) as unknown,
      }) as unknown,
    });
  });

  it('does nothing when another drain cycle is already active', async () => {
    const { service, tx } = buildHarness();
    let release: (() => void) | undefined;
    tx.$queryRaw.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const first = service.drainOnce();
    await Promise.resolve();
    await service.drainOnce();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    release?.();
    await first;
  });
});

it('claims conversation deliveries only when ready and retains the 50-message sweep limit', async () => {
  const { service, tx, conversations } = buildHarness();
  tx.$queryRaw.mockReset().mockResolvedValue([{ id: 'available-row' }]);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  conversations.deliverMessageRealtime.mockImplementationOnce(async () => {
    entered();
    await paused;
  });
  const work = service.drainOnce();
  await started;
  try {
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await work;
  }
  expect(conversations.deliverMessageRealtime).toHaveBeenCalledTimes(50);
  expect(tx.$queryRaw).toHaveBeenCalledTimes(50);
});
