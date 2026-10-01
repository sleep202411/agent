/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers */
import { MediaProcessingWorkerService } from './media-processing-worker.service';
import { MEDIA_PROCESSING_LOCK_TTL_MS } from './media-worker-leases';
import type { MediaProcessingJob } from '@prisma/client';

type Worker = {
  startHeartbeat(row: MediaProcessingJob): () => Promise<void>;
  processOne(row: MediaProcessingJob): Promise<void>;
};
const tick = MEDIA_PROCESSING_LOCK_TTL_MS / 3;
const row = {
  id: 'job',
  assetId: 'asset',
  lockedBy: 'pod',
  lockedAt: new Date('2026-01-01'),
  startedAt: new Date('2026-01-01'),
  jobType: 'poster',
  attempt: 0,
  maxAttempts: 3,
} as MediaProcessingJob;
function fixture() {
  const updateMany = jest
    .fn<Promise<{ count: number }>, [unknown]>()
    .mockResolvedValue({ count: 1 });
  const generate = jest.fn<Promise<object>, [string]>().mockResolvedValue({});
  const worker = new MediaProcessingWorkerService(
    { mediaProcessingJob: { updateMany } } as never,
    undefined as never,
    { generate } as never,
  ) as unknown as Worker;
  return { worker, updateMany, generate };
}
describe('processing heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(row.lockedAt!.getTime());
  });
  afterEach(() => jest.useRealTimers());
  it('renews across multiple TTLs while preserving the claim identity', async () => {
    const f = fixture();
    const stop = f.worker.startHeartbeat(row);
    await jest.advanceTimersByTimeAsync(MEDIA_PROCESSING_LOCK_TTL_MS * 2);
    expect(f.updateMany).toHaveBeenCalledTimes(6);
    expect(f.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: row.id,
        status: 'processing',
        deadAt: null,
        lockedBy: row.lockedBy,
        startedAt: row.startedAt,
        lockedAt: { gte: new Date(Date.now() - MEDIA_PROCESSING_LOCK_TTL_MS) },
      },
      data: { lockedAt: new Date() },
    });
    await stop();
    await jest.advanceTimersByTimeAsync(tick * 2);
    expect(f.updateMany).toHaveBeenCalledTimes(6);
  });
  it('stops after a replacement, terminal state or expired lease rejects renewal', async () => {
    const f = fixture();
    f.updateMany.mockResolvedValue({ count: 0 });
    const stop = f.worker.startHeartbeat(row);
    await jest.advanceTimersByTimeAsync(tick * 4);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
    await stop();
  });
  it('serializes slow renewals and awaits them on cleanup', async () => {
    const f = fixture();
    let finish!: (value: { count: number }) => void;
    f.updateMany.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const stop = f.worker.startHeartbeat(row);
    await jest.advanceTimersByTimeAsync(tick * 3);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish({ count: 1 });
    await stopping;
    await jest.advanceTimersByTimeAsync(tick * 2);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
  });
  it('retries a transient renewal error without marking the provider job failed', async () => {
    const f = fixture();
    f.updateMany.mockRejectedValueOnce(new Error('temporary DB failure'));
    const stop = f.worker.startHeartbeat(row);
    await jest.advanceTimersByTimeAsync(tick * 2);
    expect(f.updateMany).toHaveBeenCalledTimes(2);
    await stop();
  });
  it('keeps a long operation alive and removes its timer after completion', async () => {
    const f = fixture();
    let finish!: (value: object) => void;
    f.generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const processing = f.worker.processOne(row);
    await jest.advanceTimersByTimeAsync(tick * 4);
    finish({ poster: 'ready' });
    await processing;
    expect(jest.getTimerCount()).toBe(0);
    expect(f.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startedAt: row.startedAt,
          lockedBy: row.lockedBy,
        }),
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });
});
