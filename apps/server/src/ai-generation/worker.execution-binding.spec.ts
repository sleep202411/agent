import { AiGenerationWorkerService } from './worker.service';
import type { AiExecutionBindingIdentity } from './types';

it.each([true, false])(
  'passes only the stored execution identity to provider submission (%s)',
  async (pinned) => {
    const identity: AiExecutionBindingIdentity = {
      deployment: 'endpoint',
      canonicalModelId: 'canonical',
      providerAccountId: 'account',
      providerBindingId: 'binding',
      providerEndpointId: 'endpoint-id',
    };
    const payload = { code: 'VALIDATION_ERROR', retryable: false };
    const adapter = {
      startGeneration: jest
        .fn()
        .mockRejectedValue(new Error('binding changed')),
      mapError: jest.fn().mockReturnValue(payload),
    };
    const capacity = {
      reserveForProviderSubmit: jest.fn().mockResolvedValue({ ok: true }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const worker = new AiGenerationWorkerService(
      {} as never,
      { get: jest.fn().mockReturnValue(adapter) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      capacity as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        prepareReferences: jest.fn().mockResolvedValue({ prompt: 'A scene' }),
      } as never,
    );
    const failure = jest.fn().mockResolvedValue(undefined);
    Object.assign(worker, {
      recordAttemptSafe: jest.fn().mockResolvedValue(undefined),
      handleFailure: failure,
    });
    const job = {
      id: 'job',
      userId: 'user',
      provider: 'fal-ai',
      modelId: 'model',
      deployment: 'endpoint',
      normalizedInput: {
        prompt: 'A scene',
        expectedExecutionBinding: { deployment: 'caller-controlled' },
      },
      routingSnapshot: {
        selectedProvider: 'fal-ai',
        selectedModelId: 'model',
        ...(pinned ? { executionBindingIdentity: identity } : {}),
      },
    };
    await worker['runJob'](job as never);
    expect(adapter.startGeneration).toHaveBeenCalledWith(
      'model',
      { prompt: 'A scene' },
      expect.objectContaining({
        expectedExecutionBinding: pinned ? identity : undefined,
      }),
    );
    expect(capacity.release).toHaveBeenCalledWith(job);
    expect(failure).toHaveBeenCalledWith(job, payload);
  },
);
