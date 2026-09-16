import { MediaProcessingWorkerService } from './media-processing-worker.service';
import type { MediaProcessingJob } from '@prisma/client';

type ResultWriter = {
  complete(row: MediaProcessingJob, output: object): Promise<void>;
  fail(row: MediaProcessingJob, message: string): Promise<void>;
  requeueForPoll(
    row: MediaProcessingJob,
    output: object,
    delay: number,
  ): Promise<void>;
};
type Write = {
  where: { id: string; lockedBy: string; lockedAt: Date; status: string };
  data: Record<string, unknown>;
};

describe('media processing result lease ownership', () => {
  it.each(['complete', 'fail', 'requeueForPoll'] as const)(
    '%s preserves a replacement lease and accepts its current owner',
    async (action) => {
      const oldTime = new Date('2026-01-01T00:00:00Z');
      const newTime = new Date('2026-01-01T00:01:00Z');
      let stored: Record<string, unknown> = {
        id: 'job',
        lockedBy: 'same-pod',
        lockedAt: newTime,
        status: 'processing',
        output: { replacement: true },
      };
      const updateMany = jest.fn<Promise<{ count: number }>, [Write]>(
        ({ where, data }) => {
          const matches = Object.entries(where).every(
            ([key, value]) => stored[key] === value,
          );
          if (matches) stored = { ...stored, ...data };
          return Promise.resolve({ count: Number(matches) });
        },
      );
      const worker = new MediaProcessingWorkerService(
        { mediaProcessingJob: { updateMany } } as never,
        undefined as never,
        undefined as never,
      ) as unknown as ResultWriter;
      const row = {
        id: 'job',
        lockedBy: 'same-pod',
        lockedAt: oldTime,
        status: 'processing',
        attempt: 0,
        maxAttempts: 8,
      } as MediaProcessingJob;
      const run = (lease: MediaProcessingJob) =>
        action === 'fail'
          ? worker.fail(lease, 'provider failure')
          : action === 'complete'
            ? worker.complete(lease, { done: true })
            : worker.requeueForPoll(lease, { poll: true }, 1000);
      const replacement = { ...stored };
      await run(row);
      expect(stored).toEqual(replacement);
      await run({ ...row, lockedAt: newTime });
      expect(stored.lockedAt).toBeNull();
      expect(stored.status).toBe(
        action === 'complete'
          ? 'completed'
          : action === 'fail'
            ? 'failed'
            : 'pending',
      );
    },
  );
});
