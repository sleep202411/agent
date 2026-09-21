import { AiGenerationWorkerService } from './worker.service';
import { PollDispatchError } from './poll-dispatch-error';

it('retains an accepted Seedance task after poll dispatch fails and resumes the same task', async () => {
  const job = {
    id: 'seedance-job',
    status: 'in_progress',
    provider: 'byteplus',
    providerJobId: 'dreamina-seedance-2-5-260628::task-25::no-video-input',
    queueName: 'ai-video',
    logs: [],
    progress: 0.2,
  };
  const adapter = {
    pollStatus: jest
      .fn()
      .mockResolvedValue({ kind: 'pending', progress: 0.55 }),
    mapError: jest.fn(),
  };
  const enqueue = jest
    .fn()
    .mockRejectedValueOnce(new Error('Redis unavailable'))
    .mockResolvedValue(undefined);
  const handleFailure = jest.fn();
  const markFailed = jest.fn();
  const release = jest.fn();
  const worker = Object.assign(
    Object.create(AiGenerationWorkerService.prototype) as object,
    {
      providers: { get: () => adapter },
      store: {
        findProviderAttemptContext: jest.fn(),
        update: jest.fn().mockResolvedValue(job),
      },
      providerCapacity: {
        heartbeat: jest.fn(),
        recordFailure: jest.fn(),
        release,
      },
      queueService: { enqueue },
      isAsyncProviderTimedOut: () => false,
      recordAttemptSafe: jest.fn(),
      recordProviderTraceEventsSafe: jest.fn(),
      recordTraceSafe: jest.fn(),
      emit: jest.fn(),
      queuePriorityFor: () => 100,
      handleFailure,
      markFailed,
    },
  ) as unknown as { pollJob: (value: typeof job) => Promise<void> };
  await expect(worker.pollJob(job)).rejects.toBeInstanceOf(PollDispatchError);
  expect(adapter.mapError).not.toHaveBeenCalled();
  expect(handleFailure).not.toHaveBeenCalled();
  expect(markFailed).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  await expect(worker.pollJob(job)).resolves.toBeUndefined();
  expect(adapter.pollStatus).toHaveBeenCalledTimes(2);
  expect(adapter.pollStatus).toHaveBeenNthCalledWith(
    1,
    job.providerJobId,
    undefined,
  );
  expect(adapter.pollStatus).toHaveBeenNthCalledWith(
    2,
    job.providerJobId,
    undefined,
  );
  expect(enqueue).toHaveBeenCalledTimes(2);
});
