/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';
import { StoryAuthoringStageError } from './story-authoring-model';
import {
  buildStoryScreenplayDocument,
  StoryScreenplaySchema,
} from '@repo/shared/story-agent';
import { storyVisualStyleSkillBySlug } from '@repo/shared';

const RUN_ID = '0197f4a2-0800-7000-8000-000000000031';
const PROJECT_ID = '0197f4a2-0800-7000-8000-000000000002';
const CHAPTER_ID = '0197f4a2-0800-7000-8000-000000000003';
const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';
const HEARTBEAT_MS = 10_000;
const CINEMATIC_REALISM_SKILL =
  storyVisualStyleSkillBySlug('cinematic-realism')!;

const JOB = {
  runId: RUN_ID,
  projectId: PROJECT_ID,
  chapterId: CHAPTER_ID,
  workspaceId: WORKSPACE_ID,
  mode: 'screenplay_required' as const,
  targetStage: 'script' as const,
  screenplaySnapshot: null,
  scriptSource: null,
  assetPlan: null,
  brief: {
    schemaVersion: 'story-patch-brief-v1',
    title: 'A remembered dream',
    summary: 'Establish the premise.',
    brief: 'Open the story bible with a premise about a remembered dream.',
  },
  creativeProfile: {
    frameProfile: 'landscape_16_9',
    durationPreset: 'short_5_15',
    visualStyle: 'cinematic-realism',
    visualStyleSkillId: CINEMATIC_REALISM_SKILL.skillId,
    visualStyleSkillVersionId: CINEMATIC_REALISM_SKILL.versionId,
    visualStylePrompt:
      'Compose grounded live-action imagery with motivated light and tactile production design.',
    storyLanguage: 'en-US',
    confirmedAt: '2026-08-21T00:00:00.000Z',
  },
  contextJson: '{"project":{},"draft":{}}',
  document: null,
  snapshot: {
    draftRevision: 7,
    draftContentHash: 'a'.repeat(64),
    layoutRevision: 3,
  },
};

const AUTHORED_SCREENPLAY = StoryScreenplaySchema.parse({
  schemaVersion: 'interactive-screenplay-v1',
  storyLanguage: 'en-US',
  title: 'A remembered dream',
  logline: 'A dream remembers its author.',
  synopsis: 'The author wakes inside the dream they abandoned.',
  characters: [],
  entrySceneId: 'opening',
  scenes: [
    {
      nodeId: 'opening',
      clipKey: 'OPENING',
      heading: 'INT. DREAM – NIGHT',
      beat: 'The dream recognizes its author.',
      action: 'A page turns itself in the dark.',
      dialogue: [],
      exit: { kind: 'auto', nextNodeId: null },
    },
  ],
});

const AUTHORED_PRODUCTION_PLAN = {
  schemaVersion: 'story-production-plan-v1',
  assetSpecs: [],
  storyboardSequences: [
    {
      plotNodeId: 'opening',
      title: 'Opening',
      description: 'The page turns itself in the dark.',
      durationMs: 10_000,
      clips: [
        {
          stableKey: 'shot.opening.main',
          kind: 'video',
          title: 'Opening shot',
          description: 'A page turns itself in the dark.',
          startMs: 0,
          durationMs: 10_000,
          videoPrompt: 'A cinematic page turns itself in a dark dream.',
        },
      ],
      cues: [],
    },
  ],
} as const;

const AUTHORED_ASSET_PLAN = {
  assetSpecs: AUTHORED_PRODUCTION_PLAN.assetSpecs,
} as const;

const AUTHORED_STORYBOARD_PLAN = {
  storyboardSequences: AUTHORED_PRODUCTION_PLAN.storyboardSequences,
} as const;

const APPROVED_SCREENPLAY = {
  documentId: '0197f4a2-0800-7000-8000-000000000041',
  versionId: '0197f4a2-0800-7000-8000-000000000042',
  sequence: 3,
  screenplay: AUTHORED_SCREENPLAY,
  document: buildStoryScreenplayDocument(AUTHORED_SCREENPLAY),
};

