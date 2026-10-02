/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers */
import { CdnPurgeWorkerService } from './cdn-purge-worker.service';
import { MediaTakedownWorkerService } from './media-takedown-worker.service';
import { MediaProcessingWorkerService } from './media-processing-worker.service';

type Claim = { claim: (batch: number) => Promise<unknown[]> };
const cases = [
  {
    name: 'purge',
    create: (db: unknown) =>
      new CdnPurgeWorkerService(
        db as never,
        undefined as never,
        undefined as never,
      ),
  },
  {
    name: 'takedown',
    create: (db: unknown) =>
      new MediaTakedownWorkerService(
        db as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      ),
  },
  {
    name: 'processing',
    create: (db: unknown) =>
      new MediaProcessingWorkerService(
        db as never,
        undefined as never,
        undefined as never,
      ),
  },
];
describe.each(cases)('$name claim eligibility', ({ create, name }) => {
  it('rechecks status and retry eligibility in the write and returns only this lease timestamp', async () => {
    const findMany = jest
      .fn<Promise<unknown[]>, [Record<string, unknown>]>()
      .mockResolvedValueOnce([{ id: 'candidate' }])
      .mockResolvedValueOnce([]);
    const updateMany = jest
      .fn<Promise<{ count: number }>, [Record<string, unknown>]>()
      .mockResolvedValue({ count: 0 });
    const model = { findMany, updateMany };
    const worker = create({
      mediaModerationAction: model,
      mediaProcessingJob: model,
    }) as unknown as Claim;
    expect(await worker.claim(10)).toEqual([]);
    const selection = findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    const write = updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: { lockedAt: Date };
    };
    // A completed or rescheduled candidate must still satisfy the original
    // status/retry/lease predicates when the database executes the claim write.
    expect(write.where).toEqual({
      ...selection.where,
      id: { in: ['candidate'] },
    });
    if (name === 'processing') {
      expect(write.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: { in: ['pending', 'failed'] },
            OR: expect.arrayContaining([{ nextAttemptAt: null }]),
          }),
        ]),
      );
    } else {
      expect(write.where.status).toEqual({ in: ['pending', 'failed'] });
      expect(write.where.OR).toEqual(
        expect.arrayContaining([{ nextAttemptAt: null }]),
      );
    }
    expect(findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ lockedAt: write.data.lockedAt }),
      }),
    );
  });
});
