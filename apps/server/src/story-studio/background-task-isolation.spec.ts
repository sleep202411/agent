import { ConflictException } from '@nestjs/common';
import { hasFeature } from '../common/region';
import { StoryAgentRunWorkerService } from './story-agent-run-worker.service';
import { StoryAgentRunContinuationWorkerService } from './story-agent-run-continuation-worker.service';
import { StoryAgentRunService } from './story-agent-run.service';
import { StoryAgentRunRealtimeService } from './story-agent-run-realtime.service';
import { StoryGenerationBatchDispatcherService } from './story-generation-batch-dispatcher.service';
import { StoryGenerationBatchContinuationWorkerService } from './story-generation-batch-continuation-worker.service';
import { StoryProductionGenerationService } from './story-production-generation.service';
import { StoryPlaybackReconcileService } from './playback/story-playback-reconcile.service';

jest.mock('../common/region', () => ({
  ...jest.requireActual<object>('../common/region'),
  hasFeature: jest.fn().mockReturnValue(false),
}));

describe('paused Story Studio background tasks', () => {
  const previous = process.env.BACKGROUND_TASKS_ENABLED;
  const previousMediaBase = process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;

  beforeEach(() => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
    jest.mocked(hasFeature).mockReturnValue(false);
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = previous;
    if (previousMediaBase === undefined)
      delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    else process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = previousMediaBase;
    jest.restoreAllMocks();
  });

  it('does not start or drain any authoring, continuation or batch worker', async () => {
    // Empty dependencies deliberately fail if a paused entry reaches the DB,
    // journal, generation service, or authoring model.
    const authoring = new StoryAgentRunWorkerService({} as never, {} as never);
    const workers = [
      authoring,
      new StoryAgentRunContinuationWorkerService({} as never, {} as never),
      new StoryGenerationBatchDispatcherService({} as never, {} as never),
      new StoryGenerationBatchContinuationWorkerService(
        {} as never,
        {} as never,
      ),
    ];
    const timer = jest.spyOn(global, 'setInterval');
    const microtask = jest.spyOn(global, 'queueMicrotask');

    for (const worker of workers) {
      worker.onApplicationBootstrap();
      await worker.drainOnce();
    }
    authoring.wake();

    expect(timer).not.toHaveBeenCalled();
    expect(microtask).not.toHaveBeenCalled();
  });

  it('also blocks direct run claims, execution, expiry and orphan recovery', async () => {
    const transaction = jest.fn();
    const query = jest.fn();
    const service = Object.assign(
      Object.create(StoryAgentRunService.prototype) as {
        claimApplyingRuns(workerId: string, batch: number): Promise<unknown[]>;
        claimAuthoringRuns(workerId: string, batch: number): Promise<unknown[]>;
        executeClaimedRun(runId: string, workerId: string): Promise<void>;
        recoverOrphanedApplyingRuns(): Promise<void>;
        expireProposals(): Promise<void>;
      },
      { prisma: { $transaction: transaction, $queryRaw: query } },
    );

    await expect(service.claimApplyingRuns('worker', 5)).resolves.toEqual([]);
    await expect(service.claimAuthoringRuns('worker', 5)).resolves.toEqual([]);
    await service.executeClaimedRun('run', 'worker');
    await service.recoverOrphanedApplyingRuns();
    await service.expireProposals();

    expect(transaction).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('does not register or execute the generation completion reconciler', async () => {
    const register = jest.fn();
    const service = new StoryProductionGenerationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { register } as never,
      {} as never,
      {} as never,
    );
    const timer = jest.spyOn(global, 'setInterval');

    service.onApplicationBootstrap();
    await service.onAiGenerationCompleted({} as never);
    await service.drainOnce();

    expect(register).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
  });

  it('leaves committed Story Agent events in the outbox without publishing', async () => {
    const publishAssetEvent = jest.fn();
    const updateMany = jest.fn();
    const service = new StoryAgentRunRealtimeService(
      { aiEventOutbox: { updateMany } } as never,
      { publishAssetEvent } as never,
    );

    await service.publishCommitted({
      outboxId: 'outbox-event',
      eventId: 'event',
      userId: 'user',
      event: {} as never,
    });

    expect(publishAssetEvent).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects manual playback scans before claiming a database lock', async () => {
    const query = jest.fn();
    const service = new StoryPlaybackReconcileService(
      { $queryRaw: query } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.runCycle('admin')).rejects.toThrow(ConflictException);
    await expect(service.runCycle('schedule')).rejects.toThrow(
      ConflictException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('still validates required playback configuration while paused', () => {
    jest.mocked(hasFeature).mockReturnValue(true);
    delete process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS;
    const assertConfigured = jest.fn(() => {
      throw new Error('IMM configuration missing');
    });
    const assertAliyunRefreshConfigured = jest.fn(() => {
      throw new Error('CDN configuration missing');
    });
    const service = new StoryPlaybackReconcileService(
      {} as never,
      {} as never,
      { assertConfigured } as never,
      { assertAliyunRefreshConfigured } as never,
      {} as never,
    );
    const timer = jest.spyOn(global, 'setInterval');

    expect(() => service.onApplicationBootstrap()).toThrow(
      'IMM configuration missing; CDN configuration missing;',
    );
    expect(assertConfigured).toHaveBeenCalledTimes(1);
    expect(assertAliyunRefreshConfigured).toHaveBeenCalledTimes(1);
    expect(timer).not.toHaveBeenCalled();
  });

  it('does not schedule configured playback reconciliation while paused', () => {
    jest.mocked(hasFeature).mockReturnValue(true);
    process.env.MEDIA_PUBLIC_BASE_URL_ALIYUN_OSS = 'https://media.example.test';
    const service = new StoryPlaybackReconcileService(
      {} as never,
      {} as never,
      { assertConfigured: jest.fn() } as never,
      { assertAliyunRefreshConfigured: jest.fn() } as never,
      {} as never,
    );
    const timer = jest.spyOn(global, 'setInterval');

    service.onApplicationBootstrap();

    expect(timer).not.toHaveBeenCalled();
  });
});
