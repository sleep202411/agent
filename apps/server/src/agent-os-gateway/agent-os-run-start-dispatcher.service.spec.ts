import { AgentOsRunStartDispatcherService } from './agent-os-run-start-dispatcher.service';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('AgentOsRunStartDispatcherService', () => {
  it('dispatches only after a fenced claim and records HTTP acknowledgement without clearing recovery state', async () => {
    const fixture = makeFixture({
      kind: 'claimed',
      executionToken: '22222222-2222-4222-8222-222222222222',
      executionAttemptId: '33333333-3333-4333-8333-333333333333',
      executionEpoch: 7,
      command: { runId: RUN_ID },
    });
    fixture.worker.startRun.mockResolvedValue({
      runId: RUN_ID,
      status: 'running',
      events: [],
    });

    await expect(fixture.service.dispatch(RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'running',
    });
    expect(fixture.worker.startRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      startExecutionToken: '22222222-2222-4222-8222-222222222222',
      startExecutionAttemptId: '33333333-3333-4333-8333-333333333333',
      startExecutionEpoch: 7,
    });
    expect(fixture.journal.completeRunStartDispatch).toHaveBeenCalledWith(
      RUN_ID,
      '33333333-3333-4333-8333-333333333333',
      7,
    );
    expect(fixture.journal.failRunStartDispatch).not.toHaveBeenCalled();
  });

  it('releases the claim into durable retry state when Worker HTTP fails', async () => {
    const failure = new Error('worker unavailable');
    const fixture = makeFixture({
      kind: 'claimed',
      executionToken: '22222222-2222-4222-8222-222222222222',
      executionAttemptId: '33333333-3333-4333-8333-333333333333',
      executionEpoch: 7,
      command: { runId: RUN_ID },
    });
    fixture.worker.startRun.mockRejectedValue(failure);

    await expect(fixture.service.dispatch(RUN_ID)).rejects.toThrow(
      'worker unavailable',
    );
    expect(fixture.journal.failRunStartDispatch).toHaveBeenCalledWith(
      RUN_ID,
      '33333333-3333-4333-8333-333333333333',
      7,
      failure,
    );
    expect(fixture.journal.completeRunStartDispatch).not.toHaveBeenCalled();
  });

  it('does not redispatch after a crash when the Worker journal already started the run', async () => {
    const fixture = makeFixture({ kind: 'already_started' });
    fixture.journal.getEventsAfter.mockResolvedValue({
      runId: RUN_ID,
      status: 'running',
      events: [{ type: 'RunStarted' }],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
    });

    await expect(fixture.service.dispatch(RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'running',
      events: [{ type: 'RunStarted' }],
    });
    expect(fixture.worker.startRun).not.toHaveBeenCalled();
  });

  it('does not let a second pod call the Worker while a live lease exists', async () => {
    const fixture = makeFixture({ kind: 'in_flight' });
    fixture.journal.getEventsAfter.mockResolvedValue({
      runId: RUN_ID,
      status: 'queued',
      events: [],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
    });

    await expect(fixture.service.dispatch(RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'queued',
    });
    expect(fixture.worker.startRun).not.toHaveBeenCalled();
  });

  it('treats a lost Worker response as ambiguous and does not double-schedule under the live DB lease', async () => {
    const failure = new Error('socket closed after Worker accepted');
    const fixture = makeFixture({
      kind: 'claimed',
      executionToken: '22222222-2222-4222-8222-222222222222',
      executionAttemptId: '33333333-3333-4333-8333-333333333333',
      executionEpoch: 7,
      command: { runId: RUN_ID },
    });
    fixture.journal.claimRunStartDispatch
      .mockResolvedValueOnce({
        kind: 'claimed',
        executionToken: '22222222-2222-4222-8222-222222222222',
        executionAttemptId: '33333333-3333-4333-8333-333333333333',
        executionEpoch: 7,
        command: { runId: RUN_ID },
      })
      .mockResolvedValueOnce({
        kind: 'in_flight',
        leaseExpiresAt: new Date('2026-08-21T12:00:00.000Z'),
      });
    fixture.worker.startRun.mockRejectedValueOnce(failure);
    fixture.journal.getEventsAfter.mockResolvedValue({
      runId: RUN_ID,
      status: 'running',
      events: [{ type: 'RunStarted' }],
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
    });

    await expect(fixture.service.dispatch(RUN_ID)).rejects.toThrow(failure);
    await expect(fixture.service.dispatch(RUN_ID)).resolves.toMatchObject({
      runId: RUN_ID,
      status: 'running',
    });
    expect(fixture.worker.startRun).toHaveBeenCalledTimes(1);
  });
});

function makeFixture(claim: Record<string, unknown>) {
  const journal = {
    claimRunStartDispatch: jest.fn().mockResolvedValue(claim),
    completeRunStartDispatch: jest.fn().mockResolvedValue(undefined),
    failRunStartDispatch: jest.fn().mockResolvedValue(undefined),
    listPendingRunStarts: jest.fn().mockResolvedValue([]),
    getEventsAfter: jest.fn(),
  };
  const worker = { startRun: jest.fn() };
  return {
    journal,
    worker,
    service: new AgentOsRunStartDispatcherService(
      journal as never,
      worker as never,
    ),
  };
}
