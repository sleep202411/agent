import { StoryGenerationBatchContinuationWorkerService } from './story-generation-batch-continuation-worker.service';
import { AiJobStatus } from '@prisma/client';
import { StoryAgentRunContinuationWorkerService } from './story-agent-run-continuation-worker.service';
import { StoryProductionGenerationService } from './story-production-generation.service';

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function continuation() {
  const claim = jest.fn().mockResolvedValue([{ id: 'run', attempt: 1 }]);
  const transaction = jest.fn(
    async (callback: (tx: never) => Promise<unknown>) => callback({} as never),
  );
  const publish = jest.fn().mockResolvedValue(undefined);
  const worker = new StoryAgentRunContinuationWorkerService(
    { $queryRaw: claim, $transaction: transaction } as never,
    { publishCommitted: publish } as never,
  );
  const internal = worker as unknown as {
    deliverInTransaction: () => Promise<unknown>;
  };
  const deliver = jest
    .spyOn(internal, 'deliverInTransaction')
    .mockResolvedValue({ events: [] });
  return { worker, claim, transaction, publish, deliver };
}

function production() {
  const read = jest.fn().mockResolvedValue({
    id: 'generation',
    materializedAt: null,
    reconcileAttempts: 0,
    aiJob: { status: AiJobStatus.completed },
  });
  const register = jest.fn().mockReturnValue(jest.fn());
  const service = new StoryProductionGenerationService(
    { storyProductionGeneration: { findFirst: read } } as never,
    {} as never,
    {} as never,
    {} as never,
    { register } as never,
    {} as never,
    {} as never,
  );
  const internal = service as unknown as {
    claimCompletedGenerations: () => Promise<string[]>;
    claimCompletedGeneration: () => Promise<boolean>;
    materializeGeneration: () => Promise<void>;
    reconcileCompletedGeneration: (id: string, job: boolean) => Promise<void>;
  };
  const claim = jest
    .spyOn(internal, 'claimCompletedGenerations')
    .mockResolvedValue(['generation']);
  const claimOne = jest
    .spyOn(internal, 'claimCompletedGeneration')
    .mockResolvedValue(true);
  const materialize = jest
    .spyOn(internal, 'materializeGeneration')
    .mockResolvedValue(undefined);
  return { service, internal, read, register, claim, claimOne, materialize };
}

describe('Story reconciliation shutdown', () => {
  it('does not deliver a continuation claim returned after shutdown or restart its timer', async () => {
    const h = continuation();
    const pending = gate<unknown[]>();
    h.claim.mockReturnValueOnce(pending.promise);
    const drain = h.worker.drainOnce();
    h.worker.onModuleDestroy();
    pending.resolve([{ id: 'run', attempt: 1 }]);
    await drain;
    h.worker.onApplicationBootstrap();
    await h.worker.drainOnce();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('does not begin continuation writes after a delayed transaction admission', async () => {
    const h = continuation();
    const entered = gate<void>();
    const release = gate<void>();
    h.transaction.mockImplementationOnce(async (callback) => {
      entered.resolve();
      await release.promise;
      return callback({} as never);
    });
    const drain = h.worker.drainOnce();
    await entered.promise;
    h.worker.onModuleDestroy();
    release.resolve();
    await drain;
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it('publishes an already admitted continuation transaction after shutdown', async () => {
    const h = continuation();
    const entered = gate<void>();
    const release = gate<void>();
    h.deliver.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { events: [] };
    });
    const drain = h.worker.drainOnce();
    await entered.promise;
    h.worker.onModuleDestroy();
    release.resolve();
    await drain;
    expect(h.publish).toHaveBeenCalledTimes(1);
    await h.worker.drainOnce();
    expect(h.claim).toHaveBeenCalledTimes(1);
  });

  it('discards production batch claims returned after shutdown', async () => {
    const h = production();
    const pending = gate<string[]>();
    h.claim.mockReturnValueOnce(pending.promise);
    const drain = h.service.drainOnce();
    h.service.onModuleDestroy();
    pending.resolve(['generation']);
    await drain;
    h.service.onApplicationBootstrap();
    await h.service.drainOnce();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.read).not.toHaveBeenCalled();
  });

  it.each(['read', 'claim'] as const)(
    'does not materialize after a delayed %s',
    async (phase) => {
      const h = production();
      const entered = gate<void>();
      const release = gate<void>();
      if (phase === 'read')
        h.read.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return { id: 'generation', aiJob: { status: AiJobStatus.completed } };
        });
      else
        h.claimOne.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return true;
        });
      const work = h.internal.reconcileCompletedGeneration('generation', false);
      await entered.promise;
      h.service.onModuleDestroy();
      release.resolve();
      await work;
      expect(h.materialize).not.toHaveBeenCalled();
      await h.internal.reconcileCompletedGeneration('generation', false);
      expect(h.read).toHaveBeenCalledTimes(1);
    },
  );

  it('finishes admitted materialization without starting another drain', async () => {
    const h = production();
    const entered = gate<void>();
    const release = gate<void>();
    h.materialize.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const drain = h.service.drainOnce();
    await entered.promise;
    h.service.onModuleDestroy();
    release.resolve();
    await drain;
    await h.service.drainOnce();
    expect(h.materialize).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledTimes(1);
  });
});

describe('Story batch continuation shutdown', () => {
  it.each(['admission', 'publication'] as const)(
    'stops queued work during %s',
    async (phase) => {
      const entered = gate<void>();
      const release = gate<void>();
      const transaction = jest.fn(
        async (callback: (tx: never) => Promise<unknown>) => {
          if (phase === 'admission') {
            entered.resolve();
            await release.promise;
          }
          return callback({} as never);
        },
      );
      const publish = jest.fn(async () => {
        entered.resolve();
        await release.promise;
      });
      const worker = new StoryGenerationBatchContinuationWorkerService(
        { $transaction: transaction } as never,
        { publishCommitted: publish } as never,
      );
      const internal = worker as unknown as {
        deliverNextInTransaction: () => Promise<unknown>;
      };
      const deliver = jest
        .spyOn(internal, 'deliverNextInTransaction')
        .mockResolvedValue({ events: [] });
      const drain = worker.drainOnce();
      await entered.promise;
      worker.onModuleDestroy();
      release.resolve();
      await drain;
      worker.onApplicationBootstrap();
      await worker.drainOnce();
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(deliver).toHaveBeenCalledTimes(phase === 'admission' ? 0 : 1);
      expect(publish).toHaveBeenCalledTimes(phase === 'admission' ? 0 : 1);
    },
  );
});
