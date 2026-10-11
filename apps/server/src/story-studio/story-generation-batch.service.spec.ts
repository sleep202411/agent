/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers inspect structurally typed Prisma payloads. */
import {
  Prisma,
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationKind,
} from '@prisma/client';
import { StoryGenerationBatchService } from './story-generation-batch.service';

// Jest does not load .env: the mobile defaults are REQUIRED envs with no
// code fallback, so pin them for every test in this suite (and restore).
const MOBILE_IMAGE_MODEL =
  process.env.AGENT_OS_MOBILE_IMAGE_MODEL ?? 'wan-image-2.7';
const MOBILE_VIDEO_MODEL =
  process.env.AGENT_OS_MOBILE_VIDEO_MODEL ?? 'minimax-h3';
process.env.AGENT_OS_MOBILE_IMAGE_MODEL = MOBILE_IMAGE_MODEL;
process.env.AGENT_OS_MOBILE_VIDEO_MODEL = MOBILE_VIDEO_MODEL;

const actor = { userId: 'actor-1' } as never;
const scope = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  chapterId: 'chapter-1',
  batchId: 'batch-1',
};

function batch(
  overrides: Partial<{
    status: StoryGenerationBatchStatus;
    idempotencyKey: string;
    version: number;
    confirmedAt: Date | null;
    actorUserId: string;
    dispatchMode: 'parallel' | 'sequential';
    totalPoints: number;
    blockedAt: Date | null;
    blockReason: Prisma.JsonValue | null;
  }> = {},
) {
  return {
    id: scope.batchId,
    idempotencyKey: 'fixture-quote',
    workspaceId: scope.workspaceId,
    storyProjectId: scope.projectId,
    storyChapterId: scope.chapterId,
    actorUserId: 'actor-1',
    billingSubjectType: 'workspace' as const,
    billingSubjectId: 'actor-personal-workspace',
    status: StoryGenerationBatchStatus.awaiting_confirmation,
    dispatchMode: 'parallel' as const,
    totalPoints: 12,
    itemCount: 1,
    version: 0,
    quoteExpiresAt: new Date(Date.now() + 60_000),
    confirmedAt: null,
    completedAt: null,
    blockedAt: null,
    blockReason: null,
    items: [
      {
        id: 'item-1',
        ordinal: 0,
        status: itemStatus(overrides.status),
        targetKind: 'asset_spec' as const,
        targetId: 'asset-1',
        sequenceId: null,
        targetVersion: 0,
        outputKind: StoryProductionGenerationKind.image,
        modelId: 'image-1',
        schemaVersion: 'v1',
        quotedPoints: 12,
        generationId:
          itemStatus(overrides.status) ===
          StoryGenerationBatchItemStatus.submitted
            ? 'generation-1'
            : null,
        error: null,
        generation:
          itemStatus(overrides.status) ===
          StoryGenerationBatchItemStatus.submitted
            ? { id: 'generation-1', aiJobId: 'job-1' }
            : null,
      },
    ],
    ...overrides,
  };
}

