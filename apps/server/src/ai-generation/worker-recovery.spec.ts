import { AiGenerationWorkerService } from './worker.service';
import { PollDispatchError } from './poll-dispatch-error';

type RecoveryWorker = {
  processQueueJob: (message: {
    data: { jobId: string; op?: string };
    attemptsMade: number;
    stalledCounter: number;
  }) => Promise<void>;
  dispatchPoll: (enqueue: () => Promise<void>) => Promise<void>;
};

function fixture(status = 'in_progress', providerJobId?: string) {
  const pollJob = jest.fn().mockResolvedValue(undefined);
  const runJob = jest.fn().mockResolvedValue(undefined);
  const worker = Object.assign(
    Object.create(AiGenerationWorkerService.prototype) as RecoveryWorker,
    {
      store: {
        recordUnknownAcceptance: jest.fn().mockResolvedValue(true),
        findById: jest
          .fn()
          .mockResolvedValue({ id: 'job', status, providerJobId }),
      },
      logger: { warn: jest.fn() },
      inflight: new Map(),
      pollJob,
      scheduleAcceptedPoll: pollJob,
      runJob,
    },
  );
  return { worker, pollJob, runJob };
}

it.each([
  { attemptsMade: 1, stalledCounter: 0 },
  { attemptsMade: 0, stalledCounter: 1 },
])(
  'resumes accepted generation by polling after redelivery %j',
  async (delivery) => {
    const { worker, pollJob, runJob } = fixture('in_progress', 'accepted');
    await worker.processQueueJob({ data: { jobId: 'job' }, ...delivery });
    expect(pollJob).toHaveBeenCalledTimes(1);
    expect(runJob).not.toHaveBeenCalled();
  },
);

it('does not silently acknowledge abandoned work with unknown acceptance', async () => {
  const { worker, pollJob, runJob } = fixture();
  await expect(
    worker.processQueueJob({
      data: { jobId: 'job' },
      attemptsMade: 0,
      stalledCounter: 1,
    }),
  ).rejects.toThrow('provider acceptance is unknown');
  expect(pollJob).not.toHaveBeenCalled();
  expect(runJob).not.toHaveBeenCalled();
});

it.each(['cancelled', 'completed', 'failed'])(
  'does not restart a %s job',
  async (status) => {
    const { worker, pollJob, runJob } = fixture(status, 'accepted');
    await worker.processQueueJob({
      data: { jobId: 'job' },
      attemptsMade: 1,
      stalledCounter: 0,
    });
    expect(pollJob).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  },
);

it('distinguishes poll dispatch failure from provider rejection', async () => {
  const { worker } = fixture();
  const cause = new Error('queue unavailable');
  await expect(
    worker.dispatchPoll(() => Promise.reject(cause)),
  ).rejects.toMatchObject({ name: 'PollDispatchError', cause });
  await expect(
    worker.dispatchPoll(() => Promise.resolve()),
  ).resolves.toBeUndefined();
  expect(new PollDispatchError(cause)).toBeInstanceOf(Error);
});
