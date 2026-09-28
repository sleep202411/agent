import { AiGenerationWorkerService } from './worker.service';

it('reports failed output storage without enqueueing another paid generation', async () => {
  const job = {
    id: 'job',
    providerJobId: 'accepted-task',
    status: 'in_progress',
    attempt: 1,
    logs: [],
  };
  const update = jest
    .fn()
    .mockImplementation((_id: string, patch: object) =>
      Promise.resolve(Object.assign(job, patch)),
    );
  const enqueue = jest.fn();
  const requeueIfRunning = jest.fn();
  const releaseForJob = jest.fn();
  const worker = Object.assign(
    Object.create(AiGenerationWorkerService.prototype) as object,
    {
      store: { update, failIfActive: update, requeueIfRunning },
      queueService: { enqueue },
      providerCapacity: { release: jest.fn() },
      billingWallet: { releaseForJob },
      recordTraceSafe: jest.fn(),
      emit: jest.fn(),
      alertJobFailure: jest.fn(),
      logger: { warn: jest.fn() },
      uploadOutputs: jest
        .fn()
        .mockRejectedValue(new Error('storage unavailable')),
    },
  ) as unknown as {
    completeWithOutputs: (job: object, outputs: object[]) => Promise<void>;
  };
  await worker.completeWithOutputs(job, [
    { type: 'video', providerUrl: 'https://example.test/video.mp4' },
  ]);
  expect(job).toMatchObject({
    status: 'failed',
    providerJobId: 'accepted-task',
    error: { code: 'OSS_UPLOAD_FAILED' },
  });
  expect(enqueue).not.toHaveBeenCalled();
  expect(requeueIfRunning).not.toHaveBeenCalled();
  expect(releaseForJob).toHaveBeenCalledTimes(1);
});