describe('StoryGenerationBatchService quote payer snapshot', () => {
  it('freezes the resolved personal payer into the durable quote', async () => {
    const created = batch();
    const create = jest.fn().mockResolvedValue(created);
    const prisma = {
      storyGenerationBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
      },
      walletAccount: {
        findUnique: jest.fn().mockResolvedValue({ availableBalance: 100n }),
      },
    };
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: scope.workspaceId },
      }),
    };
    const generations = {
      quoteAssetGeneration: jest.fn().mockResolvedValue({
        targetId: 'asset-1',
        targetVersion: 0,
        outputKind: 'image',
        modelId: 'image-1',
        schemaVersion: 'v1',
        options: {},
        quotedPoints: 12,
        pricingVersion: 'price-v1',
      }),
    };
    const aiGeneration = {
      resolveStoryBillingSubject: jest.fn().mockResolvedValue({
        type: 'workspace',
        id: 'actor-personal-workspace',
      }),
      getBillingSubjectComputeBalance: jest.fn().mockResolvedValue({
        available: 100n,
        held: 0n,
        total: 100n,
      }),
    };
    const service = new StoryGenerationBatchService(
      prisma as never,
      permissions as never,
      generations as never,
      aiGeneration as never,
    );

    const result = await service.quoteAssets(
      actor,
      scope.projectId,
      scope.chapterId,
      'key-1',
      {
        targets: [{ id: 'asset-1', expectedVersion: 0 }],
        modelId: 'image-1',
        schemaVersion: 'v1',
        outputKind: 'image',
        options: {},
      },
    );

    expect(aiGeneration.resolveStoryBillingSubject).toHaveBeenCalledWith(
      actor,
      scope.projectId,
    );
    const calls = create.mock.calls as unknown[][];
    const input = calls[0]?.[0] as
      | {
          data?: {
            billingSubjectType?: string;
            billingSubjectId?: string;
          };
        }
      | undefined;
    expect(input?.data).toMatchObject({
      billingSubjectType: 'workspace',
      billingSubjectId: 'actor-personal-workspace',
    });
    expect(result).toMatchObject({ availablePoints: '100' });
  });
});

