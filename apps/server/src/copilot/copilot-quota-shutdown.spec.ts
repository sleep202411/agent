import { CopilotQuotaService } from './copilot-quota.service';

it.each(['query', 'reconcile'])(
  'drains quota recovery during %s shutdown without admitting later attempts',
  async (phase) => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pause = async () => {
      entered();
      await pending;
    };
    const query = jest.fn(async () => {
      if (phase === 'query') await pause();
      return [{ id: 'first' }, { id: 'second' }];
    });
    const raw = jest.fn().mockResolvedValue([]);
    const service = new CopilotQuotaService(
      {} as never,
      {
        copilotQuotaChargeAttempt: { findMany: query },
        $queryRaw: raw,
      } as never,
      {} as never,
    );
    const reconcile = jest
      .spyOn(service, 'reconcileChargeAttempt')
      .mockImplementation(async () => {
        if (phase === 'reconcile') await pause();
        return true;
      });
    const work = service.drainPendingAttempts();
    await started;
    let stopped = false;
    const shutdown = Promise.resolve(service.onApplicationShutdown()).then(
      () => {
        stopped = true;
      },
    );
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
    } finally {
      release();
      await Promise.all([work, shutdown]);
    }
    expect(reconcile).toHaveBeenCalledTimes(phase === 'reconcile' ? 1 : 0);
    expect(raw).toHaveBeenCalledTimes(phase === 'query' ? 0 : 2);
    await service.drainPendingAttempts();
    expect(query).toHaveBeenCalledTimes(1);
  },
);
