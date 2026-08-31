import { ConflictException } from '@nestjs/common';
import {
  StoryGenerationBatchItemStatus,
  StoryGenerationBatchStatus,
  StoryProductionGenerationKind,
  StoryProductionGenerationTargetKind,
} from '@prisma/client';
import { StoryGenerationBatchDispatcherService } from './story-generation-batch-dispatcher.service';

describe('Story generation batch fair dispatcher', () => {
  it('admits at most one item per least-recently-served actor and skips locked work', async () => {
    const queryRaw = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([]);
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw }),
      ),
    };
    const service = new StoryGenerationBatchDispatcherService(
      prisma as never,
      {} as never,
    ) as unknown as {
      claim(limit: number): Promise<unknown[]>;
    };

    await expect(service.claim(25)).resolves.toEqual([]);
    const sql = sqlText(queryRaw.mock.calls[1]?.[0]);
    expect(sql).toContain('GROUP BY batch."actor_user_id"');
    expect(sql).toContain('ORDER BY "fairness_at" ASC');
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('FOR UPDATE OF item SKIP LOCKED');
    expect(sql).toContain('batch."dispatch_mode" <> \'sequential\'');
    expect(sql).toContain(
      "active_item.\"status\" IN ('dispatching', 'submitted')",
    );
    expect(sql).toContain('active_item."status" = \'failed\'');
    expect(sql).toContain('active_item."ordinal" < item."ordinal"');
    expect(sql).toContain('LIMIT ?');
  });

  it('stops the unstarted remainder of a sequential batch after an earlier failure', async () => {
    const executeRaw = jest
      .fn<Promise<number>, [unknown]>()
      .mockResolvedValue(2);
    const service = new StoryGenerationBatchDispatcherService(
      { $executeRaw: executeRaw } as never,
      {} as never,
    ) as unknown as {
      stopSequentialBatchesAfterFailure(): Promise<void>;
    };

    await service.stopSequentialBatchesAfterFailure();
    const sql = sqlText(executeRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('batch."dispatch_mode" = \'sequential\'');
    expect(sql).toContain('pending."status" = \'ready\'');
    expect(sql).toContain('failed."status" = \'failed\'');
    expect(sql).toContain('failed."ordinal" < pending."ordinal"');
    expect(sql).toContain("'PREVIOUS_ITEM_FAILED'");
    expect(sql).toContain('\'cancelled\'::"StoryGenerationBatchItemStatus"');
  });

  it('lets only one replica choose the globally fair actor set at a time', async () => {
    const queryRaw = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([{ acquired: false }]);
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw }),
      ),
    };
    const service = new StoryGenerationBatchDispatcherService(
      prisma as never,
      {} as never,
    ) as unknown as {
      claim(limit: number): Promise<unknown[]>;
    };

    await expect(service.claim(25)).resolves.toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(String(queryRaw.mock.calls[0]?.[0])).toContain(
      'story-generation-batch-global-fairness',
    );
  });

  it('settles all finished batches with one unbounded database update', async () => {
    const executeRaw = jest
      .fn<Promise<number>, [unknown]>()
      .mockResolvedValue(2);
    const service = new StoryGenerationBatchDispatcherService(
      { $executeRaw: executeRaw } as never,
      {} as never,
    ) as unknown as {
      refreshBatchStatuses(): Promise<void>;
    };

    await service.refreshBatchStatuses();
    const sql = sqlText(executeRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH settled AS');
    expect(sql).toContain('"active_count" = 0');
    expect(sql).toContain("'queued', 'running', 'cancelling'");
    expect(sql).toContain('"batch_status" = \'cancelling\'');
    expect(sql).toContain('UPDATE "story_generation_batches"');
    expect(sql).not.toContain('LIMIT');
  });

  it('dispatches against the payer frozen when the batch was quoted', async () => {
    const createQuotedAssetGeneration = jest.fn().mockResolvedValue({});
    const service = new StoryGenerationBatchDispatcherService(
      {} as never,
      { createQuotedAssetGeneration } as never,
    ) as unknown as {
      dispatch(item: unknown): Promise<void>;
    };

    await service.dispatch({
      id: 'item-1',
      targetKind: StoryProductionGenerationTargetKind.asset_spec,
      targetId: 'asset-1',
      targetVersion: 0,
      sequenceId: null,
      outputKind: StoryProductionGenerationKind.image,
      modelId: 'image-1',
      schemaVersion: 'v1',
      options: {},
      quotedPoints: 12,
      pricingVersion: 'price-v1',
      dispatchAttempts: 1,
      status: StoryGenerationBatchItemStatus.dispatching,
      batch: {
        actorUserId: 'actor-1',
        workspaceId: 'workspace-1',
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        billingSubjectType: 'workspace',
        billingSubjectId: 'actor-personal-workspace',
        status: StoryGenerationBatchStatus.running,
      },
    });

    expect(createQuotedAssetGeneration).toHaveBeenCalledWith(
      { userId: 'actor-1' },
      'workspace-1',
      'project-1',
      'chapter-1',
      'asset-1',
      'story-generation-batch:item-1:attempt:1',
      expect.any(Object),
      { pricingVersion: 'price-v1', points: 12 },
      { type: 'workspace', id: 'actor-personal-workspace' },
      expect.objectContaining({ itemId: 'item-1' }),
    );
  });

  it('dispatches a Storyboard clip with its sequence and frozen mixed-media quote', async () => {
    const createQuotedStoryboardClipGeneration = jest
      .fn()
      .mockResolvedValue({});
    const service = new StoryGenerationBatchDispatcherService(
      {} as never,
      { createQuotedStoryboardClipGeneration } as never,
    ) as unknown as {
      dispatch(item: unknown): Promise<void>;
    };

    await service.dispatch({
      id: 'item-video-1',
      targetKind: StoryProductionGenerationTargetKind.storyboard_clip,
      targetId: 'clip-1',
      targetVersion: 2,
      sequenceId: 'sequence-1',
      outputKind: StoryProductionGenerationKind.video,
      modelId: 'video-1',
      schemaVersion: 'v2',
      options: {
        aspectRatio: '16:9',
        duration: 6,
      },
      quotedPoints: 90,
      pricingVersion: 'price-v2',
      dispatchAttempts: 1,
      status: StoryGenerationBatchItemStatus.dispatching,
      batch: {
        actorUserId: 'actor-1',
        workspaceId: 'workspace-1',
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        billingSubjectType: 'workspace',
        billingSubjectId: 'actor-personal-workspace',
        status: StoryGenerationBatchStatus.running,
      },
    });

    expect(createQuotedStoryboardClipGeneration).toHaveBeenCalledWith(
      { userId: 'actor-1' },
      'workspace-1',
      'project-1',
      'chapter-1',
      'sequence-1',
      'clip-1',
      'story-generation-batch:item-video-1:attempt:1',
      expect.objectContaining({
        expectedVersion: 2,
        modelId: 'video-1',
        schemaVersion: 'v2',
        options: { aspectRatio: '16:9' },
      }),
      { pricingVersion: 'price-v2', points: 90 },
      { type: 'workspace', id: 'actor-personal-workspace' },
      expect.objectContaining({ itemId: 'item-video-1' }),
    );
  });

  it('blocks a sequential batch on insufficient balance without failing the current item', async () => {
    const itemUpdateMany = jest
      .fn<Promise<{ count: number }>, [unknown]>()
      .mockResolvedValue({ count: 1 });
    const batchUpdateMany = jest
      .fn<Promise<{ count: number }>, [unknown]>()
      .mockResolvedValue({ count: 1 });
    const createQuotedAssetGeneration = jest.fn().mockRejectedValue(
      new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: '60',
        availableBalance: '0',
      }),
    );
    const service = new StoryGenerationBatchDispatcherService(
      {
        $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
          callback({
            storyGenerationBatchItem: { updateMany: itemUpdateMany },
            storyGenerationBatch: { updateMany: batchUpdateMany },
          }),
        ),
      } as never,
      { createQuotedAssetGeneration } as never,
    ) as unknown as {
      dispatch(item: unknown): Promise<void>;
    };

    await service.dispatch({
      id: 'item-1',
      batchId: 'batch-1',
      ordinal: 0,
      targetKind: StoryProductionGenerationTargetKind.asset_spec,
      targetId: 'asset-1',
      targetVersion: 0,
      sequenceId: null,
      outputKind: StoryProductionGenerationKind.image,
      modelId: 'image-1',
      schemaVersion: 'v1',
      options: {},
      quotedPoints: 60,
      pricingVersion: 'price-v1',
      dispatchAttempts: 1,
      status: StoryGenerationBatchItemStatus.dispatching,
      batch: {
        actorUserId: 'actor-1',
        workspaceId: 'workspace-1',
        storyProjectId: 'project-1',
        storyChapterId: 'chapter-1',
        billingSubjectType: 'workspace',
        billingSubjectId: 'actor-personal-workspace',
        dispatchMode: 'sequential',
        status: StoryGenerationBatchStatus.running,
      },
    });

    const update = itemUpdateMany.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(update?.data).toMatchObject({
      status: StoryGenerationBatchItemStatus.ready,
    });
    const batchUpdate = batchUpdateMany.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(batchUpdate?.data).toMatchObject({
      status: StoryGenerationBatchStatus.blocked,
      blockReason: {
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        retryable: true,
        requiredAmount: '60',
        availableBalance: '0',
      },
    });
  });
});

function sqlText(value: unknown): string {
  if (Array.isArray(value)) return value.join('?');
  if (!value || typeof value !== 'object' || !('strings' in value)) return '';
  const strings: unknown = value.strings;
  return Array.isArray(strings) ? strings.join('?') : '';
}