describe('mobile generation defaults', () => {
  it.each([undefined, '16:9', '9:16'] as const)(
    'isolates App pinned models and ratio from Studio preferences (%s)',
    async (aspectRatio) => {
      const preference = jest.fn().mockResolvedValue({
        imageModelId: 'studio-image',
        videoModelId: 'studio-video',
      });
      const quoteStoryboardClipGeneration = jest.fn().mockResolvedValue({
        targetId: 'clip',
        targetVersion: 0,
        outputKind: 'video',
        modelId: 'video',
        schemaVersion: 'v1',
        options: {},
        quotedPoints: 12,
        pricingVersion: 'p1',
      });
      const service = new StoryGenerationBatchService(
        {
          storyGenerationBatch: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(batch()),
          },
          storyStoryboardClip: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'image-clip',
                sequenceId: 'seq',
                version: 0,
                kind: 'image',
              },
              {
                id: 'video-clip',
                sequenceId: 'seq',
                version: 0,
                kind: 'video',
              },
            ]),
          },
          agentOsModelPreference: { findUnique: preference },
        } as never,
        {
          requireProject: jest
            .fn()
            .mockResolvedValue({ project: { workspaceId: scope.workspaceId } }),
        } as never,
        { quoteStoryboardClipGeneration } as never,
        {
          listCatalog: jest.fn().mockResolvedValue({
            models: [
              {
                id: 'studio-image',
                type: 'image',
                enabled: true,
                schemaVersion: 'v1',
              },
              {
                id: 'studio-video',
                type: 'video',
                enabled: true,
                schemaVersion: 'v1',
              },
            ],
          }),
          resolveStoryBillingSubject: jest
            .fn()
            .mockResolvedValue({ type: 'workspace', id: 'payer' }),
          getBillingSubjectComputeBalance: jest
            .fn()
            .mockResolvedValue({ available: 100n, held: 0n, total: 100n }),
        } as never,
      );
      await service.quoteStoryboardClips(
        actor,
        scope.projectId,
        scope.chapterId,
        'quote',
        {
          targets: ['image-clip', 'video-clip'].map((id) => ({
            id,
            sequenceId: 'seq',
            expectedVersion: 0,
          })),
        },
        aspectRatio
          ? {
              dispatchMode: 'sequential',
              models: {
                image: { modelId: 'app-image', schemaVersion: 'pinned' },
                video: {
                  modelId: 'app-video',
                  schemaVersion: 'pinned',
                  options: { aspectRatio },
                },
              },
            }
          : undefined,
      );
      expect(quoteStoryboardClipGeneration).toHaveBeenNthCalledWith(
        1,
        actor,
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        'seq',
        'image-clip',
        {
          expectedVersion: 0,
          modelId: aspectRatio ? 'app-image' : 'studio-image',
          schemaVersion: aspectRatio ? 'pinned' : 'v1',
          options: {},
        },
      );
      expect(quoteStoryboardClipGeneration).toHaveBeenNthCalledWith(
        2,
        actor,
        scope.workspaceId,
        scope.projectId,
        scope.chapterId,
        'seq',
        'video-clip',
        {
          expectedVersion: 0,
          modelId: aspectRatio ? 'app-video' : 'studio-video',
          schemaVersion: aspectRatio ? 'pinned' : 'v1',
          options: aspectRatio ? { aspectRatio } : {},
        },
      );
      expect(preference).toHaveBeenCalledTimes(aspectRatio ? 0 : 2);
    },
  );

  it('overrides client preferences for a new quote and replays the frozen quote without reselecting models', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...batch(),
          requestFingerprint: data.requestFingerprint,
        }),
      );
    const quoteAssetGeneration = jest.fn().mockResolvedValue({
      targetId: 'asset-1',
      targetVersion: 0,
      outputKind: 'image',
      modelId: 'wan-image-2.7',
      schemaVersion: 'wan-v1',
      options: { resolution: '1K' },
      quotedPoints: 12,
      pricingVersion: 'price-v1',
    });
    const listCatalog = jest.fn().mockResolvedValue({
      models: [
        {
          id: process.env.AGENT_OS_MOBILE_IMAGE_MODEL || 'wan-image-2.7',
          type: 'image',
          enabled: true,
          schemaVersion: 'wan-v1',
        },
      ],
    });
    const service = new StoryGenerationBatchService(
      { storyGenerationBatch: { findUnique, create } } as never,
      {
        requireProject: jest
          .fn()
          .mockResolvedValue({ project: { workspaceId: scope.workspaceId } }),
      } as never,
      { quoteAssetGeneration } as never,
      {
        listCatalog,
        resolveStoryBillingSubject: jest
          .fn()
          .mockResolvedValue({ type: 'workspace', id: 'payer' }),
        getBillingSubjectComputeBalance: jest
          .fn()
          .mockResolvedValue({ available: 100n }),
      } as never,
    );
    const request = {
      targets: [{ id: 'asset-1', expectedVersion: 0 }],
      modelId: 'old-slow-model',
      outputKind: 'image' as const,
      options: { resolution: '4K' },
    };
    const execution = {
      experience: 'mobile_h5' as const,
      dispatchMode: 'sequential' as const,
    };
    await service.quoteAssets(
      actor,
      scope.projectId,
      scope.chapterId,
      'mobile-quote',
      request,
      execution,
    );
    expect(quoteAssetGeneration).toHaveBeenCalledWith(
      actor,
      scope.workspaceId,
      scope.projectId,
      scope.chapterId,
      'asset-1',
      expect.objectContaining({
        modelId: process.env.AGENT_OS_MOBILE_IMAGE_MODEL || 'wan-image-2.7',
        schemaVersion: 'wan-v1',
        options: { resolution: '1K' },
      }),
    );
    const saved = (await create.mock.results[0].value) as ReturnType<
      typeof batch
    >;
    findUnique.mockResolvedValue(saved);
    listCatalog.mockRejectedValue(new Error('New model unavailable'));
    await expect(
      service.quoteAssets(
        actor,
        scope.projectId,
        scope.chapterId,
        'mobile-quote',
        request,
        execution,
      ),
    ).resolves.toMatchObject({ id: scope.batchId });
    expect(quoteAssetGeneration).toHaveBeenCalledTimes(1);
    expect(listCatalog).toHaveBeenCalledTimes(1);
  });
});

