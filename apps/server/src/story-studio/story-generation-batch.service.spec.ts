import {
  Prisma,
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationKind,
} from '@prisma/client';
import { StoryGenerationBatchService } from './story-generation-batch.service';

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
    version: number;
    confirmedAt: Date | null;
    actorUserId: string;
  }> = {},
) {
  return {
    id: scope.batchId,
    workspaceId: scope.workspaceId,
    storyProjectId: scope.projectId,
    storyChapterId: scope.chapterId,
    actorUserId: 'actor-1',
    billingSubjectType: 'workspace' as const,
    billingSubjectId: 'actor-personal-workspace',
    status: StoryGenerationBatchStatus.awaiting_confirmation,
    totalPoints: 12,
    itemCount: 1,
    version: 0,
    quoteExpiresAt: new Date(Date.now() + 60_000),
    confirmedAt: null,
    completedAt: null,
    items: [
      {
        id: 'item-1',
        ordinal: 0,
        status: itemStatus(overrides.status),
        targetId: 'asset-1',
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
    };
    const service = new StoryGenerationBatchService(
      prisma as never,
      permissions as never,
      generations as never,
      aiGeneration as never,
    );

    await service.quoteAssets(
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
  const transaction = jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
    (callback) =>
      Promise.resolve(
        callback({
          storyGenerationBatch: { updateMany: updateBatch },
          storyGenerationBatchItem: {
            updateMany: updateItems,
            count: countItems,
          },
        }),
      ),
  );
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
    { cancelJob } as never,
  );
  return {
    service,
    prisma,
    updateBatch,
    updateItems,
    countItems,
    findItems,
    cancelJob,
    transaction,
  };
}

describe('StoryGenerationBatchService confirmation', () => {
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

describe('StoryGenerationBatchService collaboration visibility', () => {
  it('shows a collaborator active batch without granting cancel authority', async () => {
    const own = batch({ status: StoryGenerationBatchStatus.completed });
    const collaborator = batch({
      status: StoryGenerationBatchStatus.running,
      actorUserId: 'actor-2',
    });
    const findMany = jest
      .fn<Promise<Array<ReturnType<typeof batch>>>, [unknown]>()
      .mockResolvedValue([collaborator, own]);
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
