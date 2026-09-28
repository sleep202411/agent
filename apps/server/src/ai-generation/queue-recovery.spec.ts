import { AiGenerationQueueService } from './queue.service';

type Internals = { recoverQueuedJobs: () => Promise<void> };
function fixture(state = 'in_queue', existingState?: string) {
  const existing = existingState
    ? {
        data: { jobId: 'job', op: 'poll', nextPollAt: Date.now() + 60_000 },
        updateData: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockResolvedValue(existingState),
        retry: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      }
    : undefined;
  const queue = {
    getJob: jest.fn().mockResolvedValue(existing),
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    aiJob: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'job',
          status: state,
          version: 2,
          queueName: 'ai-image-generation',
          routingSnapshot: null,
        },
      ]),
    },
  };
  const service = new AiGenerationQueueService(prisma as never);
  Object.assign(service, { queueFor: () => queue });
  return { service, queue, existing, prisma };
}

it('retries an exhausted recovery message for a still-queued row', async () => {
  const { service, queue, existing } = fixture('in_queue', 'failed');
  await (service as unknown as Internals).recoverQueuedJobs();
  expect(existing?.retry).toHaveBeenCalledWith('failed');
  expect(queue.add).not.toHaveBeenCalled();
});

it.each(['active', 'waiting', 'delayed', 'prioritized'])(
  'does not replace a %s singleton poll',
  async (state) => {
    const { service, queue, existing } = fixture('in_progress', state);
    await (service as unknown as Internals).recoverQueuedJobs();
    expect(existing?.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  },
);

it.each(['completed', 'failed'])(
  'restores a %s poll without resubmitting generation',
  async (state) => {
    const { service, queue, existing } = fixture('in_progress', state);
    await (service as unknown as Internals).recoverQueuedJobs();
    expect(existing?.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { jobId: 'job', op: 'poll' },
      expect.objectContaining({ jobId: 'job__poll' }),
    );
  },
);

it('stops dispatching after shutdown begins', async () => {
  const { service, queue } = fixture();
  await service.onApplicationShutdown();
  await (service as unknown as Internals).recoverQueuedJobs();
  expect(queue.add).not.toHaveBeenCalled();
});

it('preserves a poll backoff while the singleton is active', async () => {
  const { service, existing, queue } = fixture('in_progress', 'active');
  await service.enqueue('ai-image-generation', 'job', 5000, 5, 'poll');
  expect(existing?.updateData).toHaveBeenCalledWith(
    expect.objectContaining({ nextPollAt: existing?.data.nextPollAt }),
  );
  expect(queue.add).not.toHaveBeenCalled();
});

it.each(['in_queue', 'in_progress'])(
  'continues the recovery page when one %s job fails to dispatch',
  async (status) => {
    const { service, queue, prisma } = fixture(status);
    prisma.aiJob.findMany.mockResolvedValue([
      {
        id: 'broken',
        status,
        version: 2,
        queueName: 'ai-image-generation',
        routingSnapshot: null,
      },
      {
        id: 'healthy',
        status,
        version: 2,
        queueName: 'ai-video-generation',
        routingSnapshot: null,
      },
    ]);
    queue.getJob.mockRejectedValueOnce(new Error('job-specific Redis failure'));
    await expect(
      (service as unknown as Internals).recoverQueuedJobs(),
    ).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { jobId: 'healthy', op: status === 'in_progress' ? 'poll' : 'start' },
      expect.any(Object),
    );
    // The failed row remains eligible: the next scan retries it, rather than
    // marking it failed or abandoning its accepted provider receipt.
    await (service as unknown as Internals).recoverQueuedJobs();
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      { jobId: 'broken', op: status === 'in_progress' ? 'poll' : 'start' },
      expect.any(Object),
    );
  },
);
