import { WithdrawalProofsService } from './withdrawal-proofs.service';
import { RevenueContractsService } from './revenue-contracts.service';

describe.each([
  [WithdrawalProofsService, 'cleanup', { id: 'proof' }],
  [RevenueContractsService, 'cleanupObject', { object_key: 'contract' }],
] as const)('%p cleanup lifecycle', (Service, method, row) => {
  const original = process.env.BACKGROUND_TASKS_ENABLED;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    if (original === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = original;
  });

  function fixture() {
    const query = jest.fn().mockResolvedValue([row, row]);
    const service = Reflect.construct(Service, [
      { $queryRaw: query },
      {},
      {},
    ]) as {
      onApplicationBootstrap(): void;
      drainCleanup(): Promise<void>;
      onModuleDestroy(): Promise<void>;
      cleanup(id: string): Promise<void>;
      cleanupObject(key: string): Promise<void>;
    };
    const cleanup = jest.spyOn(service, method).mockResolvedValue(undefined);
    return { service, query, cleanup };
  }

  it.each([undefined, 'true'])(
    'runs normally with gate %s and cannot restart after shutdown',
    async (gate) => {
      if (gate === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
      else process.env.BACKGROUND_TASKS_ENABLED = gate;
      const { service, query, cleanup } = fixture();
      service.onApplicationBootstrap();
      service.onApplicationBootstrap();
      await service.drainCleanup();
      expect(query).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);
      await service.onModuleDestroy();
      service.onApplicationBootstrap();
      await service.drainCleanup();
      expect(query).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('stops between records and skips subsequent timer sweeps when paused', async () => {
    process.env.BACKGROUND_TASKS_ENABLED = 'true';
    const { service, query, cleanup } = fixture();
    cleanup.mockImplementationOnce(() => {
      process.env.BACKGROUND_TASKS_ENABLED = 'false';
      return Promise.resolve();
    });
    service.onApplicationBootstrap();
    await service.drainCleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(120_000);
    await service.drainCleanup();
    expect(query).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });
});
