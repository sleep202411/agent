import { AiGenerationWorkerService } from './worker.service';
import { PollDispatchError } from './poll-dispatch-error';

it('retains an accepted Seedance task after poll dispatch fails and resumes the same task', async () => {
  const job = {
    id: 'seedance-job',
    attempt: 1,
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
        updateProgressIfRunning: jest.fn().mockResolvedValue(job),
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

it('does not emit late progress or dispatch another poll after losing the running-attempt claim', async () => {
  const job = {
    id: 'job',
    attempt: 1,
    status: 'in_progress',
    provider: 'byteplus',
    providerJobId: 'accepted',
    logs: [],
    progress: 0.2,
  };
  const updateProgressIfRunning = jest.fn().mockResolvedValue(null);
  const enqueue = jest.fn();
  const emit = jest.fn();
  const worker = Object.assign(
    Object.create(AiGenerationWorkerService.prototype) as object,
    {
      providers: {
        get: () => ({
          pollStatus: jest
            .fn()
            .mockResolvedValue({ kind: 'pending', progress: 0.7 }),
        }),
      },
      store: { findProviderAttemptContext: jest.fn(), updateProgressIfRunning },
      providerCapacity: { heartbeat: jest.fn() },
      queueService: { enqueue },
      isAsyncProviderTimedOut: () => false,
      recordAttemptSafe: jest.fn(),
      recordProviderTraceEventsSafe: jest.fn(),
      recordTraceSafe: jest.fn(),
      emit,
    },
  ) as unknown as { pollJob: (value: typeof job) => Promise<void> };
  await worker.pollJob(job);
  expect(updateProgressIfRunning).toHaveBeenCalledWith(
    job,
    expect.objectContaining({ stage: 'generating', progress: 0.7 }),
  );
  expect(emit).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});
