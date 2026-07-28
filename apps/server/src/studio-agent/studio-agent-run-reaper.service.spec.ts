import { StudioAgentRunReaper } from './studio-agent-run-reaper.service';
import { objectContaining } from './__tests__/typed-expect';

const THREAD_ID = '019f8d10-0000-7000-8000-000000000001';
const RUN_ID = '019f8d10-0000-7000-8000-000000000004';
const WORKFLOW_ID = RUN_ID;

/**
 * THE WEDGE, AND THE FOUR ANSWERS THAT UNDO IT.
 *
 * `thread.activeRunId` caches a fact Temporal owns. A workflow that dies without
 * reporting a terminal leaves that cache asserting a liveness nothing retracts,
 * and the thread then refuses every later message — permanently. Observed twice
 * in one morning, both times from a workflow that could not even RUN, which is
 * why nothing inside the workflow can fix it.
 *
 * The dangerous mistake in the other direction is reaping a turn that is simply
 * being born: its start command has not left the outbox, so it has no execution
 * to find. These tests pin both directions, because getting either one wrong is
 * worse than the bug.
 */
describe('StudioAgentRunReaper', () => {
  function fixture(options: {
    activeRunId?: string | null;
    run?: Record<string, unknown> | null;
    liveness?: 'open' | 'closed' | 'absent' | Error;
    commandStatus?: 'pending' | 'dispatched' | 'dead_letter' | null;
  }) {
    const terminalize = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      studioAgentRun: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.run === undefined ? { id: RUN_ID } : options.run,
          ),
      },
    };
    const prisma = {
      studioAgentThread: {
        findUnique: jest.fn().mockResolvedValue({
          activeRunId:
            options.activeRunId === undefined ? RUN_ID : options.activeRunId,
        }),
        updateMany,
      },
      studioAgentRun: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.run === undefined
              ? { id: RUN_ID, workflowId: WORKFLOW_ID, status: 'running' }
              : options.run,
          ),
      },
      studioAgentCommandOutbox: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.commandStatus === undefined
              ? { status: 'dispatched' }
              : options.commandStatus === null
                ? null
                : { status: options.commandStatus },
          ),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const temporal = {
      executionLiveness: jest.fn(() =>
        options.liveness instanceof Error
          ? Promise.reject(options.liveness)
          : Promise.resolve(options.liveness ?? 'closed'),
      ),
    };
    const reaper = new StudioAgentRunReaper(
      prisma as never,
      temporal as never,
      { terminalizeInTransaction: terminalize } as never,
    );
    return { reaper, terminalize, updateMany, temporal, prisma };
  }

  it('frees a thread whose workflow closed without reporting a terminal', async () => {
    const test = fixture({ liveness: 'closed' });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBe(RUN_ID);

    // Through the terminal service, not a raw UPDATE: that is what releases the
    // quota reservation and cancels the run's descendants along with it.
    expect(test.terminalize).toHaveBeenCalledWith(
      expect.anything(),
      objectContaining({ id: RUN_ID }),
      objectContaining({ status: 'failed' }),
      expect.any(Date),
    );
  });

  it('leaves a genuinely running turn alone', async () => {
    const test = fixture({ liveness: 'open' });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBeNull();
    expect(test.terminalize).not.toHaveBeenCalled();
  });

  /**
   * The one that would be worse than the bug. A run whose start is still in the
   * outbox has no execution to find; reaping on "not found" would kill turns at
   * the instant they are created.
   */
  it('does not reap a turn that is still being born', async () => {
    const test = fixture({ liveness: 'absent', commandStatus: 'pending' });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBeNull();
    expect(test.terminalize).not.toHaveBeenCalled();
  });

  it('reaps a start that will never happen, which wedges the thread just as hard', async () => {
    const test = fixture({ liveness: 'absent', commandStatus: 'dead_letter' });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBe(RUN_ID);
    expect(test.terminalize).toHaveBeenCalled();
  });

  it('reaps an execution that was dispatched and is now gone', async () => {
    const test = fixture({ liveness: 'absent', commandStatus: 'dispatched' });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBe(RUN_ID);
    expect(test.terminalize).toHaveBeenCalled();
  });

  /**
   * During a Temporal outage every turn looks unreachable. Reaping on that would
   * end every live conversation on the platform at once.
   */
  it('changes nothing when liveness cannot be established', async () => {
    const test = fixture({ liveness: new Error('Temporal is unreachable.') });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBeNull();
    expect(test.terminalize).not.toHaveBeenCalled();
  });

  it('clears a pointer at a run that does not exist', async () => {
    const test = fixture({ run: null });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBe(RUN_ID);
    expect(test.updateMany).toHaveBeenCalledWith({
      where: { id: THREAD_ID, activeRunId: RUN_ID },
      data: { activeRunId: null },
    });
    // Nothing to ask Temporal about — there is no workflow id to ask with.
    expect(test.temporal.executionLiveness).not.toHaveBeenCalled();
  });

  it('does nothing at all for an idle thread', async () => {
    const test = fixture({ activeRunId: null });

    await expect(test.reaper.reconcileThread(THREAD_ID)).resolves.toBeNull();
    expect(test.temporal.executionLiveness).not.toHaveBeenCalled();
    expect(test.terminalize).not.toHaveBeenCalled();
  });
});
