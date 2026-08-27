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
    expect(sql).toContain('LIMIT ?');
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
      'story-generation-batch:item-1',
      expect.any(Object),
      { pricingVersion: 'price-v1', points: 12 },
      { type: 'workspace', id: 'actor-personal-workspace' },
      expect.objectContaining({ itemId: 'item-1' }),
    );
  });

  it('persists the actionable domain error instead of the generic HTTP exception text', async () => {
    const updateMany = jest
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
      { storyGenerationBatchItem: { updateMany } } as never,
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
      quotedPoints: 60,
      pricingVersion: 'price-v1',
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

    const update = updateMany.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(update?.data).toMatchObject({
      status: StoryGenerationBatchItemStatus.failed,
      error: {
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        message: 'Not enough compute points. Recharge and try again.',
        retryable: false,
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