function harness() {
  const runs = {
    expireProposals: jest.fn().mockResolvedValue(undefined),
    recoverOrphanedApplyingRuns: jest.fn().mockResolvedValue(undefined),
    claimApplyingRuns: jest.fn().mockResolvedValue([]),
    executeClaimedRun: jest.fn().mockResolvedValue(undefined),
    failClaimedApply: jest.fn().mockResolvedValue(undefined),
    claimAuthoringRuns: jest
      .fn()
      .mockResolvedValueOnce([{ id: RUN_ID }])
      .mockResolvedValue([]),
    loadAuthoringJob: jest.fn().mockResolvedValue({ kind: 'job', job: JOB }),
    renewAuthoringLease: jest.fn().mockResolvedValue(true),
    advanceAuthoringStage: jest.fn().mockResolvedValue(undefined),
    completeAuthoring: jest
      .fn()
      .mockResolvedValue({ kind: 'completed', run: { id: RUN_ID } }),
    completeStageAuthoring: jest
      .fn()
      .mockResolvedValue({ kind: 'completed', run: { id: RUN_ID } }),
    completeNoopAuthoring: jest
      .fn()
      .mockResolvedValue({ kind: 'completed', run: { id: RUN_ID } }),
    failAuthoring: jest.fn().mockResolvedValue(undefined),
  };
  const pipeline = {
    author: jest.fn().mockResolvedValue({
      screenplay: AUTHORED_SCREENPLAY,
    }),
    planAssets: jest.fn().mockResolvedValue(AUTHORED_ASSET_PLAN),
    planStoryboard: jest.fn().mockResolvedValue(AUTHORED_STORYBOARD_PLAN),
    compileScript: jest.fn().mockResolvedValue({
      screenplay: AUTHORED_SCREENPLAY,
    }),
  };
  const worker = new StoryAgentRunWorkerService(
    runs as never,
    pipeline as never,
  );
  return { runs, pipeline, worker };
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

  it('terminalizes an escaped apply failure instead of reclaiming it forever', async () => {
    const { runs, worker } = harness();
    runs.claimApplyingRuns.mockResolvedValueOnce([{ id: RUN_ID }]);
    runs.executeClaimedRun.mockRejectedValueOnce(
      new Error('Every Plot node requires a Storyboard sequence.'),
    );
    runs.claimAuthoringRuns.mockReset().mockResolvedValue([]);

    await worker.drainOnce();

    const workerId: unknown = runs.claimApplyingRuns.mock.calls[0]?.[0];
    expect(runs.failClaimedApply).toHaveBeenCalledWith(RUN_ID, workerId, {
      code: 'STORY_AGENT_APPLY_FAILED',
      detail: 'Every Plot node requires a Storyboard sequence.',
    });
  });

  it('drives a claimed authoring run through the pipeline and completion', async () => {
    const { runs, pipeline, worker } = harness();

    await worker.drainOnce();
    await worker.authoringIdle();

    const workerId = claimedWorkerId(runs);
    expect(runs.loadAuthoringJob).toHaveBeenCalledWith(RUN_ID, workerId);
    expect(pipeline.author).toHaveBeenCalledTimes(1);
    expect(pipeline.author).toHaveBeenCalledWith({
      job: JOB,
      signal: expect.any(AbortSignal),
      onStage: expect.any(Function),
    });
    expect(runs.completeAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.completeAuthoring).toHaveBeenCalledWith(RUN_ID, workerId, {
      screenplay: AUTHORED_SCREENPLAY,
      authoredAgainst: JOB.snapshot,
    });
    expect(pipeline.planAssets).not.toHaveBeenCalled();
    expect(pipeline.planStoryboard).not.toHaveBeenCalled();
    expect(pipeline.compileScript).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('lands only a Plot proposal from the exact approved screenplay', async () => {
    const { runs, pipeline, worker } = harness();
    const job = {
      ...JOB,
      mode: 'downstream_reconcile' as const,
      targetStage: 'plot' as const,
      screenplaySnapshot: APPROVED_SCREENPLAY,
      assetPlan: null,
    };
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'job', job });

    await worker.drainOnce();
    await worker.authoringIdle();

    const workerId = claimedWorkerId(runs);
    expect(pipeline.author).not.toHaveBeenCalled();
    expect(pipeline.compileScript).not.toHaveBeenCalled();
    expect(pipeline.planAssets).not.toHaveBeenCalled();
    expect(pipeline.planStoryboard).not.toHaveBeenCalled();
    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.completeStageAuthoring).toHaveBeenCalledWith(RUN_ID, workerId, {
      targetStage: 'plot',
      screenplay: APPROVED_SCREENPLAY.screenplay,
      document: APPROVED_SCREENPLAY.document,
      authoredAgainst: JOB.snapshot,
    });
  });

  it('compiles an exact existing Script into the next Plot proposal', async () => {
    const { runs, pipeline, worker } = harness();
    const scriptSource = {
      documentId: '0197f4a2-0800-7000-8000-000000000051',
      sequence: 8,
      hash: 'b'.repeat(64),
      hasContent: true,
      sourceText: '<paragraph>The creator exact Script.</paragraph>',
      document: {
        schemaVersion: 'story-screenplay-document-v1' as const,
        blocks: [
          { kind: 'paragraph' as const, text: 'The creator exact Script.' },
        ],
      },
    };
    const job = {
      ...JOB,
      mode: 'downstream_reconcile' as const,
      targetStage: 'plot' as const,
      screenplaySnapshot: null,
      scriptSource,
      snapshot: {
        ...JOB.snapshot,
        scriptDocumentId: scriptSource.documentId,
        scriptSequence: scriptSource.sequence,
        scriptHash: scriptSource.hash,
      },
    };
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'job', job });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(pipeline.author).not.toHaveBeenCalled();
    expect(pipeline.planAssets).not.toHaveBeenCalled();
    expect(pipeline.compileScript).toHaveBeenCalledWith({
      sourceText: scriptSource.sourceText,
      document: scriptSource.document,
      title: JOB.brief.title,
      instructions: JOB.brief.brief,
      creativeProfile: JOB.creativeProfile,
      signal: expect.any(AbortSignal),
      onStage: expect.any(Function),
    });
    expect(runs.completeStageAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      {
        targetStage: 'plot',
        screenplay: AUTHORED_SCREENPLAY,
        authoredAgainst: job.snapshot,
      },
    );
  });

  it('authors only Asset Specs and leaves Storyboard for another run', async () => {
    const { runs, pipeline, worker } = harness();
    const job = {
      ...JOB,
      mode: 'downstream_reconcile' as const,
      targetStage: 'assets' as const,
      screenplaySnapshot: APPROVED_SCREENPLAY,
    };
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'job', job });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(pipeline.planAssets).toHaveBeenCalledWith({
      screenplay: APPROVED_SCREENPLAY.screenplay,
      creativeProfile: JOB.creativeProfile,
      signal: expect.any(AbortSignal),
      onStage: expect.any(Function),
    });
    expect(pipeline.planStoryboard).not.toHaveBeenCalled();
    expect(runs.completeStageAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      {
        targetStage: 'assets',
        screenplay: APPROVED_SCREENPLAY.screenplay,
        assetPlan: AUTHORED_ASSET_PLAN,
        authoredAgainst: JOB.snapshot,
      },
    );
  });

  it.each([true, false])(
    'authors Storyboard only from the approved plan without leaking App pacing (App=%s)',
    async (app) => {
      const { runs, pipeline, worker } = harness();
      const job = {
        ...JOB,
        mode: 'downstream_reconcile' as const,
        targetStage: 'storyboard' as const,
        ...(app
          ? {
              videoClipDurationSeconds: [5, 10, 15],
              creatorMessage:
                'Use the uploaded screenplay; each route is 25 seconds.',
            }
          : {}),
        document: {
          id: RUN_ID,
          name: 'screenplay.docx',
          text: 'Each playable route lasts about 20 seconds.',
        },
        screenplaySnapshot: APPROVED_SCREENPLAY,
        assetPlan: AUTHORED_ASSET_PLAN,
      };
      runs.loadAuthoringJob.mockResolvedValue({ kind: 'job', job });

      await worker.drainOnce();
      await worker.authoringIdle();

      expect(pipeline.planAssets).not.toHaveBeenCalled();
      expect(pipeline.planStoryboard).toHaveBeenCalledWith({
        ...(app
          ? {
              instructions: expect.stringContaining(job.document.text),
              videoClipDurationSeconds: [5, 10, 15],
            }
          : {}),
        screenplay: APPROVED_SCREENPLAY.screenplay,
        assetPlan: AUTHORED_ASSET_PLAN,
        creativeProfile: JOB.creativeProfile,
        signal: expect.any(AbortSignal),
        onStage: expect.any(Function),
      });
      if (app) {
        const instructions = pipeline.planStoryboard.mock.calls[0][0]
          .instructions as string;
        expect(instructions).toContain(job.creatorMessage);
        expect(instructions).toContain(JOB.brief.summary);
        expect(instructions).toContain(
          'the latest creator request takes precedence',
        );
      }
      expect(runs.completeStageAuthoring).toHaveBeenCalledWith(
        RUN_ID,
        claimedWorkerId(runs),
        {
          targetStage: 'storyboard',
          screenplay: APPROVED_SCREENPLAY.screenplay,
          assetPlan: AUTHORED_ASSET_PLAN,
          storyboardPlan: AUTHORED_STORYBOARD_PLAN,
          authoredAgainst: JOB.snapshot,
        },
      );
    },
  );

  it('completes a canonical no-op without invoking either model pipeline', async () => {
    const { runs, pipeline, worker } = harness();
    const job = {
      ...JOB,
      mode: 'noop' as const,
      targetStage: 'noop' as const,
      screenplaySnapshot: APPROVED_SCREENPLAY,
    };
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'job', job });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(pipeline.author).not.toHaveBeenCalled();
    expect(pipeline.compileScript).not.toHaveBeenCalled();
    expect(pipeline.planAssets).not.toHaveBeenCalled();
    expect(pipeline.planStoryboard).not.toHaveBeenCalled();
    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.completeNoopAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      JOB.snapshot,
    );
  });

  it('forwards each baton onStage to advanceAuthoringStage', async () => {
    const { runs, pipeline, worker } = harness();
    pipeline.author.mockImplementation(
      async ({ onStage }: { onStage: (s: string) => Promise<void> }) => {
        await onStage('foundation');
        await onStage('structure');
        return {
          screenplay: AUTHORED_SCREENPLAY,
        };
      },
    );

    await worker.drainOnce();
    await worker.authoringIdle();

    const workerId = claimedWorkerId(runs);
    expect(runs.advanceAuthoringStage).toHaveBeenNthCalledWith(
      1,
      RUN_ID,
      workerId,
      'foundation',
    );
    expect(runs.advanceAuthoringStage).toHaveBeenNthCalledWith(
      2,
      RUN_ID,
      workerId,
      'structure',
    );
  });

  it('re-authors exactly once from a fresh base when completion reports stale_base', async () => {
    const { runs, pipeline, worker } = harness();
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
    expect(pipeline.author).toHaveBeenCalledTimes(2);
    expect(runs.completeAuthoring).toHaveBeenNthCalledWith(
      2,
      RUN_ID,
      workerId,
      {
        screenplay: AUTHORED_SCREENPLAY,
        authoredAgainst: freshJob.snapshot,
      },
    );
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('fails the run when the base keeps moving after the single stale retry', async () => {
    const { runs, pipeline, worker } = harness();
    runs.completeAuthoring.mockResolvedValue({ kind: 'stale_base' });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(pipeline.author).toHaveBeenCalledTimes(2);
    expect(runs.failAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      expect.objectContaining({ code: 'STORY_AGENT_AUTHORING_BASE_UNSTABLE' }),
    );
  });

  it('fails immediately when the assembled document is rejected — no semantic-repair loop', async () => {
    const { runs, pipeline, worker } = harness();
    const rejection = {
      code: 'STORY_PATCH_ENTITY_MISSING',
      detail:
        'Cannot remove graph node clip.missing because it does not exist.',
    };
    runs.completeAuthoring.mockResolvedValue({
      kind: 'invalid',
      error: rejection,
    });

    await worker.drainOnce();
    await worker.authoringIdle();

    // Skeleton validation makes danglers impossible, so a dry-run reject is a
    // genuine assembly bug — the worker fails honestly instead of re-authoring.
    expect(pipeline.author).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      rejection,
    );
  });

  it('records a StoryAuthoringStageError with its own stage-scoped code', async () => {
    const { runs, pipeline, worker } = harness();
    pipeline.author.mockRejectedValue(
      new StoryAuthoringStageError(
        'STORY_AGENT_CONTENT_REJECTED',
        'Input text data may contain inappropriate content.',
      ),
    );

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).toHaveBeenCalledWith(
      RUN_ID,
      claimedWorkerId(runs),
      {
        code: 'STORY_AGENT_CONTENT_REJECTED',
        detail: 'Input text data may contain inappropriate content.',
      },
    );
  });

  it('maps an unexpected pipeline crash to the generic authoring failure code', async () => {
    const { runs, pipeline, worker } = harness();
    pipeline.author.mockRejectedValue(new Error('provider socket hangup'));

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
      const { runs, pipeline, worker } = harness();
      runs.renewAuthoringLease.mockResolvedValue(false);
      pipeline.author.mockImplementation(
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
    const { runs, pipeline, worker } = harness();
    let authorStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      authorStarted = resolve;
    });
    pipeline.author.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        authorStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new Error('The authoring model call was aborted.')),
          );
        });
      },
    );

    await worker.drainOnce();
    await started;
    worker.onModuleDestroy();
    await worker.authoringIdle();

    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });

  it('does nothing when the claimed run is no longer loadable', async () => {
    const { runs, pipeline, worker } = harness();
    runs.loadAuthoringJob.mockResolvedValue({ kind: 'skip' });

    await worker.drainOnce();
    await worker.authoringIdle();

    expect(pipeline.author).not.toHaveBeenCalled();
    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });
});

