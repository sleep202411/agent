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
