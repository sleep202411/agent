/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';
import { StoryPatchAuthoringError } from './story-patch-author.service';

const RUN_ID = '0197f4a2-0800-7000-8000-000000000031';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const HEARTBEAT_MS = 10_000;

const JOB = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  brief: {
    schemaVersion: 'story-patch-brief-v1',
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: 'Open the story bible with a premise about a remembered dream.',
  },
  contextJson: '{"project":{},"draft":{}}',
  document: null,
  snapshot: {
    draftRevision: 7,
    draftContentHash: 'a'.repeat(64),
    layoutRevision: 3,
  },
};

const AUTHORED_OPERATIONS = [
  {
    operationId: '0197f4a2-0800-7000-8000-000000000005',
    summary: 'Give the story a premise.',
    kind: 'story_bible.update_overview',
    payload: { logline: 'A dream remembers its author.' },
  },
];

function harness() {
  const runs = {
    expireProposals: jest.fn().mockResolvedValue(undefined),
    recoverOrphanedApplyingRuns: jest.fn().mockResolvedValue(undefined),
    claimApplyingRuns: jest.fn().mockResolvedValue([]),
    executeClaimedRun: jest.fn().mockResolvedValue(undefined),
    claimAuthoringRuns: jest
      .fn()
      .mockResolvedValueOnce([{ id: RUN_ID }])
      .mockResolvedValue([]),
    loadAuthoringJob: jest.fn().mockResolvedValue({ kind: 'job', job: JOB }),
    renewAuthoringLease: jest.fn().mockResolvedValue(true),
    completeAuthoring: jest
      .fn()
      .mockResolvedValue({ kind: 'completed', run: { id: RUN_ID } }),
    failAuthoring: jest.fn().mockResolvedValue(undefined),
  };
  const author = {
    author: jest.fn().mockResolvedValue({ operations: AUTHORED_OPERATIONS }),
  };
  const worker = new StoryAgentRunWorkerService(runs as never, author as never);
  return { runs, author, worker };
}

function claimedWorkerId(runs: ReturnType<typeof harness>['runs']): string {
  const workerId: unknown = runs.claimAuthoringRuns.mock.calls[0]?.[0];
  if (typeof workerId !== 'string') {
    throw new Error('claimAuthoringRuns was not called with a worker id.');
  }
  return workerId;
}

