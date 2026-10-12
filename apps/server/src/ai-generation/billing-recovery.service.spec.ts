import { AiGenerationBillingRecoveryService } from './billing-recovery.service';
import { AiGenerationWorkerService } from './worker.service';
import { Prisma } from '@prisma/client';
function fixture() {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'job' }]) };
  const job = { id: 'job', status: 'failed', logs: [] };
  const jobs = { findById: jest.fn().mockResolvedValue(job) };
  const wallet = {
    releaseForJob: jest.fn().mockResolvedValue(undefined),
    settleForJob: jest.fn().mockResolvedValue(undefined),
  };
  const recovery = new AiGenerationBillingRecoveryService(
    prisma as never,
    jobs as never,
    wallet as never,
  );
  return { prisma, job, jobs, wallet, recovery };
}
const saved = process.env.BACKGROUND_TASKS_ENABLED;
beforeEach(() => {
  process.env.BACKGROUND_TASKS_ENABLED = 'true';
});
afterEach(() => {
  if (saved === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
  else process.env.BACKGROUND_TASKS_ENABLED = saved;
});
it('recovers a hold after terminal failure persisted but wallet release failed', async () => {
  const f = fixture();
  f.job.status = 'in_progress';
  f.wallet.releaseForJob.mockRejectedValueOnce(new Error('wallet unavailable'));
  const worker = Object.assign(
    Object.create(AiGenerationWorkerService.prototype) as {
      markFailed: (job: unknown, error: unknown) => Promise<void>;
    },
    {
      store: {
        failIfActive: jest.fn((_id: string, patch: object) => {
          Object.assign(f.job, patch);
          return Promise.resolve(f.job);
        }),
      },
      providerCapacity: { release: jest.fn() },
      billingWallet: f.wallet,
      recordTraceSafe: jest.fn(),
      emit: jest.fn(),
      alertJobFailure: jest.fn(),
      logger: { warn: jest.fn() },
    },
  );
  await expect(
    worker.markFailed(f.job, {
      code: 'PROVIDER_NOT_CONFIGURED',
      message: 'overdue',
      retryable: false,
    }),
  ).rejects.toThrow('wallet unavailable');
  expect(f.job.status).toBe('failed');
  await f.recovery.recover();
  expect(f.wallet.releaseForJob).toHaveBeenCalledTimes(2);
  expect(f.wallet.settleForJob).not.toHaveBeenCalled();
  expect(f.jobs.findById).toHaveBeenCalledWith('job', { includeDeleted: true });
});
it.each(['failed', 'cancelled', 'expired'])(
  'releases %s holds',
  async (status) => {
    const f = fixture();
    f.job.status = status;
    await f.recovery.recover();
    expect(f.wallet.releaseForJob).toHaveBeenCalledTimes(1);
    expect(f.wallet.settleForJob).not.toHaveBeenCalled();
  },
);
it('settles completed output instead of refunding it', async () => {
  const f = fixture();
  f.job.status = 'completed';
  await f.recovery.recover();
  expect(f.wallet.settleForJob).toHaveBeenCalledWith(f.job);
  expect(f.wallet.releaseForJob).not.toHaveBeenCalled();
});
it.each(['in_queue', 'in_progress'])(
  'does not alter active %s jobs',
  async (status) => {
    const f = fixture();
    f.job.status = status;
    await f.recovery.recover();
    expect(f.wallet.releaseForJob).not.toHaveBeenCalled();
    expect(f.wallet.settleForJob).not.toHaveBeenCalled();
  },
);
it('continues after a broken wallet and advances/wraps its cursor', async () => {
  const f = fixture();
  f.prisma.$queryRaw
    .mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, i) => ({ id: `job-${i}` })),
    )
    .mockResolvedValue([]);
  f.wallet.releaseForJob.mockRejectedValueOnce(new Error('unavailable'));
  await f.recovery.recover();
  expect(f.wallet.releaseForJob).toHaveBeenCalledTimes(100);
  await f.recovery.recover();
  expect(
    (f.prisma.$queryRaw.mock.calls[1] as [Prisma.Sql])[0].values,
  ).toContain('job-99');
  await f.recovery.recover();
  expect(
    (f.prisma.$queryRaw.mock.calls[2] as [Prisma.Sql])[0].values,
  ).not.toContain('job-99');
});
it('honors disabled background work and shutdown', async () => {
  const f = fixture();
  process.env.BACKGROUND_TASKS_ENABLED = 'false';
  await f.recovery.recover();
  expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
  process.env.BACKGROUND_TASKS_ENABLED = 'true';
  await f.recovery.onApplicationShutdown();
  await f.recovery.recover();
  expect(f.prisma.$queryRaw).not.toHaveBeenCalled();
});