function makeService(
  initial: ReturnType<typeof batch>,
  winner: ReturnType<typeof batch>,
) {
  const updateBatch = jest
    .fn<Promise<{ count: number }>, [unknown]>()
    .mockResolvedValue({ count: 1 });
  const updateItems = jest
    .fn<Promise<{ count: number }>, [unknown]>()
    .mockResolvedValue({ count: 1 });
  const countItems = jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1);
  const findItems = jest
    .fn<Promise<Array<{ generation: { aiJobId: string } }>>, [unknown]>()
    .mockResolvedValue([{ generation: { aiJobId: 'job-1' } }]);
  const cancelJob = jest
    .fn<Promise<unknown>, [unknown, string]>()
    .mockResolvedValue({});
  const createHandoff = jest.fn().mockResolvedValue({});
  const transaction = jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
    (callback) =>
      Promise.resolve(
        callback({
          storyGenerationBatch: { updateMany: updateBatch },
          storyGenerationBatchItem: {
            updateMany: updateItems,
            count: countItems,
          },
          agentOsExternalHandoffRegistration: { create: createHandoff },
        }),
      ),
  );
  const getBillingSubjectComputeBalance = jest.fn().mockResolvedValue({
    available: 100n,
    held: 0n,
    total: 100n,
  });
  const prisma = {
    storyGenerationBatch: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(initial)
        .mockResolvedValue(winner),
      updateMany: updateBatch,
    },
    storyGenerationBatchItem: {
      updateMany: updateItems,
      count: countItems,
      findMany: findItems,
    },
    $transaction: transaction,
  };
  const permissions = {
    requireProject: jest.fn().mockResolvedValue({
      project: { workspaceId: scope.workspaceId },
    }),
  };
  const service = new StoryGenerationBatchService(
    prisma as never,
    permissions as never,
    {} as never,
    { cancelJob, getBillingSubjectComputeBalance } as never,
  );
  return {
    service,
    prisma,
    updateBatch,
    updateItems,
    countItems,
    findItems,
    cancelJob,
    getBillingSubjectComputeBalance,
    transaction,
    createHandoff,
  };
}

