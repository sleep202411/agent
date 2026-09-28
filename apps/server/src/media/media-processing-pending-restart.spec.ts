import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MediaProcessingService } from './media-processing.service';
import { PrismaService } from '../infra/db/db.module';

function fixture(
  status = 'pending',
  jobType = 'hls_stream',
  output: Prisma.JsonValue = { immTaskId: 'remote-task' },
) {
  const existing = {
    id: 'job',
    assetId: 'asset',
    sourceVariantId: null,
    jobType,
    status,
    output,
    lockedAt: null,
    nextAttemptAt: new Date(Date.now() + 60_000),
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ nowMs: Date.now() }]),
    mediaAsset: { findFirst: jest.fn().mockResolvedValue({ id: 'asset' }) },
    mediaProcessingJob: {
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...existing, ...data }),
        ),
    },
  };
  const service = new MediaProcessingService({} as PrismaService);
  const input = {
    assetId: 'asset',
    jobType: jobType as 'hls_stream',
    idempotencyKey: 'hls-stream:asset',
  };
  const restart = () =>
    service.enqueueJobTx(
      input,
      tx as unknown as Prisma.TransactionClient,
      true,
    );
  return { existing, tx, service, input, restart };
}

it('rejects restart while a known remote HLS task awaits polling and preserves its schedule', async () => {
  const f = fixture();
  const before = structuredClone(f.existing);
  await expect(f.restart()).rejects.toThrow(ConflictException);
  expect(f.tx.mediaProcessingJob.update).not.toHaveBeenCalled();
  expect(f.existing).toEqual(before);
});
it('preserves a task even when its poll is overdue', async () => {
  const f = fixture();
  f.existing.nextAttemptAt = new Date(0);
  await expect(f.restart()).rejects.toThrow('awaiting');
  expect(f.tx.mediaProcessingJob.update).not.toHaveBeenCalled();
});
it('ordinary enqueue replay still returns the current job', async () => {
  const f = fixture();
  await expect(
    f.service.enqueueJobTx(
      f.input,
      f.tx as unknown as Prisma.TransactionClient,
    ),
  ).resolves.toBe(f.existing);
  expect(f.tx.mediaProcessingJob.update).not.toHaveBeenCalled();
});
it.each(['failed', 'dead', 'completed'])(
  'does not change existing explicit restart policy for %s jobs',
  async (status) => {
    const f = fixture(status);
    await expect(f.restart()).resolves.toMatchObject({
      status: 'pending',
      output: {},
    });
  },
);
it.each([{}, null, [], { immTaskId: '' }])(
  'keeps pending jobs without a known task restartable: %j',
  async (output) => {
    const f = fixture('pending', 'hls_stream', output);
    await expect(f.restart()).resolves.toMatchObject({
      status: 'pending',
      output: {},
    });
  },
);
it('does not change unrelated backfill restart behavior', async () => {
  const f = fixture('pending', 'backfill_original_placement');
  await expect(f.restart()).resolves.toMatchObject({
    status: 'pending',
    output: {},
  });
});
