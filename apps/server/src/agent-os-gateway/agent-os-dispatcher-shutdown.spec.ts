import { AgentOsRunStartDispatcherService } from './agent-os-run-start-dispatcher.service';
import { AgentOsRunContinuationDispatcherService } from './agent-os-run-continuation-dispatcher.service';

describe.each([
  [
    AgentOsRunStartDispatcherService,
    'listPendingRunStarts',
    'claimRunStartDispatch',
    'startRun',
  ],
  [
    AgentOsRunContinuationDispatcherService,
    'listPendingRunContinuations',
    'claimRunContinuationDispatch',
    'resumeContinuation',
  ],
] as const)(
  '%s shutdown admission',
  (Service, listMethod, claimMethod, workerMethod) => {
    it.each(['list', 'claim'])(
      'does not send a run after shutdown during %s',
      async (phase) => {
        let release!: () => void;
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const pause = async (at: string) => {
          if (phase === at) {
            entered();
            await pending;
          }
        };
        const list = jest.fn(async () => {
          await pause('list');
          return ['run'];
        });
        const claim = jest.fn(async () => {
          await pause('claim');
          return { kind: 'claimed', command: {} };
        });
        const send = jest.fn().mockResolvedValue({ runId: 'run' });
        const service = new Service(
          {
            [listMethod]: list,
            [claimMethod]: claim,
            completeRunStartDispatch: jest.fn(),
            completeRunContinuationDispatch: jest.fn(),
          } as never,
          { [workerMethod]: send } as never,
        );
        const internal = service as unknown as { drainOnce(): Promise<void> };
        const work = internal.drainOnce();
        await started;
        service.onApplicationShutdown();
        release();
        await work;
        await internal.drainOnce();
        await service.dispatch('run');
        expect(list).toHaveBeenCalledTimes(1);
        expect(claim).toHaveBeenCalledTimes(phase === 'claim' ? 1 : 0);
        expect(send).not.toHaveBeenCalled();
      },
    );
  },
);

describe.each([
  [
    AgentOsRunStartDispatcherService,
    'listPendingRunStarts',
    'claimRunStartDispatch',
    'startRun',
  ],
  [
    AgentOsRunContinuationDispatcherService,
    'listPendingRunContinuations',
    'claimRunContinuationDispatch',
    'resumeContinuation',
  ],
] as const)(
  '%s background task isolation',
  (Service, listMethod, claimMethod, workerMethod) => {
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

    it('does not schedule, claim or send runs through any admission entry', async () => {
      const list = jest.fn().mockResolvedValue(['run']);
      const claim = jest
        .fn()
        .mockResolvedValue({ kind: 'claimed', command: {} });
      const send = jest.fn();
      const complete = jest.fn();
      const service = new Service(
        {
          [listMethod]: list,
          [claimMethod]: claim,
          completeRunStartDispatch: complete,
          completeRunContinuationDispatch: complete,
        } as never,
        { [workerMethod]: send } as never,
      );

      service.onModuleInit();
      await (service as unknown as { drainOnce(): Promise<void> }).drainOnce();
      await expect(service.dispatch('run')).resolves.toBeNull();

      expect(jest.getTimerCount()).toBe(0);
      expect(list).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    });

    it('checks the gate again after an asynchronous claim before worker IO', async () => {
      process.env.BACKGROUND_TASKS_ENABLED = 'true';
      const claim = jest.fn(() => {
        process.env.BACKGROUND_TASKS_ENABLED = 'false';
        return Promise.resolve({ kind: 'claimed', command: {} });
      });
      const send = jest.fn();
      const complete = jest.fn();
      const service = new Service(
        {
          [claimMethod]: claim,
          completeRunStartDispatch: complete,
          completeRunContinuationDispatch: complete,
        } as never,
        { [workerMethod]: send } as never,
      );

      await expect(service.dispatch('run')).resolves.toBeNull();
      expect(claim).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    });
  },
);
