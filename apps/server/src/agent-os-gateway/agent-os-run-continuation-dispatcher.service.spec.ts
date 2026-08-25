import { AgentOsRunContinuationDispatcherService } from './agent-os-run-continuation-dispatcher.service';

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';

describe('AgentOsRunContinuationDispatcherService', () => {
  it('dispatches only the fenced claim and records the HTTP acknowledgement', async () => {
    const fixture = makeFixture([RUN_A]);
    fixture.worker.resumeContinuation.mockResolvedValue({
      runId: RUN_A,
      status: 'running',
      events: [],
    });

    await expect(fixture.service.dispatch(RUN_A)).resolves.toMatchObject({
      runId: RUN_A,
      status: 'running',
    });
    expect(fixture.worker.resumeContinuation).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_A,
        continuationExecutionToken: '33333333-3333-4333-8333-333333333333',
        continuationExecutionAttemptId: '44444444-4444-4444-8444-444444444444',
        continuationExecutionEpoch: 1,
      }),
    );
    expect(
      fixture.journal.completeRunContinuationDispatch,
    ).toHaveBeenCalledWith(RUN_A, '44444444-4444-4444-8444-444444444444', 1);
  });

  it('retains the durable command when the Worker response is lost', async () => {
    const fixture = makeFixture([RUN_A]);
    const failure = new Error('socket closed after accept');
    fixture.worker.resumeContinuation.mockRejectedValue(failure);

    await expect(fixture.service.dispatch(RUN_A)).rejects.toThrow(failure);
    expect(fixture.journal.failRunContinuationDispatch).toHaveBeenCalledWith(
      RUN_A,
      '44444444-4444-4444-8444-444444444444',
      1,
      failure,
    );
    expect(
      fixture.journal.completeRunContinuationDispatch,
    ).not.toHaveBeenCalled();
  });

  it('uses bounded concurrency so one hung Worker does not block the next run', async () => {
    const fixture = makeFixture([RUN_A, RUN_B]);
    let releaseFirst!: () => void;
    let markSecondStarted!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    fixture.worker.resumeContinuation.mockImplementation(
      async (request: { runId: string }) => {
        if (request.runId === RUN_A) await firstMayFinish;
        if (request.runId === RUN_B) markSecondStarted();
        return { runId: request.runId, status: 'running', events: [] };
      },
    );

    const draining = (
      fixture.service as unknown as { drainOnce(): Promise<void> }
    ).drainOnce();
    await secondStarted;
    expect(fixture.worker.resumeContinuation).toHaveBeenCalledTimes(2);

    releaseFirst();
    await draining;
  });
});

function makeFixture(runIds: string[]) {
  const journal = {
    listPendingRunContinuations: jest.fn().mockResolvedValue(runIds),
    claimRunContinuationDispatch: jest
      .fn()
      .mockImplementation((runId: string) =>
        Promise.resolve({
          kind: 'claimed',
          executionToken: '33333333-3333-4333-8333-333333333333',
          executionAttemptId: '44444444-4444-4444-8444-444444444444',
          executionEpoch: 1,
          command: { runId },
        }),
      ),
    completeRunContinuationDispatch: jest.fn().mockResolvedValue(undefined),
    failRunContinuationDispatch: jest.fn().mockResolvedValue(undefined),
    getEventsAfter: jest.fn(),
  };
  const worker = { resumeContinuation: jest.fn() };
  return {
    journal,
    worker,
    service: new AgentOsRunContinuationDispatcherService(
      journal as never,
      worker as never,
    ),
  };
}