describe('StoryGenerationBatchService confirmation', () => {
  it('requires Server authority before admitting App batch spending', async () => {
    const initial = batch({ idempotencyKey: 'app:run:asset_media:0' });
    const { service, updateBatch } = makeService(initial, initial);
    await expect(
      service.confirm(actor, scope.projectId, scope.chapterId, scope.batchId, {
        expectedVersion: 0,
      }),
    ).rejects.toThrow('Server production authorization');
    expect(updateBatch).not.toHaveBeenCalled();
  });

  it('atomically moves a quoted batch and its items into the dispatch queue', async () => {
    const initial = batch();
    const winner = batch({
      status: StoryGenerationBatchStatus.queued,
      version: 1,
      confirmedAt: new Date(),
    });
    const { service, updateBatch, updateItems } = makeService(initial, winner);

    const result = await service.confirm(
      actor,
      scope.projectId,
      scope.chapterId,
      scope.batchId,
      { expectedVersion: 0 },
    );
    expect(result).toMatchObject({
      status: StoryGenerationBatchStatus.queued,
      version: 1,
    });
    expect(result).not.toHaveProperty('workspaceId');

    expect(updateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: scope.batchId,
          status: StoryGenerationBatchStatus.awaiting_confirmation,
          version: 0,
        },
      }),
    );
    expect(updateItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          batchId: scope.batchId,
          status: StoryGenerationBatchItemStatus.awaiting_confirmation,
        },
      }),
    );
  });

  it('admits a sequential H5 batch even when only the first items are currently affordable', async () => {
    const initial = batch({ dispatchMode: 'sequential', totalPoints: 120 });
    const winner = batch({
      status: StoryGenerationBatchStatus.queued,
      version: 1,
      confirmedAt: new Date(),
      dispatchMode: 'sequential',
      totalPoints: 120,
    });
    const { service, updateBatch } = makeService(initial, winner);

    await expect(
      service.confirm(actor, scope.projectId, scope.chapterId, scope.batchId, {
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({
      status: StoryGenerationBatchStatus.queued,
      dispatchMode: 'sequential',
    });
    expect(updateBatch).toHaveBeenCalled();
  });

  it('returns the concurrent winner instead of queueing the same batch twice', async () => {
    const initial = batch();
    const winner = batch({
      status: StoryGenerationBatchStatus.running,
      version: 1,
      confirmedAt: new Date(),
    });
    const { service, updateBatch, updateItems } = makeService(initial, winner);
    updateBatch.mockResolvedValue({ count: 0 });

    await expect(
      service.confirm(actor, scope.projectId, scope.chapterId, scope.batchId, {
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({
      status: StoryGenerationBatchStatus.running,
      version: 1,
    });
    expect(updateItems).not.toHaveBeenCalled();
  });

  it('fails closed when another batch already owns the chapter active slot', async () => {
    const initial = batch();
    const { service, transaction } = makeService(initial, initial);
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('active batch conflict', {
        code: 'P2002',
        clientVersion: '7.8.0',
      }),
    );

    await expect(
      service.confirm(actor, scope.projectId, scope.chapterId, scope.batchId, {
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STORY_GENERATION_BATCH_ALREADY_ACTIVE' },
    });
  });

  it('rejects an unaffordable quote before it enters the queue', async () => {
    const initial = batch();
    const {
      service,
      getBillingSubjectComputeBalance,
      updateBatch,
      updateItems,
    } = makeService(initial, initial);
    getBillingSubjectComputeBalance.mockResolvedValue({
      available: 0n,
      held: 0n,
      total: 0n,
    });

    await expect(
      service.confirm(actor, scope.projectId, scope.chapterId, scope.batchId, {
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        requiredAmount: '12',
        availableBalance: '0',
      },
    });
    expect(updateBatch).not.toHaveBeenCalled();
    expect(updateItems).not.toHaveBeenCalled();
  });

  it('pauses an authorized H5 batch for recharge and preserves its Agent handoff', async () => {
    const initial = batch({ dispatchMode: 'sequential' });
    const winner = batch({
      status: StoryGenerationBatchStatus.blocked,
      version: 1,
      confirmedAt: new Date(),
      dispatchMode: 'sequential',
      blockedAt: new Date(),
      blockReason: {
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        requiredAmount: '12',
        availableBalance: '0',
      },
    });
    const {
      service,
      getBillingSubjectComputeBalance,
      updateBatch,
      updateItems,
      createHandoff,
    } = makeService(initial, winner);
    getBillingSubjectComputeBalance.mockResolvedValue({
      available: 0n,
      held: 0n,
      total: 0n,
    });

    await expect(
      service.confirm(
        actor,
        scope.projectId,
        scope.chapterId,
        scope.batchId,
        { expectedVersion: 0 },
        {
          sourceAgentRunId: 'agent-run-1',
          sourceAgentTurnId: 'agent-turn-1',
          sourceAgentToolCallId: 'tool-call-1',
          sourceConversationId: 'conversation-1',
          startedMessage: '正在逐张生成。',
          completionMessage: '资产图片已全部生成。',
          continuationPlan: {
            continueThrough: 'storyboard',
            title: 'Cat',
            summary: 'Cat story',
            brief: 'Create a cat story.',
            experience: 'mobile_h5',
            autoGenerateAssetImages: true,
          },
        },
      ),
    ).resolves.toMatchObject({ status: StoryGenerationBatchStatus.blocked });
    expect(updateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: StoryGenerationBatchStatus.blocked,
          blockReason: expect.objectContaining({
            code: 'INSUFFICIENT_COMPUTE_POINTS',
          }),
        }),
      }),
    );
    expect(updateItems).not.toHaveBeenCalled();
    expect(createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generationBatchId: scope.batchId,
          sourceToolId: 'story.generation.confirmBatch',
        }),
      }),
    );
  });
});

