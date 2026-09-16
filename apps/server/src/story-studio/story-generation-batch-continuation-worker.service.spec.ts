/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Jest mock payload inspection is intentionally structural. */
import { ConflictException } from '@nestjs/common';
import {
  StoryGenerationBatchStatus,
  StoryProductionGenerationTargetKind,
} from '@prisma/client';
import {
  AgentOsContinuationNotReadyError,
  type AgentOsJournalDispatch,
} from '../agent-os-journal/agent-os-run-journal.service';
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

  it('does not select blocked, failed, or abandoned batches for delivery', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = new StoryGenerationBatchContinuationWorkerService(
      { $queryRaw: queryRaw } as never,
      {} as never,
    ) as unknown as {
      pickNextCandidateId(): Promise<string | null>;
    };

    await expect(service.pickNextCandidateId()).resolves.toBeNull();

    const sql = sqlText(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("batch.\"status\" IN ('completed', 'cancelled')");
    expect(sql).not.toContain("'blocked'");
    expect(sql).not.toContain("'failed'");
    expect(sql).toContain('batch."handoff_abandoned_at" IS NULL');
  });

  describe('delivery failure classification', () => {
    let errorSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('durably abandons a terminal handoff instead of retrying it every sweep', async () => {
      const harness = makeDrainHarness();
      harness.queryRaw
        .mockResolvedValueOnce([{ id: BATCH_ID }])
        .mockResolvedValue([]);
      harness.reconcileExternalHandoffInTransaction.mockRejectedValue(
        new ConflictException({
          code: 'AGENT_OS_EXTERNAL_HANDOFF_AFTER_TERMINAL',
          message:
            'Terminal Agent OS run completed cannot recover an external handoff.',
        }),
      );

      await harness.worker.drainOnce();

      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.abandonUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: BATCH_ID,
            handoffResultDeliveredAt: null,
            handoffAbandonedAt: null,
          }),
          data: expect.objectContaining({
            handoffAbandonedAt: expect.any(Date),
            handoffAbandonReason: expect.objectContaining({
              code: 'AGENT_OS_EXTERNAL_HANDOFF_AFTER_TERMINAL',
            }),
          }),
        }),
      );
    });

    it('treats a lost delivery claim as a benign race', async () => {
      const harness = makeDrainHarness();
      harness.queryRaw
        .mockResolvedValueOnce([{ id: BATCH_ID }])
        .mockResolvedValue([]);
      harness.deliverUpdateMany.mockResolvedValue({ count: 0 });

      await harness.worker.drainOnce();

      expect(harness.publishCommitted).not.toHaveBeenCalled();
      expect(harness.abandonUpdateMany).not.toHaveBeenCalled();
    });

    it('abandons a batch whose durable handoff identity is permanently invalid', async () => {
      const harness = makeDrainHarness();
      harness.queryRaw
        .mockResolvedValueOnce([{ id: BATCH_ID }])
        .mockResolvedValue([]);
      harness.findUnique.mockResolvedValue({
        ...buildBatchRow(StoryGenerationBatchStatus.completed),
        externalHandoffRegistration: undefined,
      });

      await harness.worker.drainOnce();

      expect(harness.abandonUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: BATCH_ID }),
        }),
      );
      expect(harness.publishCommitted).not.toHaveBeenCalled();
    });

    it('backs off a transient failure and keeps draining later candidates', async () => {
      const harness = makeDrainHarness();
      const candidateA = 'a0000000-0000-4000-8000-00000000000a';
      const candidateB = 'b0000000-0000-4000-8000-00000000000b';
      harness.queryRaw
        .mockResolvedValueOnce([{ id: candidateA }, { id: candidateB }])
        .mockResolvedValueOnce([{ id: candidateB }])
        .mockResolvedValue([]);
      harness.reconcileExternalHandoffInTransaction.mockRejectedValueOnce(
        new AgentOsContinuationNotReadyError(RUN_ID, 'paused'),
      );

      await harness.worker.drainOnce();

      // The failing head did not publish, but the next candidate still got
      // its delivery attempt in the same drain — no head-of-line blocking.
      expect(harness.publishCommitted).toHaveBeenCalledTimes(1);
      expect(harness.abandonUpdateMany).not.toHaveBeenCalled();

      // Immediately draining again must skip the backed-off head entirely:
      // only the head is a candidate, its delivery transaction is skipped.
      harness.queryRaw.mockResolvedValueOnce([{ id: candidateA }]);
      const deliveriesAfterFirstDrain = harness.transaction.mock.calls.length;
      await harness.worker.drainOnce();
      expect(harness.transaction.mock.calls.length).toBe(
        deliveriesAfterFirstDrain,
      );
    });
  });
});

function sqlText(value: unknown): string {
  if (Array.isArray(value)) return value.join('?');
  if (!value || typeof value !== 'object' || !('strings' in value)) return '';
  const strings = (value as { strings?: unknown }).strings;
  return Array.isArray(strings) ? strings.join('?') : '';
}

function buildBatchRow(status: StoryGenerationBatchStatus) {
  return {
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
  };
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
      findUnique: jest.fn().mockResolvedValue(buildBatchRow(status)),
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
    deliverCandidateInTransaction(
      tx: unknown,
      candidateId: string,
    ): Promise<AgentOsJournalDispatch>;
  };
  return {
    tx,
    updateMany,
    appendExternalResultInTransaction,
    resultDispatch,
    deliver: () => service.deliverCandidateInTransaction(tx, BATCH_ID),
  };
}

/**
 * Drain-level harness: exercises the full pick → deliver → classify loop
 * over mocked persistence. The prisma client exposes two updateMany call
 * sites that must be told apart — the in-transaction delivery claim and the
 * client-level durable abandon.
 */
function makeDrainHarness() {
  const queryRaw = jest.fn().mockResolvedValue([]);
  const deliverUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest
    .fn()
    .mockResolvedValue(buildBatchRow(StoryGenerationBatchStatus.completed));
  const tx = {
    storyGenerationBatch: { findUnique, updateMany: deliverUpdateMany },
  };
  const transaction = jest.fn((cb: (tx: unknown) => unknown) =>
    Promise.resolve(cb(tx)),
  );
  const abandonUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const publishCommitted = jest.fn().mockResolvedValue(undefined);
  const reconcileExternalHandoffInTransaction = jest
    .fn()
    .mockResolvedValue({ events: [], snapshot: {} });
  const appendExternalResultInTransaction = jest
    .fn()
    .mockResolvedValue({ events: [], snapshot: {} });
  const worker = new StoryGenerationBatchContinuationWorkerService(
    {
      $queryRaw: queryRaw,
      $transaction: transaction,
      storyGenerationBatch: { updateMany: abandonUpdateMany },
    } as never,
    {
      publishCommitted,
      reconcileExternalHandoffInTransaction,
      appendExternalResultInTransaction,
    } as never,
  );
  return {
    worker,
    queryRaw,
    transaction,
    findUnique,
    deliverUpdateMany,
    abandonUpdateMany,
    publishCommitted,
    reconcileExternalHandoffInTransaction,
    appendExternalResultInTransaction,
  };
}
