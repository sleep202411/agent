import { AgentOsExternalHandoffReconcilerService } from './agent-os-external-handoff-reconciler.service';
import { AgentOsRealtimeOutboxService } from './agent-os-realtime-outbox.service';

describe('Agent OS journal background task isolation', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.BACKGROUND_TASKS_ENABLED;
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = previous;
    jest.useRealTimers();
  });

  it('blocks scheduled and request-triggered realtime delivery before any DB or Ably IO', async () => {
    const prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
      agentOsRun: { updateMany: jest.fn() },
    };
    const ably = { channels: { get: jest.fn() } };
    const outbox = new AgentOsRealtimeOutboxService(
      prisma as never,
      ably as never,
    );

    outbox.onModuleInit();
    outbox.schedule('run-1');
    await outbox.publishRun('run-1');
    await (
      outbox as unknown as { flushPending(): Promise<void> }
    ).flushPending();

    expect(jest.getTimerCount()).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.agentOsRun.updateMany).not.toHaveBeenCalled();
    expect(ably.channels.get).not.toHaveBeenCalled();
    outbox.onApplicationShutdown();
  });

  it('does not scan or reconcile handoffs from bootstrap or a direct drain', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const journal = { reconcileExternalHandoff: jest.fn() };
    const reconciler = new AgentOsExternalHandoffReconcilerService(
      prisma as never,
      journal as never,
    );

    reconciler.onApplicationBootstrap();
    await reconciler.drainOnce();

    expect(jest.getTimerCount()).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(journal.reconcileExternalHandoff).not.toHaveBeenCalled();
    reconciler.onModuleDestroy();
  });
});