describe('StoryGenerationBatchService cancellation', () => {
  it('keeps submitted provider work in an explicit cancelling state', async () => {
    const initial = batch({ status: StoryGenerationBatchStatus.running });
    const winner = batch({ status: StoryGenerationBatchStatus.cancelling });
    const { service, updateBatch, updateItems, cancelJob } = makeService(
      initial,
      winner,
    );

    await expect(
      service.cancel(actor, scope.projectId, scope.chapterId, scope.batchId),
    ).resolves.toMatchObject({
      status: StoryGenerationBatchStatus.cancelling,
    });
    const batchUpdate = updateBatch.mock.calls[0]?.[0] as {
      data: { status: StoryGenerationBatchStatus; completedAt: Date | null };
    };
    expect(batchUpdate.data).toMatchObject({
      status: StoryGenerationBatchStatus.cancelling,
      completedAt: null,
    });
    const itemUpdate = updateItems.mock.calls[0]?.[0] as {
      data: { status: StoryGenerationBatchItemStatus };
    };
    expect(itemUpdate.data).toMatchObject({
      status: StoryGenerationBatchItemStatus.cancelled,
    });
    expect(cancelJob).toHaveBeenCalledWith(actor, 'job-1');
  });

  it('finalizes cancellation immediately when nothing reached a provider', async () => {
    const initial = batch();
    const winner = batch({ status: StoryGenerationBatchStatus.cancelled });
    const { service, updateBatch, countItems, findItems, cancelJob } =
      makeService(initial, winner);
    countItems.mockResolvedValue(0);
    findItems.mockResolvedValue([]);

    await expect(
      service.cancel(actor, scope.projectId, scope.chapterId, scope.batchId),
    ).resolves.toMatchObject({
      status: StoryGenerationBatchStatus.cancelled,
    });
    expect(updateBatch).toHaveBeenCalledTimes(2);
    const terminalUpdate = updateBatch.mock.calls[1]?.[0] as {
      where: { id: string; status: StoryGenerationBatchStatus };
      data: { status: StoryGenerationBatchStatus };
    };
    expect(terminalUpdate.where).toEqual({
      id: scope.batchId,
      status: StoryGenerationBatchStatus.cancelling,
    });
    expect(terminalUpdate.data).toMatchObject({
      status: StoryGenerationBatchStatus.cancelled,
    });
    expect(cancelJob).not.toHaveBeenCalled();
  });
});

describe('StoryGenerationBatchService recovery', () => {
  it('keeps cancelled Studio batches terminal without App authorization', async () => {
    const initial = batch({
      status: StoryGenerationBatchStatus.cancelled,
      confirmedAt: new Date(),
    });
    const { service, updateBatch, updateItems } = makeService(initial, initial);
    await expect(
      service.resume(actor, scope.projectId, scope.chapterId, scope.batchId),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(updateBatch).not.toHaveBeenCalled();
    expect(updateItems).not.toHaveBeenCalled();
  });

  it('resumes a confirmed cancelled App batch under a renewed Server lease without repeating completed items', async () => {
    const initial = batch({
      status: StoryGenerationBatchStatus.cancelled,
      confirmedAt: new Date(),
      idempotencyKey: 'app:run:asset_media:0',
    });
    const winner = batch({
      status: StoryGenerationBatchStatus.queued,
      confirmedAt: initial.confirmedAt,
      idempotencyKey: initial.idempotencyKey,
    });
    const { service, updateItems } = makeService(initial, winner);
    const authority = jest.fn(async () => {});
    await service.resume(
      actor,
      scope.projectId,
      scope.chapterId,
      scope.batchId,
      authority,
    );
    expect(authority).toHaveBeenCalledTimes(1);
    expect(updateItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              StoryGenerationBatchItemStatus.awaiting_confirmation,
              StoryGenerationBatchItemStatus.failed,
              StoryGenerationBatchItemStatus.cancelled,
            ],
          },
        }),
      }),
    );
  });

  it('resumes the same blocked batch from its first unfinished item', async () => {
    const initial = batch({
      status: StoryGenerationBatchStatus.blocked,
      version: 1,
      confirmedAt: new Date(),
      dispatchMode: 'sequential',
      blockedAt: new Date(),
      blockReason: { code: 'INSUFFICIENT_COMPUTE_POINTS' },
    });
    const winner = batch({
      status: StoryGenerationBatchStatus.queued,
      version: 2,
      confirmedAt: initial.confirmedAt,
      dispatchMode: 'sequential',
    });
    const { service, updateBatch, updateItems } = makeService(initial, winner);

    await expect(
      service.resume(actor, scope.projectId, scope.chapterId, scope.batchId),
    ).resolves.toMatchObject({
      id: scope.batchId,
      status: StoryGenerationBatchStatus.queued,
      version: 2,
    });
    expect(updateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: scope.batchId,
          status: {
            in: [
              StoryGenerationBatchStatus.blocked,
              StoryGenerationBatchStatus.failed,
              StoryGenerationBatchStatus.partial_failed,
            ],
          },
          handoffResultDeliveredAt: null,
        }),
        data: expect.objectContaining({
          status: StoryGenerationBatchStatus.queued,
          blockedAt: null,
          blockReason: Prisma.DbNull,
        }),
      }),
    );
    expect(updateItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: scope.batchId,
          ordinal: { gte: 0 },
        }),
        data: expect.objectContaining({
          status: StoryGenerationBatchItemStatus.ready,
          generationId: null,
        }),
      }),
    );
  });
});