describe('Story worker shutdown admission', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  }
  it.each([
    'expireProposals',
    'recoverOrphanedApplyingRuns',
    'claimApplyingRuns',
    'claimAuthoringRuns',
    'loadAuthoringJob',
  ] as const)('stops after a delayed %s', async (method) => {
    const { runs, pipeline, worker } = harness();
    const entered = deferred<void>(),
      release = deferred<unknown>();
    runs[method].mockReset().mockImplementationOnce(async () => {
      entered.resolve();
      return await release.promise;
    });
    const work = worker.drainOnce();
    await entered.promise;
    worker.onModuleDestroy();
    release.resolve(
      method === 'loadAuthoringJob'
        ? { kind: 'job', job: JOB }
        : method.startsWith('claim')
          ? [{ id: RUN_ID }]
          : undefined,
    );
    await work;
    await worker.authoringIdle();
    worker.wake();
    await worker.drainOnce();
    expect(runs.expireProposals).toHaveBeenCalledTimes(1);
    expect(runs.executeClaimedRun).not.toHaveBeenCalled();
    expect(pipeline.author).not.toHaveBeenCalled();
    expect(runs.completeAuthoring).not.toHaveBeenCalled();
    expect(runs.failAuthoring).not.toHaveBeenCalled();
    const timer = jest.spyOn(global, 'setInterval');
    try {
      worker.onApplicationBootstrap();
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });
  it.each(['shutdown', 'lease loss'])(
    'ignores successful late authoring and progress after %s',
    async (reason) => {
      jest.useFakeTimers();
      try {
        const { runs, pipeline, worker } = harness();
        const entered = deferred<void>(),
          release = deferred<void>();
        let signal: AbortSignal | undefined;
        pipeline.author.mockImplementationOnce(
          async (args: {
            signal: AbortSignal;
            onStage: (stage: 'foundation') => Promise<void>;
          }) => {
            signal = args.signal;
            entered.resolve();
            await release.promise;
            await args.onStage('foundation');
            return { screenplay: AUTHORED_SCREENPLAY };
          },
        );
        await worker.drainOnce();
        await entered.promise;
        if (reason === 'shutdown') worker.onModuleDestroy();
        else {
          runs.renewAuthoringLease.mockResolvedValue(false);
          await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
        }
        expect(signal?.aborted).toBe(true);
        const renewals = runs.renewAuthoringLease.mock.calls.length;
        await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
        expect(runs.renewAuthoringLease).toHaveBeenCalledTimes(renewals);
        release.resolve();
        await worker.authoringIdle();
        expect(runs.advanceAuthoringStage).not.toHaveBeenCalled();
        expect(runs.completeAuthoring).not.toHaveBeenCalled();
        expect(runs.failAuthoring).not.toHaveBeenCalled();
        worker.onModuleDestroy();
      } finally {
        jest.useRealTimers();
      }
    },
  );
  it('does not retry a stale completion returned after shutdown', async () => {
    const { runs, worker } = harness();
    const entered = deferred<void>(),
      release = deferred<void>();
    runs.completeAuthoring.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { kind: 'stale_base' };
    });
    await worker.drainOnce();
    await entered.promise;
    worker.onModuleDestroy();
    release.resolve();
    await worker.authoringIdle();
    expect(runs.loadAuthoringJob).toHaveBeenCalledTimes(1);
    expect(runs.failAuthoring).not.toHaveBeenCalled();
  });
  it('finishes an admitted apply without starting another authoring claim', async () => {
    const { runs, worker } = harness();
    const entered = deferred<void>(),
      release = deferred<void>();
    runs.claimApplyingRuns.mockResolvedValue([{ id: RUN_ID }]);
    runs.executeClaimedRun.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const work = worker.drainOnce();
    await entered.promise;
    worker.onModuleDestroy();
    release.resolve();
    await work;
    expect(runs.executeClaimedRun).toHaveBeenCalledTimes(1);
    expect(runs.claimAuthoringRuns).not.toHaveBeenCalled();
  });
});