describe('StoryAgentRunWorkerService authoring orchestration', () => {
  beforeEach(() => {
    delete process.env.STORY_AGENT_RUN_WORKER_ENABLED;
  });

  it('drives a claimed authoring run through author and completion', async () => {
    const { runs, author, worker } = harness();

    await worker.drainOnce();
    await worker.authoringIdle();

    const workerId = claimedWorkerId(runs);
    expect(runs.loadAuthoringJob).toHaveBeenCalledWith(RUN_ID, workerId);
    expect(author.author).toHaveBeenCalledTimes(1);
    expect(author.author).toHaveBeenCalledWith({
      job: JOB,
      repairContext: undefined,
      signal: expect.any(AbortSignal),
    });
    expect(runs.completeAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.completeAuthoring).toHaveBeenCalledWith(RUN_ID, workerId, {
      operations: AUTHORED_OPERATIONS,
      authoredAgainst: JOB.snapshot,
    });
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('re-authors exactly once from a fresh base when completion reports stale_base', async () => {
    const { runs, author, worker } = harness();
    const freshJob = {
      ...JOB,
      snapshot: { ...JOB.snapshot, draftRevision: 8 },
    };
    runs.loadAuthoringJob
      .mockResolvedValueOnce({ kind: 'job', job: JOB })
      .mockResolvedValueOnce({ kind: 'job', job: freshJob });
    runs.completeAuthoring
      .mockResolvedValueOnce({ kind: 'stale_base' })
      .mockResolvedValueOnce({ kind: 'completed', run: { id: RUN_ID } });

    await worker.drainOnce();
    await worker.authoringIdle();

    const workerId = claimedWorkerId(runs);
    expect(author.author).toHaveBeenCalledTimes(2);
    expect(runs.completeAuthoring).toHaveBeenCalledTimes(2);
    expect(runs.completeAuthoring).toHaveBeenNthCalledWith(
      2,
      RUN_ID,
      workerId,
      {
        operations: AUTHORED_OPERATIONS,
        authoredAgainst: freshJob.snapshot,
      },
    );
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('fails the run when the base keeps moving after the single stale retry', async () => {
    const { runs, author, worker } = harness();
    runs.completeAuthoring.mockResolvedValue({ kind: 'stale_base' });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(author.author).toHaveBeenCalledTimes(2);
    expect(runs.failAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      expect.objectContaining({ code: 'STORY_AGENT_AUTHORING_BASE_UNSTABLE' }),
    );
  });

  it('feeds one invalid-document rejection back as a semantic repair, then succeeds', async () => {
    const { runs, author, worker } = harness();
    const rejection = {
      code: 'STORY_PATCH_ENTITY_MISSING',
      detail:
        'Cannot remove graph node clip.missing because it does not exist.',
    };
    runs.completeAuthoring
      .mockResolvedValueOnce({ kind: 'invalid', error: rejection })
      .mockResolvedValueOnce({ kind: 'completed', run: { id: RUN_ID } });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(author.author).toHaveBeenCalledTimes(2);
    expect(author.author).toHaveBeenNthCalledWith(2, {
      job: JOB,
      repairContext: {
        ...rejection,
        previousOperations: AUTHORED_OPERATIONS,
      },
      signal: expect.any(AbortSignal),
    });
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('fails the run with the dry-run error when the repaired document is invalid again', async () => {
    const { runs, author, worker } = harness();
    const firstRejection = {
      code: 'STORY_AGENT_PROPOSAL_NO_CHANGES',
      detail: 'The authored operations do not change the project.',
    };
    const secondRejection = {
      code: 'STORY_PATCH_ENTITY_MISSING',
      detail:
        'Cannot remove graph node clip.missing because it does not exist.',
    };
    runs.completeAuthoring
      .mockResolvedValueOnce({ kind: 'invalid', error: firstRejection })
      .mockResolvedValueOnce({ kind: 'invalid', error: secondRejection });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(author.author).toHaveBeenCalledTimes(2);
    expect(runs.failAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      secondRejection,
    );
  });

  it('records a StoryPatchAuthoringError with its own code', async () => {
    const { runs, author, worker } = harness();
    author.author.mockRejectedValue(
      new StoryPatchAuthoringError(
        'STORY_AGENT_AUTHORING_FAILED',
        'The Story Patch author exhausted its attempts.',
      ),
    );

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      {
        code: 'STORY_AGENT_AUTHORING_FAILED',
        detail: 'The Story Patch author exhausted its attempts.',
      },
    );
  });

  it('maps an unexpected author crash to the generic authoring failure code', async () => {
    const { runs, author, worker } = harness();
    author.author.mockRejectedValue(new Error('provider socket hangup'));

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      expect.objectContaining({
        code: 'STORY_AGENT_AUTHORING_FAILED',
        detail: expect.stringContaining('provider socket hangup'),
      }),
    );
  });

  it('aborts the model call and lands nothing when the heartbeat loses the lease', async () => {
    jest.useFakeTimers();
    try {
      const { runs, author, worker } = harness();
      runs.renewAuthoringLease.mockResolvedValue(false);
      author.author.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new Error('The authoring model call was aborted.')),
            );
          }),
      );

      await worker.drainOnce();
      await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
      await worker.authoringIdle();

      expect(runs.renewAuthoringLease).toHaveBeenCalledWith(
        RUN_ID,
        claimedWorkerId(runs),
      );
      expect(runs.completeAuthoring).not.toHaveBeenCalled();
      expect(runs.failAuthoring).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('lands nothing when the process shuts down during an in-flight author call', async () => {
    const { runs, author, worker } = harness();
    let authorStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorStarted = resolve;
    });
    author.author.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      authorStarted();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('The authoring model call was aborted.')),
        );
      });
    });

    await worker.drainOnce();
    await started;
    worker.onModuleDestroy();
    await worker.authoringIdle();

    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('does nothing when the claimed run is no longer loadable', async () => {
    const { runs, author, worker } = harness();
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'skip' });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(author.author).not.toHaveBeenCalled();
    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('stops after a completion skip without failing the run', async () => {
    const { runs, author, worker } = harness();
    runs.completeAuthoring.mockResolvedValue({ kind: 'skip' });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(author.author).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });
});
