import { ConflictException } from '@nestjs/common';
import { AiGenerationOutboxService } from './outbox.service';
import { AiGenerationQueueService } from './queue.service';
import { AiGenerationWorkerService } from './worker.service';
import { CharacterProviderSyncService } from './providers/byteplus/assets/character-provider-sync.service';
import { MediaAssetProviderSyncService } from './providers/byteplus/assets/media-asset-provider-sync.service';
import type { AiJob } from './types';

describe('paused AI background tasks', () => {
  const previous = process.env.BACKGROUND_TASKS_ENABLED;

  beforeEach(() => {
    process.env.BACKGROUND_TASKS_ENABLED = 'false';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = previous;
    jest.restoreAllMocks();
  });

  it('leaves durable jobs out of Redis and skips startup recovery', async () => {
    const findMany = jest.fn();
    const queueFor = jest.fn();
    const service = new AiGenerationQueueService({
      aiJob: { findMany },
    } as never);
    Object.assign(service, { queueFor });
    const timer = jest.spyOn(global, 'setInterval');

    service.onApplicationBootstrap();
    await service['recoverQueuedJobs']();
    await service.enqueue('ai-video-generation', 'durable-job');
    await service.enqueue('ai-video-generation', 'durable-job', 100, 5, 'poll');

    expect(timer).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(queueFor).not.toHaveBeenCalled();
    expect(() => service.getConnection()).toThrow(ConflictException);
  });

  it('does not admit a consumer or process a direct queue delivery', async () => {
    const getConnection = jest.fn();
    const findById = jest.fn();
    const enqueue = jest.fn();
    const worker = Object.assign(
      Object.create(AiGenerationWorkerService.prototype) as {
        onApplicationBootstrap(): void;
        processQueueJob(job: object): Promise<void>;
        dispatchPoll(enqueue: () => Promise<void>): Promise<void>;
      },
      { queueService: { getConnection }, store: { findById } },
    );

    worker.onApplicationBootstrap();
    await worker['processQueueJob']({
      data: { jobId: 'job', op: 'start' },
    } as never);
    await worker['dispatchPoll'](enqueue);

    expect(getConnection).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('persists an event while suppressing immediate and scheduled publication', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'outbox-event' });
    const query = jest.fn();
    const findMany = jest.fn();
    const publishAssetEvent = jest.fn();
    const service = new AiGenerationOutboxService(
      { aiEventOutbox: { create, findMany }, $queryRaw: query } as never,
      { publishAssetEvent } as never,
    );
    const timer = jest.spyOn(global, 'setInterval');

    const job: AiJob = {
      id: 'job',
      userId: 'user',
      type: 'video',
      provider: 'fixture-provider',
      modelId: 'fixture-video-model',
      deployment: 'fixture-deployment',
      canonicalModelId: null,
      providerBindingId: null,
      schemaVersion: '1',
      status: 'in_queue',
      stage: 'queued',
      input: {},
      normalizedInput: {},
      prompt: 'A fixture video.',
      idempotencyKey: 'fixture-idempotency-key',
      outputs: [],
      logs: [],
      queueName: 'ai-video-generation',
      queuePosition: 0,
      attempt: 1,
      createdAt: '2026-10-06T00:00:00.000Z',
      queuedAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      metrics: {},
    };

    service.onApplicationBootstrap();
    await service.record(job);
    await service['drainOnce']();
    await service['tryDispatch']('outbox-event');
    await service['dispatchOne']('outbox-event');

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: 'job',
        userId: 'user',
      }) as unknown,
    });
    expect(timer).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(publishAssetEvent).not.toHaveBeenCalled();
  });

  it.each(['character', 'media'] as const)(
    'blocks %s provider registration and teardown before external I/O',
    async (kind) => {
      const findUnique = jest.fn();
      const createAssetGroup = jest.fn();
      const deleteAsset = jest.fn();
      const queue = jest.fn();
      const critical = jest.fn();
      const args = [
        {
          aiProviderExternalAsset: { findUnique },
          aiProviderMediaAssetMirror: { findUnique },
        } as never,
        {} as never,
        { createAssetGroup, deleteAsset } as never,
        {} as never,
      ] as const;
      const service =
        kind === 'character'
          ? new CharacterProviderSyncService(...args)
          : new MediaAssetProviderSyncService(...args);
      Object.assign(service, { queue, critical });
      const worker = service as unknown as {
        processAssetsJob(job: object): Promise<void>;
        processCriticalJob(job: object): Promise<void>;
        enqueueRegister(rowId: string): Promise<void>;
        enqueueCriticalTeardown(input: {
          externalAssetIds: string[];
          externalGroupIds: string[];
        }): Promise<void>;
      };

      service.onApplicationBootstrap();
      await worker.processAssetsJob({
        data: { op: 'register', externalAssetRowId: 'row', mirrorId: 'row' },
      } as never);
      await worker.processCriticalJob({
        data: { op: 'delete_asset', externalAssetId: 'provider-asset' },
      } as never);
      await worker.enqueueRegister('row');
      await worker.enqueueCriticalTeardown({
        externalAssetIds: ['provider-asset'],
        externalGroupIds: ['provider-group'],
      });
      if (service instanceof CharacterProviderSyncService) {
        await expect(service.ensureAigcGroup('character')).resolves.toBeNull();
      } else {
        await expect(
          service.enqueueAssetRegistration('asset'),
        ).resolves.toBeNull();
        await expect(service.requestAssetRegistration('asset')).rejects.toThrow(
          ConflictException,
        );
      }

      expect(findUnique).not.toHaveBeenCalled();
      expect(createAssetGroup).not.toHaveBeenCalled();
      expect(deleteAsset).not.toHaveBeenCalled();
      expect(queue).not.toHaveBeenCalled();
      expect(critical).not.toHaveBeenCalled();
    },
  );
});
