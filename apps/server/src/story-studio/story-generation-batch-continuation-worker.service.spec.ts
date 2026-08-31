/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import {
  StoryGenerationBatchStatus,
  StoryProductionGenerationTargetKind,
} from '@prisma/client';
import { StoryGenerationBatchContinuationWorkerService } from './story-generation-batch-continuation-worker.service';

const BATCH_ID = '10000000-0000-4000-8000-000000000001';
const RUN_ID = '20000000-0000-4000-8000-000000000002';
const TURN_ID = '30000000-0000-4000-8000-000000000003';

describe('StoryGenerationBatchContinuationWorkerService', () => {
  it('resumes the original Agent turn only after the Asset batch completes', async () => {
    const fixture = makeFixture(StoryGenerationBatchStatus.completed);

    await expect(fixture.deliver()).resolves.toEqual(fixture.resultDispatch);

    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        runId: RUN_ID,
        turnId: TURN_ID,
        toolId: 'story.generation.confirmBatch',
        externalJobId: BATCH_ID,
        phase: 'apply',
        outcome: 'completed',
        storyContinuation: expect.objectContaining({
          completedStage: 'assets',
          mediaBatchCompleted: true,
        }),
      }),
    );
    expect(fixture.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { handoffResultDeliveredAt: expect.any(Date) },
      }),
    );
  });

  it('terminalizes the Agent turn when the creator stops the same batch', async () => {
    const fixture = makeFixture(StoryGenerationBatchStatus.cancelled);

    await fixture.deliver();

    expect(fixture.appendExternalResultInTransaction).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({
        outcome: 'cancelled',
        error: expect.objectContaining({
          code: 'STORY_GENERATION_BATCH_CANCELLED',
        }),
      }),
    );
    const input = fixture.appendExternalResultInTransaction.mock.calls[0]?.[1];
    expect(input).not.toHaveProperty('storyContinuation');
  });

  it('does not select blocked or failed batches for stage advancement', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const tx = { $queryRaw: queryRaw };
    const service = new StoryGenerationBatchContinuationWorkerService(
      {} as never,
      {} as never,
    ) as unknown as {
      deliverNextInTransaction(tx: unknown): Promise<unknown>;
    };

    await expect(service.deliverNextInTransaction(tx)).resolves.toBeNull();

    const sql = sqlText(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("batch.\"status\" IN ('completed', 'cancelled')");
    expect(sql).not.toContain("'blocked'");
    expect(sql).not.toContain("'failed'");
  });
});

function sqlText(value: unknown): string {
  if (Array.isArray(value)) return value.join('?');
  if (!value || typeof value !== 'object' || !('strings' in value)) return '';
  const strings = (value as { strings?: unknown }).strings;
  return Array.isArray(strings) ? strings.join('?') : '';
}

function makeFixture(status: StoryGenerationBatchStatus) {
  const handoffDispatch = {
    events: [{ id: 'handoff' }],
    snapshot: { status: 'waiting' },
  };
  const resultDispatch = {
    events: [{ id: 'handoff' }, { id: 'result' }],
    snapshot: {
      status:
        status === StoryGenerationBatchStatus.completed
          ? 'running'
          : 'cancelled',
    },
  };
  const appendResult = {
    events: [{ id: 'result' }],
    snapshot: resultDispatch.snapshot,
  };
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: BATCH_ID }]),
    storyGenerationBatch: {
      findUnique: jest.fn().mockResolvedValue({
        id: BATCH_ID,
        status,
        project: { defaultLocale: 'zh-CN' },
        items: [
          {
            targetKind: StoryProductionGenerationTargetKind.asset_spec,
          },
        ],
        externalHandoffRegistration: {
          externalJobId: BATCH_ID,
          generationBatchId: BATCH_ID,
          sourceAgentRunId: RUN_ID,
          sourceAgentTurnId: TURN_ID,
          sourceAgentToolCallId: 'story-media-confirm:response-1',
          sourceToolId: 'story.generation.confirmBatch',
          completionMessage: '资产图片已全部生成，正在准备分镜方案。',
          continuationPlan: {
            continueThrough: 'storyboard',
            title: 'Cat',
            summary: 'Cat story',
            brief: 'Create a cat story.',
            experience: 'mobile_h5',
            autoGenerateAssetImages: true,
          },
        },
      }),
      updateMany,
    },
  };
  const reconcileExternalHandoffInTransaction = jest
    .fn()
    .mockResolvedValue(handoffDispatch);
  const appendExternalResultInTransaction = jest
    .fn()
    .mockResolvedValue(appendResult);
  const service = new StoryGenerationBatchContinuationWorkerService(
    {} as never,
    {
      reconcileExternalHandoffInTransaction,
      appendExternalResultInTransaction,
    } as never,
  ) as unknown as {
    deliverNextInTransaction(tx: unknown): Promise<unknown>;
  };
  return {
    tx,
    updateMany,
    appendExternalResultInTransaction,
    resultDispatch,
    deliver: () => service.deliverNextInTransaction(tx),
  };
}