describe('StoryGenerationBatchService collaboration visibility', () => {
  it('shows a collaborator active batch without granting cancel authority', async () => {
    const own = batch({ status: StoryGenerationBatchStatus.completed });
    const collaborator = {
      ...batch({
        status: StoryGenerationBatchStatus.running,
        actorUserId: 'actor-2',
      }),
      id: 'collaborator-batch',
    };
    const findMany = jest
      .fn<Promise<Array<ReturnType<typeof batch>>>, [unknown]>()
      .mockResolvedValueOnce([own])
      .mockResolvedValueOnce([collaborator]);
    const permissions = {
      requireProject: jest.fn().mockResolvedValue({
        project: { workspaceId: scope.workspaceId },
      }),
    };
    const service = new StoryGenerationBatchService(
      { storyGenerationBatch: { findMany } } as never,
      permissions as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.list(actor, scope.projectId, scope.chapterId),
    ).resolves.toEqual([
      expect.objectContaining({
        status: StoryGenerationBatchStatus.running,
        canCancel: false,
      }),
      expect.objectContaining({
        status: StoryGenerationBatchStatus.completed,
        canCancel: true,
      }),
    ]);
    const query = findMany.mock.calls[0]?.[0] as {
      where: { OR: unknown[] };
    };
    expect(query.where.OR).toEqual([
      { actorUserId: 'actor-1' },
      {
        status: {
          in: [
            StoryGenerationBatchStatus.blocked,
            StoryGenerationBatchStatus.queued,
            StoryGenerationBatchStatus.running,
            StoryGenerationBatchStatus.cancelling,
          ],
        },
      },
    ]);
  });
});

function itemStatus(
  status: StoryGenerationBatchStatus | undefined,
): StoryGenerationBatchItemStatus {
  if (status === StoryGenerationBatchStatus.queued) {
    return StoryGenerationBatchItemStatus.ready;
  }
  if (
    status === StoryGenerationBatchStatus.running ||
    status === StoryGenerationBatchStatus.cancelling
  ) {
    return StoryGenerationBatchItemStatus.submitted;
  }
  if (status === StoryGenerationBatchStatus.cancelled) {
    return StoryGenerationBatchItemStatus.cancelled;
  }
  return StoryGenerationBatchItemStatus.awaiting_confirmation;
}

it('retains an older running batch behind twenty newer quotes without duplicates', async () => {
  const running = {
    ...batch({ status: StoryGenerationBatchStatus.running }),
    id: 'older-running',
  };
  const quotes = Array.from({ length: 20 }, (_, i) => ({
    ...batch(),
    id: `quote-${i}`,
  }));
  const findMany = jest
    .fn()
    .mockResolvedValueOnce(quotes)
    .mockResolvedValueOnce([running]);
  const service = new StoryGenerationBatchService(
    { storyGenerationBatch: { findMany } } as never,
    {
      requireProject: jest
        .fn()
        .mockResolvedValue({ project: { workspaceId: scope.workspaceId } }),
    } as never,
    {} as never,
    {} as never,
  );
  const visible = await service.list(actor, scope.projectId, scope.chapterId);
  expect(visible).toHaveLength(21);
  expect(visible[0].id).toBe('older-running');
  expect(
    (findMany.mock.calls[1] as [{ take?: number }])[0].take,
  ).toBeUndefined();
  findMany.mockResolvedValueOnce([running]).mockResolvedValueOnce([running]);
  expect(
    await service.list(actor, scope.projectId, scope.chapterId),
  ).toHaveLength(1);
});
