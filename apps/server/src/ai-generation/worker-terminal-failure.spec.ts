import { AiGenerationWorkerService } from './worker.service';

it.each(['cancelled', 'completed', 'failed'])(
  'does not replace an already %s job with a late provider failure',
  async (status) => {
    const stored = { id: 'job', status, logs: [] };
    const update = jest.fn((_id: string, patch: object) =>
      Object.assign(stored, patch),
    );
    const failIfActive = jest.fn().mockResolvedValue(null);
    const release = jest.fn();
    const releaseForJob = jest.fn();
    const recordTraceSafe = jest.fn();
    const emit = jest.fn();
    const alertJobFailure = jest.fn();
    const worker = Object.assign(
      // The test invokes the inherited private method without constructing live providers.
      Object.create(AiGenerationWorkerService.prototype) as {
        markFailed: (job: object, error: object) => Promise<void>;
      },
      {
        store: { update, failIfActive },
        providerCapacity: { release },
        billingWallet: { releaseForJob },
        recordTraceSafe,
        emit,
        alertJobFailure,
        logger: { warn: jest.fn() },
      },
    );
    await worker.markFailed(
      { id: 'job', status: 'in_progress', attempt: 1, logs: [] },
      {
        code: 'VALIDATION_ERROR',
        message: 'late provider error',
        retryable: false,
      },
    );
    expect(stored.status).toBe(status);
    expect(update).not.toHaveBeenCalled();
    expect(releaseForJob).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(recordTraceSafe).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(alertJobFailure).not.toHaveBeenCalled();
  },
);
